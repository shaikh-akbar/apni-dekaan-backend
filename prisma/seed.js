/**
 * Seed: permissions, roles, admin users, settings, rewards and 5 sample customers.
 *
 * Sample purchases go through the real PurchaseService, so loyalty ledgers, reward unlocks and
 * the Gold upgrade are produced exactly as in production. Safe to re-run: existing rows are kept.
 *
 * In production only the access-control data, settings and first Super Admin are created, the
 * password must come from SEED_ADMIN_PASSWORD, and the admin is forced to change it at first login.
 */
import bcrypt from 'bcryptjs';
import { env } from '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';
import { DEFAULT_STAFF_PERMISSIONS, PERMISSIONS, SUPER_ADMIN_ROLE } from '../src/config/permissions.js';
import { createCustomer } from '../src/services/customer.service.js';
import { cancelPurchase, createPurchase } from '../src/services/purchase.service.js';
import { setClaimStatus } from '../src/services/reward.service.js';

const DEV_ADMIN_PASSWORD = 'Admin@12345';
const DEV_STAFF_PASSWORD = 'Staff@12345';

async function seedAccessControl() {
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({ where: { key: p.key }, update: { name: p.name, group: p.group }, create: p });
  }
  const superAdmin = await prisma.role.upsert({
    where: { key: SUPER_ADMIN_ROLE },
    update: {},
    create: { key: SUPER_ADMIN_ROLE, name: 'Super Admin', description: 'Full access to everything', isSystem: true },
  });
  const staff = await prisma.role.upsert({
    where: { key: 'STAFF' },
    update: {},
    create: { key: 'STAFF', name: 'Admin / Staff', description: 'Counter staff: customers, purchases, reward hand-over', isSystem: true },
  });
  const existing = await prisma.rolePermission.count({ where: { roleId: staff.id } });
  if (!existing) {
    const perms = await prisma.permission.findMany({ where: { key: { in: DEFAULT_STAFF_PERMISSIONS } } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: staff.id, permissionId: p.id })) });
  }
  return { superAdmin, staff };
}

async function seedAdmin({ email, name, password, roleId, mustChangePassword }) {
  const found = await prisma.adminUser.findUnique({ where: { email } });
  if (found) return found;
  return prisma.adminUser.create({
    data: { email, name, roleId, passwordHash: await bcrypt.hash(password, 12), mustChangePassword },
  });
}

async function seedSettingsAndRewards() {
  await prisma.loyaltySettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      programName: 'Apni Dukaan Rewards',
      shopName: 'Apni Dukaan',
      minPurchaseAmount: 500,
      goldThreshold: 100,
      goldBenefits: '10% off every purchase\nPriority billing counter\nExclusive festive offers\nFree home delivery within city',
      contactPhone: '+91 98765 00000',
      contactEmail: 'hello@apnidukaan.example',
      contactAddress: 'Main Bazaar Road, Hyderabad 500001',
    },
  });

  const rewards = [
    { name: 'Free T-Shirt', description: 'Premium cotton Apni Dukaan T-shirt in your size.', requiredCount: 25, rewardType: 'GIFT', rewardValue: 399 },
    { name: '₹500 Shopping Voucher', description: 'Use on any purchase. Valid for 90 days after delivery.', requiredCount: 50, rewardType: 'VOUCHER', rewardValue: 500 },
    { name: 'Premium Gift Hamper', description: 'Festive hamper with dry fruits, sweets and home essentials.', requiredCount: 75, rewardType: 'GIFT', rewardValue: 1500 },
  ];
  for (const r of rewards) {
    const exists = await prisma.reward.findFirst({ where: { name: r.name } });
    if (!exists) await prisma.reward.create({ data: r });
  }
}

const PRODUCTS = [
  ['Basmati Rice 5kg', 649], ['Sunflower Oil 1L', 165], ['Toor Dal 1kg', 149], ['Atta 10kg', 489], ['Tea Powder 500g', 260],
  ['Detergent 2kg', 399], ['Sugar 5kg', 245], ['Ghee 1L', 620], ['Cashew 500g', 520], ['Shampoo 650ml', 385],
];

