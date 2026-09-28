import { prisma } from '../config/prisma.js';
import { purchaseWhere } from './purchase.service.js';

const MAX_ROWS = 50_000;

/**
 * Each report returns { title, columns, rows }. Columns drive both the on-screen table and
 * CSV/Excel/PDF export, so the same definition is used everywhere.
 * column.type: text | money | int | date | datetime
 */

export async function customerReport(f = {}) {
  const where = {
    ...(f.cardType && { cardType: f.cardType }),
    ...((f.from || f.to) && { registrationDate: { ...(f.from && { gte: f.from }), ...(f.to && { lte: f.to }) } }),
    ...((f.minCount !== undefined || f.maxCount !== undefined) && {
      silverCount: { ...(f.minCount !== undefined && { gte: f.minCount }), ...(f.maxCount !== undefined && { lte: f.maxCount }) },
    }),
  };
  const customers = await prisma.customer.findMany({ where, orderBy: { id: 'asc' }, take: MAX_ROWS, include: { membershipCard: true } });
  return {
    title: 'Customer Report',
    columns: [
      { key: 'customerCode', label: 'Customer ID' },
      { key: 'fullName', label: 'Customer' },
      { key: 'mobile', label: 'Mobile' },
      { key: 'totalPurchases', label: 'Total Purchases', type: 'int' },
      { key: 'totalSpent', label: 'Total Spending', type: 'money' },
      { key: 'silverCount', label: 'Silver Count', type: 'int' },
      { key: 'goldStatus', label: 'Gold Status' },
      { key: 'registrationDate', label: 'Registered', type: 'date' },
    ],
    rows: customers.map((c) => ({
      customerCode: c.customerCode,
      fullName: c.fullName,
      mobile: c.mobile,
      totalPurchases: c.totalPurchases,
      totalSpent: Number(c.totalSpent),
      silverCount: c.silverCount,
      goldStatus: c.cardType === 'GOLD' ? `Gold (${c.membershipCard?.cardNumber || '—'})` : 'Silver',
      registrationDate: c.registrationDate,
    })),
  };
}

export async function salesReport(f = {}) {
  const status = ['ACTIVE', 'CANCELLED'].includes(f.status) ? f.status : undefined;
  const purchases = await prisma.customerPurchase.findMany({
    where: purchaseWhere({ ...f, status }),
    orderBy: [{ purchaseDate: 'asc' }, { id: 'asc' }],
    take: MAX_ROWS,
    include: { customer: { select: { fullName: true, customerCode: true } }, createdBy: { select: { name: true } } },
  });
  const rows = purchases.map((p) => ({
    purchaseDate: p.purchaseDate,
    invoiceNumber: p.invoiceNumber,
    customer: `${p.customer.fullName} (${p.customer.customerCode})`,
    totalAmount: Number(p.totalAmount),
    discount: Number(p.discount),
    finalAmount: Number(p.finalAmount),
    paymentMethod: p.paymentMethod.replace('_', ' '),
    silverCountEarned: p.silverCountEarned,
    status: p.status,
    createdBy: p.createdBy.name,
  }));
  const active = rows.filter((r) => r.status === 'ACTIVE');
  return {
    title: 'Sales Report',
    columns: [
      { key: 'purchaseDate', label: 'Date', type: 'date' },
      { key: 'invoiceNumber', label: 'Invoice' },
      { key: 'customer', label: 'Customer' },
      { key: 'totalAmount', label: 'Total', type: 'money' },
      { key: 'discount', label: 'Discount', type: 'money' },
      { key: 'finalAmount', label: 'Amount', type: 'money' },
      { key: 'paymentMethod', label: 'Payment Method' },
      { key: 'silverCountEarned', label: 'Count', type: 'int' },
      { key: 'status', label: 'Status' },
      { key: 'createdBy', label: 'Added By' },
    ],
    rows,
    summary: {
      transactions: active.length,
      revenue: active.reduce((s, r) => s + r.finalAmount, 0),
      countsIssued: active.reduce((s, r) => s + r.silverCountEarned, 0),
      cancelled: rows.length - active.length,
    },
  };
}

