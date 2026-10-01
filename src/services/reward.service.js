import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { paginated } from '../utils/pagination.js';
import { audit } from './audit.service.js';

export async function listRewards({ includeInactive = true } = {}) {
  const rewards = await prisma.reward.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ requiredCount: 'asc' }, { id: 'asc' }],
  });
  const counts = await prisma.customerReward.groupBy({ by: ['rewardId', 'status'], _count: { _all: true } });
  return rewards.map((r) => {
    const stats = { AVAILABLE: 0, CLAIMED: 0, DELIVERED: 0, CANCELLED: 0, REVOKED: 0 };
    for (const c of counts) if (c.rewardId === r.id) stats[c.status] = c._count._all;
    return { ...r, stats };
  });
}

export async function getReward(id) {
  const r = await prisma.reward.findUnique({ where: { id } });
  if (!r) throw AppError.notFound('Reward not found');
  return r;
}

/**
 * Creating or editing a reward never touches rewards customers already hold: a held reward keeps
 * its milestone snapshot. New/changed milestones apply as customers' counts next change, or
 * immediately for everyone via the explicit loyalty recalculation action.
 */
export async function createReward(data, admin, ip) {
  return prisma.$transaction(async (tx) => {
    const reward = await tx.reward.create({ data });
    await audit(tx, { admin, action: 'REWARD_CREATED', entity: 'reward', entityId: reward.id, after: reward, ip });
    return reward;
  });
}

export async function updateReward(id, data, admin, ip) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.reward.findUnique({ where: { id } });
    if (!before) throw AppError.notFound('Reward not found');
    const start = data.startDate !== undefined ? data.startDate : before.startDate;
    const end = data.endDate !== undefined ? data.endDate : before.endDate;
    if (start && end && new Date(end) < new Date(start)) throw AppError.badRequest('End date must be after start date');
    const after = await tx.reward.update({ where: { id }, data });
    await audit(tx, { admin, action: 'REWARD_UPDATED', entity: 'reward', entityId: id, before, after, ip });
    return after;
  });
}

// ───────────────────────────── Claims ─────────────────────────────

/**
 * Allowed status transitions. Each transition is applied with a conditional update
 * (WHERE status = <from>) so two people processing the same claim cannot both succeed.
 */
const TRANSITIONS = {
  AVAILABLE: ['CLAIMED', 'DELIVERED', 'CANCELLED'],
  CLAIMED: ['DELIVERED', 'CANCELLED', 'AVAILABLE'],
  DELIVERED: [],
  CANCELLED: ['AVAILABLE'],
  REVOKED: [],
};

export async function setClaimStatus(customerRewardId, status, { admin, customerId, notes, ip }) {
  return prisma.$transaction(async (tx) => {
    // Row lock first: concurrent processors of the same claim queue up here instead of racing
    await tx.$queryRaw`SELECT id FROM customer_rewards WHERE id = ${customerRewardId} FOR UPDATE`;
    const current = await tx.customerReward.findUnique({
      where: { id: customerRewardId },
      include: { customer: { select: { silverCount: true } }, reward: { select: { name: true } } },
    });
    if (!current || (customerId && current.customerId !== customerId)) throw AppError.notFound('Reward not found');
    if (current.status === status) {
      throw AppError.conflict(`Reward is already ${status.toLowerCase()}`, { code: 'ALREADY_IN_STATUS' });
    }
    if (!TRANSITIONS[current.status].includes(status)) {
      throw AppError.badRequest(`Cannot change a ${current.status.toLowerCase()} reward to ${status.toLowerCase()}`);
    }
    if (status === 'AVAILABLE' && current.customer.silverCount < current.milestone) {
      throw AppError.badRequest('Customer no longer meets the milestone for this reward');
    }

    const now = new Date();
    const data = {
      status,
      processedById: admin?.id ?? current.processedById,
      ...(notes !== undefined && { notes }),
      ...(status === 'CLAIMED' && { claimedAt: now }),
      ...(status === 'DELIVERED' && { deliveredAt: now, claimedAt: current.claimedAt || now }),
      ...(status === 'CANCELLED' && { cancelledAt: now }),
      ...(status === 'AVAILABLE' && { claimedAt: null, cancelledAt: null }),
    };
    const { count } = await tx.customerReward.updateMany({ where: { id: customerRewardId, status: current.status }, data });
    if (count !== 1) throw AppError.conflict('This reward was just processed by someone else. Refresh and try again.', { code: 'WRITE_CONFLICT' });

    const after = await tx.customerReward.findUnique({ where: { id: customerRewardId } });
    await audit(tx, {
      admin,
      customerId,
      action: `REWARD_${status}`,
      entity: 'customer_reward',
      entityId: customerRewardId,
      before: { status: current.status },
      after,
      ip,
    });
    return after;
  });
}

export async function listClaims(f, page) {
  const and = [];
  if (f.status) and.push({ status: f.status });
  if (f.rewardId) and.push({ rewardId: f.rewardId });
  if (f.customerId) and.push({ customerId: f.customerId });
  if (f.q) and.push({ customer: { OR: [{ fullName: { contains: f.q, mode: 'insensitive' } }, { mobile: { contains: f.q, mode: 'insensitive' } }, { customerCode: { contains: f.q, mode: 'insensitive' } }] } });
  if (f.from || f.to) and.push({ unlockedAt: { ...(f.from && { gte: f.from }), ...(f.to && { lte: f.to }) } });
  const where = and.length ? { AND: and } : {};
  const [items, total] = await Promise.all([
    prisma.customerReward.findMany({
      where,
      orderBy: { unlockedAt: 'desc' },
      skip: page.skip,
      take: page.take,
      include: {
        reward: { select: { id: true, name: true, rewardType: true, image: true } },
        customer: { select: { id: true, customerCode: true, fullName: true, mobile: true, silverCount: true } },
        processedBy: { select: { id: true, name: true } },
      },
    }),
    prisma.customerReward.count({ where }),
  ]);
  return paginated(items, total, page);
}