function basketFor(i, eligible) {
  if (!eligible) return [{ productName: PRODUCTS[i % 4 + 1][0], quantity: 1, unitPrice: PRODUCTS[i % 4 + 1][1] }];
  const a = PRODUCTS[i % PRODUCTS.length];
  const b = PRODUCTS[(i * 3 + 1) % PRODUCTS.length];
  const items = [{ productName: a[0], quantity: 1, unitPrice: a[1] }, { productName: b[0], quantity: 1 + (i % 2), unitPrice: b[1] }];
  const total = items.reduce((s, it) => s + it.quantity * it.unitPrice, 0);
  if (total < 500) items.push({ productName: 'Dry Fruits Pack', quantity: 1, unitPrice: 500 - total + 50 });
  return items;
}

const PAYMENTS = ['CASH', 'UPI', 'UPI', 'CARD', 'CASH', 'WALLET'];

async function seedSampleCustomers(admin, staff) {
  const samples = [
    { fullName: 'Rahul Sharma', mobile: '9876500001', email: 'rahul@example.com', gender: 'MALE', city: 'Hyderabad', pincode: '500001', address: '12 MG Road', counts: 10, cancel: 1, small: 3 },
    { fullName: 'Priya Patel', mobile: '9876500002', email: 'priya@example.com', gender: 'FEMALE', city: 'Hyderabad', pincode: '500034', address: '4-1 Banjara Hills', counts: 25, small: 2 },
    { fullName: 'Mohammed Akbar', mobile: '9876500003', email: 'akbar@example.com', gender: 'MALE', city: 'Secunderabad', pincode: '500003', address: '77 SD Road', counts: 50, small: 4 },
    { fullName: 'Sneha Reddy', mobile: '9876500004', email: 'sneha@example.com', gender: 'FEMALE', city: 'Hyderabad', pincode: '500081', address: 'Flat 302, Madhapur', counts: 75, small: 2 },
    { fullName: 'Ahmed Khan', mobile: '9876500005', email: 'ahmed@example.com', gender: 'MALE', city: 'Hyderabad', pincode: '500028', address: '8 Tolichowki', counts: 100, small: 5 },
  ];

  let invoice = 10001;
  const now = Date.now();
  const DAY = 86_400_000;

  for (const [idx, s] of samples.entries()) {
    if (await prisma.customer.findUnique({ where: { mobile: s.mobile } })) {
      console.log(`  • ${s.fullName} already exists — skipped`);
      continue;
    }
    const spanDays = 60 + idx * 70; // loyal customers have longer histories
    const customer = await createCustomer(
      { fullName: s.fullName, mobile: s.mobile, email: s.email, gender: s.gender, city: s.city, pincode: s.pincode, address: s.address,
        registrationDate: new Date(now - (spanDays + 3) * DAY) },
      { admin },
    );

    const eligibleCount = s.counts + (s.cancel || 0);
    const total = eligibleCount + s.small;
    // Spread the small (< ₹500, no count) purchases evenly through the history
    const plan = Array.from({ length: total }, () => true);
    for (let k = 0; k < s.small; k++) plan[Math.floor(((k + 1) * total) / (s.small + 1))] = false;
    const createdIds = [];
    for (const [i, eligible] of plan.entries()) {
      const when = new Date(now - spanDays * DAY + Math.floor(((i + 1) / (total + 1)) * spanDays * DAY) + (i % 8) * 3_600_000);
      const items = basketFor(i + idx, eligible);
      const { purchase } = await createPurchase(
        { customerId: customer.id, invoiceNumber: `INV-${invoice++}`, purchaseDate: when, paymentMethod: PAYMENTS[(i + idx) % PAYMENTS.length],
          items, discount: eligible && i % 7 === 0 ? 20 : 0, isEligible: true, notes: null },
        i % 3 === 0 ? staff : admin,
      );
      createdIds.push({ id: purchase.id, eligible, when });
    }
    if (s.cancel) {
      const victim = createdIds.filter((p) => p.eligible).at(-1);
      await cancelPurchase(victim.id, 'Customer returned all items', admin);
    }
    console.log(`  • ${s.fullName} (${customer.customerCode}) — ${s.counts} counts`);
  }

  // Backdate the ledger so history and charts look realistic
  const txs = await prisma.loyaltyTransaction.findMany({ orderBy: { id: 'asc' }, include: { purchase: { select: { purchaseDate: true, cancelledAt: true } } } });
  let last = null;
  for (const t of txs) {
    let when = last;
    if (t.purchase) when = t.action === 'COUNT_REMOVED' ? new Date(t.purchase.purchaseDate.getTime() + 2 * DAY) : t.purchase.purchaseDate;
    if (!when) continue;
    last = when;
    await prisma.loyaltyTransaction.update({ where: { id: t.id }, data: { createdAt: when } });
    if (t.action === 'REWARD_UNLOCKED' || t.action === 'GOLD_UPGRADE') {
      await prisma.customerReward.updateMany({ where: { customerId: t.customerId, unlockedAt: { gt: when }, milestone: t.newCount }, data: { unlockedAt: when } });
      if (t.action === 'GOLD_UPGRADE') await prisma.membershipCard.updateMany({ where: { customerId: t.customerId }, data: { upgradedAt: when } });
    }
  }
  await prisma.$executeRaw`
    UPDATE purchase_items pi JOIN customer_purchases p ON p.id = pi.purchase_id SET pi.created_at = p.purchase_date`;
  await prisma.$executeRaw`
    UPDATE customer_purchases SET created_at = purchase_date, updated_at = purchase_date WHERE status = 'ACTIVE'`;

  // Reward hand-over states so the claims screen has something in every column
  const claims = await prisma.customerReward.findMany({ include: { customer: true }, orderBy: [{ customerId: 'asc' }, { milestone: 'asc' }] });
  for (const c of claims) {
    if (c.status !== 'AVAILABLE') continue;
    const top = claims.filter((x) => x.customerId === c.customerId).at(-1);
    if (c.id === top.id && c.customer.silverCount < 100) continue; // newest reward stays "Available"
    if (c.customer.fullName === 'Sneha Reddy' && c.milestone === 50) {
      await setClaimStatus(c.id, 'CLAIMED', { customerId: c.customerId });
      continue;
    }
    await setClaimStatus(c.id, 'DELIVERED', { admin, notes: 'Handed over at counter' });
  }
}

