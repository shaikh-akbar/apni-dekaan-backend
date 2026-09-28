// End-to-end tests for the loyalty business rules (spec §25 edge cases) through the HTTP API.
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { buy, countOf, login, newCustomer, nextInvoice, prisma, resetDb, setSettings } from './helpers.js';

let owner;

before(async () => {
  await resetDb();
  owner = await login('owner@test.local');
});
after(() => prisma.$disconnect());

describe('purchase → silver count', () => {
  let c;
  beforeEach(async () => { c = await newCustomer(owner); });

  it('1. ₹499 → no count', async () => {
    const r = await buy(owner, c.id, 499);
    assert.equal(r.status, 201);
    assert.equal(r.body.purchase.silverCountEarned, 0);
    assert.equal(await countOf(c.id), 0);
    assert.equal(await prisma.loyaltyTransaction.count({ where: { customerId: c.id } }), 0);
  });

  it('2. exactly ₹500 → +1', async () => {
    await buy(owner, c.id, 500);
    assert.equal(await countOf(c.id), 1);
    const t = await prisma.loyaltyTransaction.findFirst({ where: { customerId: c.id } });
    assert.deepEqual([t.action, t.previousCount, t.newCount, t.reason], ['COUNT_ADDED', 0, 1, 'Purchase']);
  });

  it('3. ₹999 → +1', async () => {
    await buy(owner, c.id, 999);
    assert.equal(await countOf(c.id), 1);
  });

  it('4. ₹1,500 → +1 by default, +3 only when multiple counts are enabled', async () => {
    await buy(owner, c.id, 1500);
    assert.equal(await countOf(c.id), 1);
    await setSettings({ multipleCountsPerPurchase: true });
    await buy(owner, c.id, 1500);
    assert.equal(await countOf(c.id), 4);
    await setSettings({ multipleCountsPerPurchase: false });
  });

  it('discount is applied before the eligibility check (₹520 − ₹30 = ₹490 → 0)', async () => {
    const r = await buy(owner, c.id, 520, { discount: 30 });
    assert.equal(r.body.purchase.finalAmount, 490);
    assert.equal(await countOf(c.id), 0);
  });

  it('totals are computed from items server-side', async () => {
    const r = await owner.post('/api/purchases').send({
      customerId: c.id, invoiceNumber: nextInvoice(), paymentMethod: 'UPI', totalAmount: 1,
      items: [{ productName: 'Rice', quantity: 2, unitPrice: 199.5 }, { productName: 'Oil', quantity: 1, unitPrice: 101 }],
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.purchase.totalAmount, 500);
    assert.equal(r.body.purchase.silverCountEarned, 1);
  });

  it('5. duplicate invoice → 409 and no extra count', async () => {
    const invoiceNumber = nextInvoice();
    const first = await buy(owner, c.id, 800, { invoiceNumber });
    assert.equal(first.status, 201);
    const dup = await buy(owner, c.id, 800, { invoiceNumber: invoiceNumber.toLowerCase() });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'DUPLICATE_INVOICE');
    assert.equal(await countOf(c.id), 1);
  });

  it('6. cancelling an eligible purchase reverses the count, keeps history', async () => {
    const r = await buy(owner, c.id, 700);
    await buy(owner, c.id, 700);
    assert.equal(await countOf(c.id), 2);
    const cancel = await owner.delete(`/api/purchases/${r.body.purchase.id}`).send({ reason: 'Returned' });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.purchase.status, 'CANCELLED');
    assert.equal(await countOf(c.id), 1);
    const t = await prisma.loyaltyTransaction.findFirst({ where: { customerId: c.id, action: 'COUNT_REMOVED' } });
    assert.deepEqual([t.previousCount, t.newCount, t.reason, t.invoiceNumber], [2, 1, 'Purchase Cancellation', r.body.purchase.invoiceNumber]);
    assert.ok(await prisma.customerPurchase.findUnique({ where: { id: r.body.purchase.id } }), 'purchase row is kept');
    const again = await owner.delete(`/api/purchases/${r.body.purchase.id}`).send({ reason: 'Returned' });
    assert.equal(again.status, 409, 'cannot cancel twice');
    assert.equal(await countOf(c.id), 1);
  });

  it('editing a purchase adjusts only the difference', async () => {
    const r = await buy(owner, c.id, 450);
    assert.equal(await countOf(c.id), 0);
    const up = await owner.put(`/api/purchases/${r.body.purchase.id}`).send({ totalAmount: 650, version: r.body.purchase.version });
    assert.equal(up.status, 200);
    assert.equal(await countOf(c.id), 1);
    const stale = await owner.put(`/api/purchases/${r.body.purchase.id}`).send({ totalAmount: 300, version: r.body.purchase.version });
    assert.equal(stale.status, 409, 'stale version is rejected');
    const down = await owner.put(`/api/purchases/${r.body.purchase.id}`).send({ totalAmount: 300 });
    assert.equal(down.status, 200);
    assert.equal(await countOf(c.id), 0);
    const customer = await prisma.customer.findUnique({ where: { id: c.id } });
    assert.equal(Number(customer.totalSpent), 300);
    assert.equal(customer.eligiblePurchases, 0);
  });
});

