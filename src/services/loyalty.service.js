/**
 * LoyaltyService — the ONLY place where Silver counts, reward unlocks and Gold status change.
 *
 * Every mutating function here takes a Prisma transaction client (`tx`) and must be called
 * inside `prisma.$transaction(...)`. The customer row is locked with SELECT … FOR UPDATE
 * first, so concurrent purchases for the same customer are serialised and counts can never
 * be lost or double-applied.
 *
 *   purchase saved ─▶ evaluatePurchase() ─▶ changeCount(+n)
 *                                             ├─ loyalty_transactions row (COUNT_ADDED)
 *                                             ├─ unlock rewards whose requiredCount ≤ new count
 *                                             └─ Silver → Gold when new count ≥ gold threshold
 *
 * Rules on the way DOWN (cancellation / edit reducing the count) only undo what the change
 * actually crossed: an unclaimed reward whose milestone is now out of reach is REVOKED, Gold
 * is removed only if this change dropped the count below the current threshold. Claimed or
 * delivered rewards are never touched automatically — they are flagged in the audit log.
 */
import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { goldCardNumberFor } from '../utils/format.js';
import { audit } from './audit.service.js';
import { getSettings, rulesFrom } from './settings.service.js';

// ───────────────────────────── Pure rule evaluation ─────────────────────────────

/**
 * How many Silver counts a purchase earns.
 *  - Not eligible or below minimum → 0
 *  - Default: exactly 1, however large the amount (₹1,500 → 1)
 *  - If "multiple counts" is enabled: floor(amount / minimum), capped at maxPerPurchase
 */
export function evaluatePurchase({ finalAmount, isEligible = true }, rules) {
  const amount = Number(finalAmount);
  const min = Number(rules.minAmount);
  if (!isEligible || !Number.isFinite(amount) || !(min > 0) || amount < min) return 0;
  if (!rules.multiple) return 1;
  // Work in paise to avoid floating point surprises (e.g. 1000.00 / 500.00)
  const counts = Math.floor(Math.round(amount * 100) / Math.round(min * 100));
  return Math.max(1, Math.min(counts, rules.maxPerPurchase || 1));
}

export function isRewardLive(reward, now = new Date()) {
  if (!reward.isActive) return false;
  if (reward.startDate && new Date(reward.startDate) > now) return false;
  if (reward.endDate && new Date(reward.endDate) < now) return false;
  return true;
}

/**
 * Builds the customer's loyalty journey for display. Pure function — no DB access.
 * Milestones = live rewards + rewards this customer already holds + the Gold card.
 */
export function buildJourney({ silverCount, cardType }, rewards, customerRewards, settings, now = new Date()) {
  const held = new Map(customerRewards.map((cr) => [cr.rewardId, cr]));
  const goldThreshold = settings.goldThreshold;

  const rewardMilestones = rewards
    .filter((r) => isRewardLive(r, now) || held.has(r.id))
    .map((r) => {
      const cr = held.get(r.id);
      // A held reward keeps the milestone it was unlocked at, even if the reward was edited later
      const requiredCount = cr && cr.status !== 'REVOKED' ? cr.milestone : r.requiredCount;
      const unlocked = !!cr && cr.status !== 'REVOKED';
      return {
        type: 'REWARD',
        rewardId: r.id,
        name: r.name,
        description: r.description,
        image: r.image,
        rewardType: r.rewardType,
        rewardValue: r.rewardValue,
        requiredCount,
        unlocked,
        status: cr?.status || 'LOCKED',
        customerRewardId: cr?.id || null,
        unlockedAt: unlocked ? cr.unlockedAt : null,
        remaining: Math.max(0, requiredCount - silverCount),
      };
    });

  const isGold = cardType === 'GOLD';
  const milestones = [
    ...rewardMilestones,
    {
      type: 'GOLD',
      name: 'Gold Premium Card',
      requiredCount: goldThreshold,
      unlocked: isGold,
      status: isGold ? 'ACTIVE' : 'LOCKED',
      remaining: isGold ? 0 : Math.max(0, goldThreshold - silverCount),
    },
  ].sort((a, b) => a.requiredCount - b.requiredCount || (a.type === 'GOLD' ? 1 : -1));

  const next = milestones.find((m) => !m.unlocked) || null;
  // Absolute progress towards the next milestone (e.g. 50 / 75 → 67%), matching the "50 / 75" label
  const nextProgressPercent = next ? Math.min(100, Math.floor((silverCount / Math.max(1, next.requiredCount)) * 100)) : 100;

  return {
    silverCount,
    cardType,
    goldThreshold,
    goldProgressPercent: isGold ? 100 : Math.min(100, Math.floor((silverCount / goldThreshold) * 100)),
    remainingToGold: isGold ? 0 : Math.max(0, goldThreshold - silverCount),
    nextMilestone: next,
    nextProgressPercent,
    availableRewards: milestones.filter((m) => m.type === 'REWARD' && m.status === 'AVAILABLE').length,
    milestones,
  };
}