export async function loyaltyReport(f = {}) {
  const dateFilter = f.from || f.to ? { createdAt: { ...(f.from && { gte: f.from }), ...(f.to && { lte: f.to }) } } : {};
  const [customers, earned, removed, rewards] = await Promise.all([
    prisma.customer.findMany({ where: f.cardType ? { cardType: f.cardType } : {}, orderBy: { id: 'asc' }, take: MAX_ROWS }),
    prisma.loyaltyTransaction.groupBy({ by: ['customerId'], where: { delta: { gt: 0 }, ...dateFilter }, _sum: { delta: true } }),
    prisma.loyaltyTransaction.groupBy({ by: ['customerId'], where: { delta: { lt: 0 }, ...dateFilter }, _sum: { delta: true } }),
    prisma.customerReward.groupBy({ by: ['customerId'], where: { status: { in: ['AVAILABLE', 'CLAIMED', 'DELIVERED'] } }, _count: { _all: true } }),
  ]);
  const map = (arr, fn) => new Map(arr.map((x) => [x.customerId, fn(x)]));
  const e = map(earned, (x) => x._sum.delta || 0);
  const r = map(removed, (x) => Math.abs(x._sum.delta || 0));
  const rw = map(rewards, (x) => x._count._all);
  return {
    title: 'Loyalty Report',
    columns: [
      { key: 'customerCode', label: 'Customer ID' },
      { key: 'fullName', label: 'Customer' },
      { key: 'earned', label: 'Counts Earned', type: 'int' },
      { key: 'removed', label: 'Counts Removed', type: 'int' },
      { key: 'silverCount', label: 'Current Count', type: 'int' },
      { key: 'rewards', label: 'Rewards Unlocked', type: 'int' },
      { key: 'cardType', label: 'Card' },
    ],
    rows: customers.map((c) => ({
      customerCode: c.customerCode,
      fullName: c.fullName,
      earned: e.get(c.id) || 0,
      removed: r.get(c.id) || 0,
      silverCount: c.silverCount,
      rewards: rw.get(c.id) || 0,
      cardType: c.cardType === 'GOLD' ? 'Gold Premium' : 'Silver',
    })),
  };
}

export async function rewardReport(f = {}) {
  const where = {
    ...(f.rewardId && { rewardId: f.rewardId }),
    ...(f.status && !['ACTIVE', 'CANCELLED'].includes(f.status) && { status: f.status }),
    ...((f.from || f.to) && { unlockedAt: { ...(f.from && { gte: f.from }), ...(f.to && { lte: f.to }) } }),
  };
  const claims = await prisma.customerReward.findMany({
    where,
    orderBy: { unlockedAt: 'asc' },
    take: MAX_ROWS,
    include: { reward: { select: { name: true } }, customer: { select: { fullName: true, customerCode: true } }, processedBy: { select: { name: true } } },
  });
  return {
    title: 'Reward Report',
    columns: [
      { key: 'reward', label: 'Reward' },
      { key: 'milestone', label: 'Milestone', type: 'int' },
      { key: 'customer', label: 'Customer' },
      { key: 'unlockedAt', label: 'Unlocked', type: 'date' },
      { key: 'claimedAt', label: 'Claimed', type: 'date' },
      { key: 'deliveredAt', label: 'Delivered', type: 'date' },
      { key: 'status', label: 'Status' },
      { key: 'processedBy', label: 'Processed By' },
    ],
    rows: claims.map((c) => ({
      reward: c.reward.name,
      milestone: c.milestone,
      customer: `${c.customer.fullName} (${c.customer.customerCode})`,
      unlockedAt: c.unlockedAt,
      claimedAt: c.claimedAt,
      deliveredAt: c.deliveredAt,
      status: c.status === 'AVAILABLE' ? 'PENDING' : c.status,
      processedBy: c.processedBy?.name || '',
    })),
    summary: {
      unlocked: claims.filter((c) => c.status !== 'REVOKED' && c.status !== 'CANCELLED').length,
      claimed: claims.filter((c) => c.status === 'CLAIMED').length,
      delivered: claims.filter((c) => c.status === 'DELIVERED').length,
      pending: claims.filter((c) => c.status === 'AVAILABLE').length,
    },
  };
}

export const REPORTS = { customers: customerReport, purchases: salesReport, sales: salesReport, loyalty: loyaltyReport, rewards: rewardReport };