describe('milestones, rewards and gold', () => {
  let rA, rB;
  before(async () => {
    await setSettings({ goldThreshold: 4 });
    rA = (await owner.post('/api/rewards').send({ name: 'Gift A', requiredCount: 2 })).body.reward;
    rB = (await owner.post('/api/rewards').send({ name: 'Gift B', requiredCount: 3 })).body.reward;
  });
  after(async () => {
    await setSettings({ goldThreshold: 100 });
    await prisma.reward.updateMany({ data: { isActive: false } });
  });

  it('7–9. rewards unlock at each milestone, gold at threshold, never twice', async () => {
    const c = await newCustomer(owner);
    await buy(owner, c.id, 600);
    assert.equal(await prisma.customerReward.count({ where: { customerId: c.id } }), 0);

    const second = await buy(owner, c.id, 600);
    assert.deepEqual(second.body.loyalty.unlocked.map((u) => u.name), ['Gift A']);

    await buy(owner, c.id, 600);
    await buy(owner, c.id, 600);
    const cust = await prisma.customer.findUnique({ where: { id: c.id }, include: { membershipCard: true } });
    assert.equal(cust.cardType, 'GOLD');
    assert.match(cust.membershipCard.cardNumber, /^GOLD-\d{4}-\d{6}$/);
    assert.equal(cust.membershipCard.status, 'ACTIVE');

    await buy(owner, c.id, 600); // 5 — no new rewards, no second upgrade
    const holdings = await prisma.customerReward.findMany({ where: { customerId: c.id } });
    assert.deepEqual(holdings.map((h) => h.rewardId).sort(), [rA.id, rB.id].sort());
    assert.equal(await prisma.loyaltyTransaction.count({ where: { customerId: c.id, action: 'GOLD_UPGRADE' } }), 1);
    assert.equal(await prisma.loyaltyTransaction.count({ where: { customerId: c.id, action: 'REWARD_UNLOCKED' } }), 2);
  });

  it('10. a reward cannot be claimed twice (customer or admin)', async () => {
    const c = await newCustomer(owner);
    await buy(owner, c.id, 600);
    await buy(owner, c.id, 600);
    const claim = await prisma.customerReward.findFirst({ where: { customerId: c.id } });
    const results = await Promise.all([
      owner.patch(`/api/reward-claims/${claim.id}`).send({ status: 'CLAIMED' }),
      owner.patch(`/api/reward-claims/${claim.id}`).send({ status: 'CLAIMED' }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const delivered = await owner.patch(`/api/reward-claims/${claim.id}`).send({ status: 'DELIVERED' });
    assert.equal(delivered.status, 200);
    const back = await owner.patch(`/api/reward-claims/${claim.id}`).send({ status: 'CLAIMED' });
    assert.equal(back.status, 400, 'delivered is final');
  });

  it('cancellation below a milestone revokes an unclaimed reward and gold; re-earning restores them', async () => {
    const c = await newCustomer(owner);
    const buys = [];
    for (let i = 0; i < 4; i++) buys.push((await buy(owner, c.id, 600)).body.purchase);
    assert.equal((await prisma.customer.findUnique({ where: { id: c.id } })).cardType, 'GOLD');

    await owner.delete(`/api/purchases/${buys[3].id}`).send({ reason: 'Refund' });
    await owner.delete(`/api/purchases/${buys[2].id}`).send({ reason: 'Refund' });
    const cust = await prisma.customer.findUnique({ where: { id: c.id }, include: { membershipCard: true, rewards: true } });
    assert.equal(cust.silverCount, 2);
    assert.equal(cust.cardType, 'SILVER');
    assert.equal(cust.membershipCard.status, 'INACTIVE');
    assert.equal(cust.rewards.find((r) => r.rewardId === rB.id).status, 'REVOKED');
    assert.equal(cust.rewards.find((r) => r.rewardId === rA.id).status, 'AVAILABLE');

    await buy(owner, c.id, 600);
    await buy(owner, c.id, 600);
    const again = await prisma.customer.findUnique({ where: { id: c.id }, include: { membershipCard: true, rewards: true } });
    assert.equal(again.cardType, 'GOLD');
    assert.equal(again.membershipCard.cardNumber, cust.membershipCard.cardNumber, 'same card number is re-activated');
    assert.equal(again.rewards.find((r) => r.rewardId === rB.id).status, 'AVAILABLE');
    assert.equal(again.rewards.length, 2, 'no duplicate reward rows');
  });

  it('claimed rewards are not silently revoked — they are flagged for review', async () => {
    const c = await newCustomer(owner);
    const p1 = (await buy(owner, c.id, 600)).body.purchase;
    await buy(owner, c.id, 600);
    const claim = await prisma.customerReward.findFirst({ where: { customerId: c.id } });
    await owner.patch(`/api/reward-claims/${claim.id}`).send({ status: 'DELIVERED' });
    await owner.delete(`/api/purchases/${p1.id}`).send({ reason: 'Refund' });
    assert.equal((await prisma.customerReward.findUnique({ where: { id: claim.id } })).status, 'DELIVERED');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'REWARD_REVIEW_REQUIRED', entityId: String(claim.id) } }));
  });
});

