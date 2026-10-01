import { prisma } from '../config/prisma.js';
import { getSettings } from './settings.service.js';

/** Server's UTC offset as '+05:30' so daily charts group by the shop's local day. */
function tzOffset() {
  const m = -new Date().getTimezoneOffset();
  const a = Math.abs(m);
  return `${m >= 0 ? '+' : '-'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

const localKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function adminDashboard({ days = 30 } = {}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const since = new Date(today);
  since.setDate(since.getDate() - (days - 1));
  const active = { status: 'ACTIVE' };
  const tz = tzOffset();

  const [
    totalCustomers, goldMembers, purchaseAgg, todayAgg, countsIssued, rewardStatus,
    recentCustomers, recentPurchases, daily, countGroups, newCustomersDaily, settings, rewards,
  ] = await Promise.all([
    prisma.customer.count(),
    prisma.customer.count({ where: { cardType: 'GOLD' } }),
    prisma.customerPurchase.aggregate({ where: active, _count: { _all: true }, _sum: { finalAmount: true } }),
    prisma.customerPurchase.aggregate({ where: { ...active, purchaseDate: { gte: today } }, _count: { _all: true }, _sum: { finalAmount: true } }),
    prisma.customerPurchase.aggregate({ where: active, _sum: { silverCountEarned: true } }),
    prisma.customerReward.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.customer.findMany({
      orderBy: { id: 'desc' },
      take: 6,
      select: { id: true, customerCode: true, fullName: true, mobile: true, cardType: true, silverCount: true, registrationDate: true },
    }),
    prisma.customerPurchase.findMany({
      orderBy: { id: 'desc' },
      take: 8,
      include: { customer: { select: { id: true, fullName: true, customerCode: true } }, createdBy: { select: { name: true } } },
    }),
    prisma.$queryRaw`
      SELECT TO_CHAR(purchase_date + CAST(${tz} AS interval), 'YYYY-MM-DD') AS day,
             COUNT(*) AS purchases, COALESCE(SUM(final_amount), 0) AS revenue, COALESCE(SUM(silver_count_earned), 0) AS counts
      FROM customer_purchases
      WHERE status = 'ACTIVE' AND purchase_date >= ${since}
      GROUP BY day ORDER BY day`,
    prisma.customer.groupBy({ by: ['silverCount'], _count: { _all: true } }),
    prisma.$queryRaw`
      SELECT TO_CHAR(registration_date + CAST(${tz} AS interval), 'YYYY-MM-DD') AS day, COUNT(*) AS customers
      FROM customers WHERE registration_date >= ${since}
      GROUP BY day ORDER BY day`,
    getSettings(),
    prisma.reward.findMany({ where: { isActive: true }, select: { requiredCount: true } }),
  ]);

  const statusCount = Object.fromEntries(rewardStatus.map((r) => [r.status, r._count._all]));
  const rewardsUnlocked = ['AVAILABLE', 'CLAIMED', 'DELIVERED'].reduce((s, k) => s + (statusCount[k] || 0), 0);

  // One point per day, gaps filled with zeros
  const byDay = new Map(daily.map((r) => [r.day, r]));
  const newByDay = new Map(newCustomersDaily.map((r) => [r.day, Number(r.customers)]));
  const series = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    const k = localKey(d);
    const r = byDay.get(k);
    series.push({
      date: k,
      purchases: Number(r?.purchases || 0),
      revenue: Number(r?.revenue || 0),
      counts: Number(r?.counts || 0),
      newCustomers: newByDay.get(k) || 0,
    });
  }

  // Customer distribution across the CONFIGURED milestones (e.g. 0–24, 25–49 … 100+)
  const edges = [...new Set([0, ...rewards.map((r) => r.requiredCount), settings.goldThreshold])].sort((a, b) => a - b);
  const countDistribution = edges.map((lo, i) => {
    const hi = edges[i + 1];
    const customers = countGroups
      .filter((g) => g.silverCount >= lo && (hi === undefined || g.silverCount < hi))
      .reduce((s, g) => s + g._count._all, 0);
    return { bucket: hi === undefined ? `${lo}+` : `${lo}–${hi - 1}`, customers };
  });

  return {
    totals: {
      totalCustomers,
      goldMembers,
      silverMembers: totalCustomers - goldMembers,
      totalPurchases: purchaseAgg._count._all,
      totalRevenue: Number(purchaseAgg._sum.finalAmount || 0),
      silverCountsIssued: countsIssued._sum.silverCountEarned || 0,
      rewardsUnlocked,
      rewardsClaimed: (statusCount.CLAIMED || 0) + (statusCount.DELIVERED || 0),
      rewardsDelivered: statusCount.DELIVERED || 0,
      rewardsPending: statusCount.AVAILABLE || 0,
      todayPurchases: todayAgg._count._all,
      todayRevenue: Number(todayAgg._sum.finalAmount || 0),
    },
    rewardStatus: statusCount,
    series,
    countDistribution,
    recentCustomers,
    recentPurchases,
  };
}