// ───────────────────────────── Transactional operations ─────────────────────────────

/** Row-lock the customer for the remainder of the transaction. */
export async function lockCustomer(tx, customerId) {
  const rows = await tx.$queryRaw`
    SELECT id, silver_count AS silverCount, card_type AS cardType, is_active AS isActive
    FROM customers WHERE id = ${customerId} FOR UPDATE`;
  if (!rows.length) throw AppError.notFound('Customer not found');
  const r = rows[0];
  return { id: Number(r.id), silverCount: Number(r.silverCount), cardType: r.cardType, isActive: Boolean(Number(r.isActive)) };
}

/**
 * Apply a Silver count delta and cascade milestone/Gold changes.
 * The caller must already hold the customer lock (lockCustomer) in the same `tx`.
 */
export async function changeCount(tx, { customer, delta, action, reason, purchase, admin, ip }) {
  if (!Number.isInteger(delta) || delta === 0) {
    return { previousCount: customer.silverCount, newCount: customer.silverCount, unlocked: [], revoked: [], gold: null };
  }
  const previousCount = customer.silverCount;
  const newCount = previousCount + delta;
  if (newCount < 0) throw AppError.conflict('Loyalty count cannot become negative');

  await tx.customer.update({ where: { id: customer.id }, data: { silverCount: newCount } });
  await tx.loyaltyTransaction.create({
    data: {
      customerId: customer.id,
      action: action || (delta > 0 ? 'COUNT_ADDED' : 'COUNT_REMOVED'),
      delta,
      previousCount,
      newCount,
      reason,
      purchaseId: purchase?.id ?? null,
      invoiceNumber: purchase?.invoiceNumber ?? null,
      adminId: admin?.id ?? null,
    },
  });
  customer.silverCount = newCount;

  const result = await syncMilestones(tx, { customer, previousCount, newCount, admin, ip, mode: 'incremental' });
  return { previousCount, newCount, ...result };
}

/**
 * Reconcile rewards + Gold with the customer's count.
 *  mode 'incremental' → called after a count change (see header comment for rules)
 *  mode 'full'        → explicit recalculation: make state match the count under CURRENT rules
 */
