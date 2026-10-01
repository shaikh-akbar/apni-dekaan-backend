import { prisma, Prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { paginated } from '../utils/pagination.js';
import { audit } from './audit.service.js';
import { changeCount, currentRules, evaluatePurchase, lockCustomer } from './loyalty.service.js';

const TX_OPTS = { maxWait: 10_000, timeout: 20_000 };

// Money is handled in integer paise to avoid floating point drift.
const toPaise = (v) => Math.round(Number(v) * 100);
const fromPaise = (p) => (p / 100).toFixed(2);

/** Normalise items and compute totals server-side. Items are optional. */
function computeAmounts({ items = [], totalAmount, discount = 0 }) {
  const normItems = items.map((it) => {
    const lineTotal = toPaise(it.unitPrice) * it.quantity;
    return { productName: it.productName, quantity: it.quantity, unitPrice: fromPaise(toPaise(it.unitPrice)), lineTotal: fromPaise(lineTotal), _p: lineTotal };
  });
  const totalP = normItems.length ? normItems.reduce((s, it) => s + it._p, 0) : toPaise(totalAmount);
  const discountP = toPaise(discount || 0);
  if (!(totalP > 0)) throw AppError.badRequest('Total amount must be greater than zero');
  if (discountP < 0 || discountP > totalP) throw AppError.badRequest('Discount must be between 0 and the total amount');
  return {
    items: normItems.map(({ _p, ...rest }) => rest),
    totalAmount: fromPaise(totalP),
    discount: fromPaise(discountP),
    finalAmount: fromPaise(totalP - discountP),
  };
}

const purchaseInclude = {
  customer: { select: { id: true, customerCode: true, fullName: true, mobile: true } },
  items: true,
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
  cancelledBy: { select: { id: true, name: true } },
};

async function assertInvoiceFree(tx, invoiceNumber, exceptId) {
  const existing = await tx.customerPurchase.findUnique({ where: { invoiceNumber }, select: { id: true, customerId: true } });
  if (existing && existing.id !== exceptId) {
    throw AppError.conflict(`Invoice ${invoiceNumber} has already been recorded`, { code: 'DUPLICATE_INVOICE' });
  }
}

/**
 * Locking read of a purchase's owner, then lock the customer. Must be the FIRST statements in
 * the transaction: no plain (snapshot) read may happen before the locks, or later reads would
 * see a stale snapshot under REPEATABLE READ. Lock order is always purchase → customer.
 */
async function lockPurchaseAndCustomer(tx, id) {
  const rows = await tx.$queryRaw`SELECT customer_id AS "customerId" FROM customer_purchases WHERE id = ${id} FOR UPDATE`;
  if (!rows.length) throw AppError.notFound('Purchase not found');
  return lockCustomer(tx, Number(rows[0].customerId));
}

function isUniqueViolation(err) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Create a purchase and apply loyalty in ONE transaction:
 * lock customer → check invoice → save purchase → update totals → LoyaltyService.changeCount → audit.
 */
export async function createPurchase(input, admin, ip) {
  const amounts = computeAmounts(input);
  try {
    return await prisma.$transaction(async (tx) => {
      const customer = await lockCustomer(tx, input.customerId);
      if (!customer.isActive) throw AppError.badRequest('Customer account is inactive');
      await assertInvoiceFree(tx, input.invoiceNumber);

      const rules = await currentRules(tx);
      const isEligible = input.isEligible ?? true;
      const earned = evaluatePurchase({ finalAmount: amounts.finalAmount, isEligible }, rules);

      const purchase = await tx.customerPurchase.create({
        data: {
          customerId: customer.id,
          invoiceNumber: input.invoiceNumber,
          purchaseDate: input.purchaseDate || new Date(),
          totalAmount: amounts.totalAmount,
          discount: amounts.discount,
          finalAmount: amounts.finalAmount,
          paymentMethod: input.paymentMethod,
          isEligible,
          silverCountEarned: earned,
          ruleMinAmount: rules.minAmount,
          ruleMultiple: rules.multiple,
          notes: input.notes || null,
          createdById: admin.id,
          items: amounts.items.length ? { create: amounts.items } : undefined,
        },
      });

      await tx.customer.update({
        where: { id: customer.id },
        data: {
          totalSpent: { increment: amounts.finalAmount },
          totalPurchases: { increment: 1 },
          ...(earned > 0 && { eligiblePurchases: { increment: 1 } }),
        },
      });

      const loyalty = await changeCount(tx, { customer, delta: earned, action: 'COUNT_ADDED', reason: 'Purchase', purchase, admin, ip });
      await audit(tx, { admin, action: 'PURCHASE_CREATED', entity: 'purchase', entityId: purchase.id, after: { ...purchase, items: amounts.items }, ip });

      const full = await tx.customerPurchase.findUnique({ where: { id: purchase.id }, include: purchaseInclude });
      return { purchase: full, loyalty };
    }, TX_OPTS);
  } catch (err) {
    // Two admins racing with the same invoice: the unique index rejects the second one
    if (isUniqueViolation(err)) throw AppError.conflict(`Invoice ${input.invoiceNumber} has already been recorded`, { code: 'DUPLICATE_INVOICE' });
    throw err;
  }
}

/**
 * Edit a purchase. The loyalty count is re-evaluated using the rules snapshot stored on the
 * purchase (not today's settings) and only the difference is applied, via LoyaltyService.
 * `version` gives optimistic concurrency: a stale form cannot overwrite a newer edit.
 */
export async function updatePurchase(id, input, admin, ip) {
  try {
    return await prisma.$transaction(async (tx) => {
      const customer = await lockPurchaseAndCustomer(tx, id);
      const before = await tx.customerPurchase.findUnique({ where: { id }, include: { items: true } });
      if (before.status === 'CANCELLED') throw AppError.badRequest('Cancelled purchases cannot be edited');
      if (input.version !== undefined && input.version !== before.version) {
        throw AppError.conflict('This purchase was modified by someone else. Reload and try again.', { code: 'STALE_VERSION' });
      }
      if (input.invoiceNumber && input.invoiceNumber !== before.invoiceNumber) await assertInvoiceFree(tx, input.invoiceNumber, id);

      const replaceItems = Array.isArray(input.items);
      const amounts = computeAmounts({
        items: replaceItems ? input.items : before.items.map((i) => ({ productName: i.productName, quantity: i.quantity, unitPrice: i.unitPrice })),
        totalAmount: input.totalAmount ?? before.totalAmount,
        discount: input.discount ?? before.discount,
      });
      const isEligible = input.isEligible ?? before.isEligible;
      const snapshotRules = { minAmount: Number(before.ruleMinAmount), multiple: before.ruleMultiple, maxPerPurchase: (await currentRules(tx)).maxPerPurchase };
      const earned = evaluatePurchase({ finalAmount: amounts.finalAmount, isEligible }, snapshotRules);
      const delta = earned - before.silverCountEarned;
      const spentDelta = (toPaise(amounts.finalAmount) - toPaise(before.finalAmount)) / 100;

      if (replaceItems) await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
      const updated = await tx.customerPurchase.update({
        where: { id },
        data: {
          invoiceNumber: input.invoiceNumber ?? before.invoiceNumber,
          purchaseDate: input.purchaseDate ?? before.purchaseDate,
          paymentMethod: input.paymentMethod ?? before.paymentMethod,
          notes: input.notes !== undefined ? input.notes || null : before.notes,
          totalAmount: amounts.totalAmount,
          discount: amounts.discount,
          finalAmount: amounts.finalAmount,
          isEligible,
          silverCountEarned: earned,
          updatedById: admin.id,
          version: { increment: 1 },
          ...(replaceItems && amounts.items.length && { items: { create: amounts.items } }),
        },
      });

      const wasEligible = before.silverCountEarned > 0;
      const nowEligible = earned > 0;
      await tx.customer.update({
        where: { id: customer.id },
        data: {
          ...(spentDelta !== 0 && { totalSpent: { increment: spentDelta } }),
          ...(wasEligible !== nowEligible && { eligiblePurchases: { increment: nowEligible ? 1 : -1 } }),
        },
      });

      const loyalty = await changeCount(tx, {
        customer,
        delta,
        action: 'COUNT_ADJUSTED',
        reason: `Purchase edited (${before.silverCountEarned} → ${earned})`,
        purchase: updated,
        admin,
        ip,
      });
      await audit(tx, { admin, action: 'PURCHASE_UPDATED', entity: 'purchase', entityId: id, before, after: updated, ip });

      const full = await tx.customerPurchase.findUnique({ where: { id }, include: purchaseInclude });
      return { purchase: full, loyalty };
    }, TX_OPTS);
  } catch (err) {
    if (isUniqueViolation(err)) throw AppError.conflict(`Invoice ${input.invoiceNumber} has already been recorded`, { code: 'DUPLICATE_INVOICE' });
    throw err;
  }
}

/** Cancel (soft-delete) a purchase and reverse the counts it earned. History is kept. */
export async function cancelPurchase(id, reason, admin, ip) {
  return prisma.$transaction(async (tx) => {
    const customer = await lockPurchaseAndCustomer(tx, id);
    const before = await tx.customerPurchase.findUnique({ where: { id } });
    if (before.status === 'CANCELLED') throw AppError.conflict('Purchase is already cancelled', { code: 'ALREADY_CANCELLED' });

    const cancelled = await tx.customerPurchase.update({
      where: { id },
      data: { status: 'CANCELLED', cancelReason: reason, cancelledAt: new Date(), cancelledById: admin.id, version: { increment: 1 } },
    });
    await tx.customer.update({
      where: { id: customer.id },
      data: {
        totalSpent: { decrement: before.finalAmount },
        totalPurchases: { decrement: 1 },
        ...(before.silverCountEarned > 0 && { eligiblePurchases: { decrement: 1 } }),
      },
    });

    const loyalty = await changeCount(tx, {
      customer,
      delta: -before.silverCountEarned,
      action: 'COUNT_REMOVED',
      reason: 'Purchase Cancellation',
      purchase: cancelled,
      admin,
      ip,
    });
    await audit(tx, { admin, action: 'PURCHASE_CANCELLED', entity: 'purchase', entityId: id, before, after: { status: 'CANCELLED', reason }, ip });

    const full = await tx.customerPurchase.findUnique({ where: { id }, include: purchaseInclude });
    return { purchase: full, loyalty };
  }, TX_OPTS);
}

export function purchaseWhere(f = {}) {
  const and = [];
  if (f.q) and.push({ OR: [{ invoiceNumber: { contains: f.q, mode: 'insensitive' } }, { customer: { fullName: { contains: f.q, mode: 'insensitive' } } }, { customer: { mobile: { contains: f.q, mode: 'insensitive' } } }, { customer: { customerCode: { contains: f.q, mode: 'insensitive' } } }] });
  if (f.invoice) and.push({ invoiceNumber: { contains: f.invoice, mode: 'insensitive' } });
  if (f.customerId) and.push({ customerId: f.customerId });
  if (f.paymentMethod) and.push({ paymentMethod: f.paymentMethod });
  if (f.status) and.push({ status: f.status });
  if (f.eligible !== undefined) and.push(f.eligible ? { silverCountEarned: { gt: 0 } } : { silverCountEarned: 0 });
  if (f.from || f.to) and.push({ purchaseDate: { ...(f.from && { gte: f.from }), ...(f.to && { lte: f.to }) } });
  if (f.minAmount !== undefined || f.maxAmount !== undefined) {
    and.push({ finalAmount: { ...(f.minAmount !== undefined && { gte: f.minAmount }), ...(f.maxAmount !== undefined && { lte: f.maxAmount }) } });
  }
  return and.length ? { AND: and } : {};
}

export async function listPurchases(filters, page, { sort = 'purchaseDate', order = 'desc' } = {}) {
  const where = purchaseWhere(filters);
  const [items, total] = await Promise.all([
    prisma.customerPurchase.findMany({
      where,
      include: { customer: purchaseInclude.customer, createdBy: purchaseInclude.createdBy },
      orderBy: [{ [sort]: order }, { id: 'desc' }],
      skip: page.skip,
      take: page.take,
    }),
    prisma.customerPurchase.count({ where }),
  ]);
  return paginated(items, total, page);
}

export async function getPurchase(id) {
  const p = await prisma.customerPurchase.findUnique({
    where: { id },
    include: {
      ...purchaseInclude,
      loyaltyTransactions: { orderBy: { id: 'asc' }, include: { admin: { select: { id: true, name: true } } } },
    },
  });
  if (!p) throw AppError.notFound('Purchase not found');
  return p;
}