async function main() {
  console.log(`Seeding (${env.nodeEnv})…`);
  const { superAdmin, staff: staffRole } = await seedAccessControl();
  await seedSettingsAndRewards();

  if (env.isProd) {
    const password = process.env.SEED_ADMIN_PASSWORD;
    if (!password || password === DEV_ADMIN_PASSWORD) {
      throw new Error('In production set SEED_ADMIN_PASSWORD to a strong, unique password before seeding.');
    }
    await seedAdmin({ email: process.env.SEED_ADMIN_EMAIL || 'admin@example.com', name: 'Super Admin', password, roleId: superAdmin.id, mustChangePassword: true });
    console.log('Production seed complete. Sample data was NOT created. The admin must change the password at first login.');
    return;
  }

  const admin = await seedAdmin({
    email: process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
    name: 'Ahmed (Owner)',
    password: process.env.SEED_ADMIN_PASSWORD || DEV_ADMIN_PASSWORD,
    roleId: superAdmin.id,
    mustChangePassword: false,
  });
  const staff = await seedAdmin({ email: 'staff@example.com', name: 'Counter Staff', password: DEV_STAFF_PASSWORD, roleId: staffRole.id, mustChangePassword: false });

  console.log('Sample customers:');
  await seedSampleCustomers(admin, staff);

  console.log('\nDone. Development logins (DEV ONLY — never use in production):');
  console.log(`  Super Admin : ${admin.email} / ${process.env.SEED_ADMIN_PASSWORD || DEV_ADMIN_PASSWORD}`);
  console.log(`  Staff       : staff@example.com / ${DEV_STAFF_PASSWORD}`);
  console.log('  Customers   : mobiles 9876500001 … 9876500005 (OTP is printed in the API console)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