export async function syncMilestones(tx, { customer, previousCount, newCount, admin, ip, mode = 'incremental', dryRun = false }) {
  const settings = await getSettings(tx);
  const now = new Date();
  const increased = newCount > previousCount;
  const decreased = newCount < previousCount;
  const full = mode === 'full';

  const [rewards, holdings] = await Promise.all([
    tx.reward.findMany({ orderBy: { requiredCount: 'asc' } }),
    tx.customerReward.findMany({ where: { customerId: customer.id } }),
  ]);
  const heldBy = new Map(holdings.map((h) => [h.rewardId, h]));
  const unlocked = [];
  const revoked = [];
  const flagged = [];

  const ledger = (action, reason) =>
    tx.loyaltyTransaction.create({
      data: { customerId: customer.id, action, delta: 0, previousCount: newCount, newCount, reason, adminId: admin?.id ?? null },
    });

  // ── Unlock: every live reward whose requirement is met and which the customer doesn't hold yet
  if (increased || full) {
    for (const reward of rewards) {
      if (!isRewardLive(reward, now) || reward.requiredCount > newCount) continue;
      const held = heldBy.get(reward.id);
      if (held && held.status !== 'REVOKED') continue; // AVAILABLE/CLAIMED/DELIVERED/CANCELLED stay as they are
      unlocked.push({ rewardId: reward.id, name: reward.name, requiredCount: reward.requiredCount });
      if (dryRun) continue;
      if (held) {
        await tx.customerReward.update({
          where: { id: held.id },
          data: { status: 'AVAILABLE', milestone: reward.requiredCount, unlockedAt: now, notes: null },
        });
      } else {
        // @@unique([customerId, rewardId]) makes a concurrent double-unlock impossible
        await tx.customerReward.create({
          data: { customerId: customer.id, rewardId: reward.id, milestone: reward.requiredCount, status: 'AVAILABLE', unlockedAt: now },
        });
      }
      await ledger('REWARD_UNLOCKED', `Reward unlocked: ${reward.name} (${reward.requiredCount})`);
    }
  }

  // ── Revoke: unclaimed rewards whose milestone is no longer reached
  if (decreased || full) {
    for (const held of holdings) {
      const outOfReach = held.milestone > newCount;
      const crossedNow = full || held.milestone <= previousCount;
      if (!outOfReach || !crossedNow) continue;
      const reward = rewards.find((r) => r.id === held.rewardId);
      if (held.status === 'AVAILABLE') {
        revoked.push({ rewardId: held.rewardId, name: reward?.name, milestone: held.milestone });
        if (dryRun) continue;
        await tx.customerReward.update({
          where: { id: held.id },
          data: { status: 'REVOKED', notes: `Count reduced to ${newCount}, below milestone ${held.milestone}` },
        });
        await ledger('REWARD_REVOKED', `Reward revoked: ${reward?.name} — count fell below ${held.milestone}`);
      } else if (held.status === 'CLAIMED' || held.status === 'DELIVERED') {
        flagged.push({ rewardId: held.rewardId, name: reward?.name, status: held.status, milestone: held.milestone });
        if (dryRun) continue;
        await audit(tx, {
          admin,
          action: 'REWARD_REVIEW_REQUIRED',
          entity: 'customer_reward',
          entityId: held.id,
          after: { reason: `Customer count ${newCount} is below milestone ${held.milestone} of an already ${held.status.toLowerCase()} reward` },
          ip,
        });
      }
    }
  }

  // ── Gold
  let gold = null;
  const threshold = settings.goldThreshold;
  if (customer.cardType !== 'GOLD' && newCount >= threshold && (increased || full)) {
    gold = 'UPGRADED';
    if (!dryRun) await upgradeToGold(tx, customer, settings, admin, ip, newCount, now);
  } else if (customer.cardType === 'GOLD' && newCount < threshold && ((decreased && previousCount >= threshold) || full)) {
    gold = 'DOWNGRADED';
    if (!dryRun) await downgradeFromGold(tx, customer, admin, ip, newCount, threshold);
  }

  return { unlocked, revoked, flagged, gold };
}

