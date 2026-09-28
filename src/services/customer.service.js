import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { customerCodeFor } from '../utils/format.js';
import { paginated } from '../utils/pagination.js';
import { audit } from './audit.service.js';
import { buildJourney } from './loyalty.service.js';
import { getSettings } from './settings.service.js';

const PROFILE_FIELDS = ['fullName', 'mobile', 'email', 'dateOfBirth', 'gender', 'address', 'city', 'pincode', 'profilePhoto', 'registrationDate'];

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

async function assertMobileFree(db, mobile, exceptId) {
  const existing = await db.customer.findUnique({ where: { mobile }, select: { id: true } });
  if (existing && existing.id !== exceptId) {
    throw AppError.conflict('A customer with this mobile number is already registered', { code: 'DUPLICATE_MOBILE' });
  }
}

async function assertEmailFree(db, email, exceptId) {
  if (!email) return;
  const existing = await db.customer.findUnique({ where: { email }, select: { id: true } });
  if (existing && existing.id !== exceptId) {
    throw AppError.conflict('Another customer already uses this email address', {
      code: 'DUPLICATE_EMAIL',
      details: [{ field: 'email', message: 'Another customer already uses this email address' }],
    });
  }
}

/** Creates a customer and assigns the human-readable code (AD000001…) in the same transaction. */
export async function createCustomer(input, { admin, ip } = {}) {
  return prisma.$transaction(async (tx) => {
    await assertMobileFree(tx, input.mobile);
    await assertEmailFree(tx, input.email);
    const created = await tx.customer.create({
      data: { ...pick(input, PROFILE_FIELDS), createdById: admin?.id ?? null },
    });
    const customer = await tx.customer.update({ where: { id: created.id }, data: { customerCode: customerCodeFor(created.id) } });
    await audit(tx, {
      admin,
      customerId: admin ? undefined : customer.id,
      action: admin ? 'CUSTOMER_CREATED' : 'CUSTOMER_SELF_REGISTERED',
      entity: 'customer',
      entityId: customer.id,
      after: customer,
      ip,
    });
    return customer;
  });
}

export async function updateCustomer(id, input, { admin, customerId, ip } = {}) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.customer.findUnique({ where: { id } });
    if (!before) throw AppError.notFound('Customer not found');
    if (input.mobile && input.mobile !== before.mobile) await assertMobileFree(tx, input.mobile, id);
    if (input.email && input.email !== before.email) await assertEmailFree(tx, input.email, id);
    const fields = admin ? [...PROFILE_FIELDS, 'isActive'] : PROFILE_FIELDS.filter((f) => !['mobile', 'registrationDate'].includes(f));
    const after = await tx.customer.update({ where: { id }, data: pick(input, fields) });
    await audit(tx, { admin, customerId, action: 'CUSTOMER_UPDATED', entity: 'customer', entityId: id, before, after, ip });
    return after;
  });
}

function customerWhere(f = {}) {
  const and = [];
  if (f.q) {
    and.push({ OR: [{ fullName: { contains: f.q } }, { mobile: { contains: f.q } }, { customerCode: { contains: f.q } }, { email: { contains: f.q } }] });
  }
  if (f.cardType) and.push({ cardType: f.cardType });
  if (f.minCount !== undefined || f.maxCount !== undefined) {
    and.push({ silverCount: { ...(f.minCount !== undefined && { gte: f.minCount }), ...(f.maxCount !== undefined && { lte: f.maxCount }) } });
  }
  if (f.from || f.to) and.push({ registrationDate: { ...(f.from && { gte: f.from }), ...(f.to && { lte: f.to }) } });
  if (f.city) and.push({ city: { contains: f.city } });
  if (f.isActive !== undefined) and.push({ isActive: f.isActive });
  return and.length ? { AND: and } : {};
}

/** For the customer table: attach "next reward" so staff see what's coming for each customer. */
async function attachNextReward(customers) {
  if (!customers.length) return customers;
  const [settings, rewards, holdings] = await Promise.all([
    getSettings(),
    prisma.reward.findMany({ orderBy: { requiredCount: 'asc' } }),
    prisma.customerReward.findMany({ where: { customerId: { in: customers.map((c) => c.id) } } }),
  ]);
  const byCustomer = new Map();
  for (const h of holdings) {
    if (!byCustomer.has(h.customerId)) byCustomer.set(h.customerId, []);
    byCustomer.get(h.customerId).push(h);
  }
  return customers.map((c) => {
    const j = buildJourney(c, rewards, byCustomer.get(c.id) || [], settings);
    return {
      ...c,
      nextReward: j.nextMilestone ? { name: j.nextMilestone.name, requiredCount: j.nextMilestone.requiredCount, remaining: j.nextMilestone.remaining } : null,
      availableRewards: j.availableRewards,
    };
  });
}

export async function listCustomers(filters, page, { sort = 'createdAt', order = 'desc' } = {}) {
  const where = customerWhere(filters);
  const [items, total] = await Promise.all([
    prisma.customer.findMany({ where, orderBy: [{ [sort]: order }, { id: 'desc' }], skip: page.skip, take: page.take }),
    prisma.customer.count({ where }),
  ]);
  return paginated(await attachNextReward(items), total, page);
}

export async function getCustomer(id) {
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: { membershipCard: true, createdBy: { select: { id: true, name: true } } },
  });
  if (!customer) throw AppError.notFound('Customer not found');
  return customer;
}

/** Everything a profile page needs: details, card, journey, stats. */
export async function getCustomerOverview(id) {
  const [customer, settings, rewards, holdings, lastPurchase] = await Promise.all([
    getCustomer(id),
    getSettings(),
    prisma.reward.findMany({ orderBy: { requiredCount: 'asc' } }),
    prisma.customerReward.findMany({ where: { customerId: id } }),
    prisma.customerPurchase.findFirst({ where: { customerId: id, status: 'ACTIVE' }, orderBy: { purchaseDate: 'desc' }, select: { purchaseDate: true } }),
  ]);
  const journey = buildJourney(customer, rewards, holdings, settings);
  return {
    customer,
    journey,
    stats: {
      totalSpent: customer.totalSpent,
      totalPurchases: customer.totalPurchases,
      eligiblePurchases: customer.eligiblePurchases,
      silverCount: customer.silverCount,
      lastPurchaseDate: lastPurchase?.purchaseDate || null,
    },
  };
}

export async function customerPurchases(customerId, page, { includeCancelled = true } = {}) {
  const where = { customerId, ...(includeCancelled ? {} : { status: 'ACTIVE' }) };
  const [items, total] = await Promise.all([
    prisma.customerPurchase.findMany({
      where,
      orderBy: [{ purchaseDate: 'desc' }, { id: 'desc' }],
      skip: page.skip,
      take: page.take,
      include: { items: true, createdBy: { select: { id: true, name: true } } },
    }),
    prisma.customerPurchase.count({ where }),
  ]);
  return paginated(items, total, page);
}

export async function customerLoyalty(customerId, page) {
  const where = { customerId };
  const [items, total] = await Promise.all([
    prisma.loyaltyTransaction.findMany({
      where,
      orderBy: { id: 'desc' },
      skip: page.skip,
      take: page.take,
      include: { admin: { select: { id: true, name: true } } },
    }),
    prisma.loyaltyTransaction.count({ where }),
  ]);
  return paginated(items, total, page);
}

export async function customerRewards(customerId) {
  return prisma.customerReward.findMany({
    where: { customerId },
    orderBy: { milestone: 'asc' },
    include: { reward: true, processedBy: { select: { id: true, name: true } } },
  });
}