describe('11. changing settings does not rewrite history', () => {
  it('old purchases keep their rule snapshot; recalculation is explicit', async () => {
    const c = await newCustomer(owner);
    const p = (await buy(owner, c.id, 600)).body.purchase;
    await owner.put('/api/settings/loyalty').send({ minPurchaseAmount: 1000 });

    assert.equal(await countOf(c.id), 1, 'existing count unchanged');
    // Editing the old purchase re-evaluates with ITS snapshot (₹500), not the new ₹1,000
    await owner.put(`/api/purchases/${p.id}`).send({ notes: 'edited', totalAmount: 650 });
    assert.equal(await countOf(c.id), 1);
    // New purchases use the new rule
    await buy(owner, c.id, 900);
    assert.equal(await countOf(c.id), 1);

    const dry = await owner.post(`/api/customers/${c.id}/loyalty/recalculate`).send({ dryRun: true });
    assert.equal(dry.status, 200);
    assert.equal(dry.body.countDrift, 0);
    await owner.put('/api/settings/loyalty').send({ minPurchaseAmount: 500 });
  });
});

describe('12–13. concurrency and atomicity', () => {
  it('parallel purchases for one customer never lose or double counts', async () => {
    const c = await newCustomer(owner);
    const results = await Promise.all(Array.from({ length: 12 }, () => buy(owner, c.id, 750)));
    assert.ok(results.every((r) => r.status === 201), JSON.stringify(results.map((r) => r.body.error)));
    assert.equal(await countOf(c.id), 12);
    const ledger = await prisma.loyaltyTransaction.findMany({ where: { customerId: c.id, action: 'COUNT_ADDED' }, orderBy: { id: 'asc' } });
    assert.deepEqual(ledger.map((t) => t.newCount), Array.from({ length: 12 }, (_, i) => i + 1), 'ledger is gap-free');
  });

  it('two admins submitting the same invoice at once → exactly one succeeds', async () => {
    const c = await newCustomer(owner);
    const staff = await login('staff@test.local');
    const invoiceNumber = nextInvoice();
    const results = await Promise.all([buy(owner, c.id, 900, { invoiceNumber }), buy(staff, c.id, 900, { invoiceNumber }), buy(owner, c.id, 900, { invoiceNumber })]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
    assert.equal(await countOf(c.id), 1);
    assert.equal(await prisma.customerPurchase.count({ where: { invoiceNumber: invoiceNumber.toUpperCase() } }), 1);
  });

  it('simultaneous cancel + edit of the same purchase stay consistent', async () => {
    const c = await newCustomer(owner);
    const p = (await buy(owner, c.id, 800)).body.purchase;
    await buy(owner, c.id, 800);
    const results = await Promise.all([
      owner.delete(`/api/purchases/${p.id}`).send({ reason: 'Refund' }),
      owner.delete(`/api/purchases/${p.id}`).send({ reason: 'Refund' }),
      owner.put(`/api/purchases/${p.id}`).send({ totalAmount: 100 }),
    ]);
    assert.ok(results.every((r) => [200, 400, 409].includes(r.status)), JSON.stringify(results.map((r) => r.status)));
    assert.equal(results.filter((r) => r.status === 200 && r.body.purchase.status === 'CANCELLED').length, 1, 'cancelled exactly once');
    assert.equal(await countOf(c.id), 1, 'only the cancelled purchase lost its count');
    const cust = await prisma.customer.findUnique({ where: { id: c.id } });
    assert.equal(Number(cust.totalSpent), 800);
    assert.equal(cust.totalPurchases, 1);
  });

  it('a failed purchase leaves nothing behind', async () => {
    const c = await newCustomer(owner);
    await prisma.customer.update({ where: { id: c.id }, data: { isActive: false } });
    const r = await buy(owner, c.id, 900);
    assert.equal(r.status, 400);
    assert.equal(await prisma.customerPurchase.count({ where: { customerId: c.id } }), 0);
    assert.equal(await prisma.loyaltyTransaction.count({ where: { customerId: c.id } }), 0);
  });
});

describe('validation', () => {
  it('rejects bad input on the server', async () => {
    const c = await newCustomer(owner);
    const cases = [
      [{ customerId: c.id, invoiceNumber: 'X1', totalAmount: -5, paymentMethod: 'CASH' }, 'negative amount'],
      [{ customerId: c.id, invoiceNumber: 'X2', totalAmount: 0, paymentMethod: 'CASH' }, 'zero amount'],
      [{ customerId: c.id, invoiceNumber: 'X3', totalAmount: 900, paymentMethod: 'BITCOIN' }, 'bad payment method'],
      [{ customerId: c.id, invoiceNumber: '', totalAmount: 900, paymentMethod: 'CASH' }, 'blank invoice'],
      [{ customerId: c.id, invoiceNumber: 'X4', totalAmount: 900, discount: 1000, paymentMethod: 'CASH' }, 'discount > total'],
      [{ customerId: 999999, invoiceNumber: 'X5', totalAmount: 900, paymentMethod: 'CASH' }, 'unknown customer'],
    ];
    for (const [body, label] of cases) {
      const r = await owner.post('/api/purchases').send(body);
      assert.ok([400, 404].includes(r.status), `${label}: got ${r.status}`);
    }
    const dupMobile = await owner.post('/api/customers').send({ fullName: 'Dup', mobile: c.mobile });
    assert.equal(dupMobile.status, 409);
    const badMobile = await owner.post('/api/customers').send({ fullName: 'Bad', mobile: '12345' });
    assert.equal(badMobile.status, 400);
    const badReward = await owner.post('/api/rewards').send({ name: 'Zero', requiredCount: 0 });
    assert.equal(badReward.status, 400);
  });
});