async function upgradeToGold(tx, customer, settings, admin, ip, count, now) {
  const existing = await tx.membershipCard.findUnique({ where: { customerId: customer.id } });
  const card = existing
    ? await tx.membershipCard.update({ where: { id: existing.id }, data: { status: 'ACTIVE', upgradedAt: now, benefits: settings.goldBenefits } })
    : await tx.membershipCard.create({
        data: { customerId: customer.id, cardNumber: goldCardNumberFor(customer.id, now), cardType: 'GOLD', status: 'ACTIVE', upgradedAt: now, benefits: settings.goldBenefits },
      });
  await tx.customer.update({ where: { id: customer.id }, data: { cardType: 'GOLD' } });
  await tx.loyaltyTransaction.create({
    data: { customerId: customer.id, action: 'GOLD_UPGRADE', delta: 0, previousCount: count, newCount: count, reason: `Upgraded to Gold Premium (card ${card.cardNumber})`, adminId: admin?.id ?? null },
  });
  await audit(tx, { admin, action: 'GOLD_UPGRADE', entity: 'customer', entityId: customer.id, after: { cardNumber: card.cardNumber, count }, ip });
  customer.cardType = 'GOLD';
}

async function downgradeFromGold(tx, customer, admin, ip, count, threshold) {
  await tx.membershipCard.updateMany({ where: { customerId: customer.id }, data: { status: 'INACTIVE' } });
  await tx.customer.update({ where: { id: customer.id }, data: { cardType: 'SILVER' } });
  await tx.loyaltyTransaction.create({
    data: { customerId: customer.id, action: 'GOLD_DOWNGRADE', delta: 0, previousCount: count, newCount: count, reason: `Count fell below Gold threshold (${threshold})`, adminId: admin?.id ?? null },
  });
  await audit(tx, { admin, action: 'GOLD_DOWNGRADE', entity: 'customer', entityId: customer.id, after: { count, threshold }, ip });
  customer.cardType = 'SILVER';
}

/**
 * Explicit recalculation (admin action). Re-derives the Silver count from the purchase ledger
 * (sum of silverCountEarned on ACTIVE purchases — each purchase keeps the rules it was recorded
 * under) and then reconciles rewards + Gold against CURRENT reward/threshold settings.
 * Use dryRun to preview.
 */
export async function recalculateCustomer(customerId, { admin, ip, dryRun = false } = {}) {
  return prisma.$transaction(async (tx) => {
    const customer = await lockCustomer(tx, customerId);
    const agg = await tx.customerPurchase.aggregate({
      where: { customerId, status: 'ACTIVE' },
      _sum: { silverCountEarned: true },
    });
    const ledgerCount = agg._sum.silverCountEarned || 0;
    const previousCount = customer.silverCount;
    const countDrift = ledgerCount - previousCount;

    if (countDrift !== 0 && !dryRun) {
      await tx.customer.update({ where: { id: customerId }, data: { silverCount: ledgerCount } });
      await tx.loyaltyTransaction.create({
        data: { customerId, action: 'COUNT_ADJUSTED', delta: countDrift, previousCount, newCount: ledgerCount, reason: 'Recalculation from purchase ledger', adminId: admin?.id ?? null },
      });
      customer.silverCount = ledgerCount;
    }

    const changes = await syncMilestones(tx, { customer, previousCount, newCount: ledgerCount, admin, ip, mode: 'full', dryRun });
    const result = { customerId, dryRun, previousCount, newCount: ledgerCount, countDrift, ...changes };
    if (!dryRun && (countDrift || changes.unlocked.length || changes.revoked.length || changes.gold)) {
      await audit(tx, { admin, action: 'LOYALTY_RECALCULATED', entity: 'customer', entityId: customerId, after: result, ip });
    }
    return result;
  });
}

export async function recalculateAll({ admin, ip, dryRun = false } = {}) {
  const ids = await prisma.customer.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
  const results = [];
  for (const { id } of ids) {
    const r = await recalculateCustomer(id, { admin, ip, dryRun });
    if (r.countDrift || r.unlocked.length || r.revoked.length || r.gold || r.flagged.length) results.push(r);
  }
  return { dryRun, customersChecked: ids.length, customersChanged: results.length, results };
}

/** Rules for a new purchase, read inside the purchase's transaction. */
export async function currentRules(tx) {
  return rulesFrom(await getSettings(tx));
}
