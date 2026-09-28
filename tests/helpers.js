// Integration test helpers. Tests run against DATABASE_URL from .env.test (a throwaway DB).
process.env.NODE_ENV = 'test';

import { execSync } from 'node:child_process';
import bcrypt from 'bcryptjs';
import request from 'supertest';

const { env } = await import('../src/config/env.js');
const { prisma } = await import('../src/config/prisma.js');
const { createApp } = await import('../src/app.js');
const { PERMISSIONS, DEFAULT_STAFF_PERMISSIONS } = await import('../src/config/permissions.js');

export { prisma, env };
export const app = createApp();

if (!process.env.DATABASE_URL?.includes('_test')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

let prepared = false;
/** Fresh schema + minimal fixtures (roles, admins, settings). */
export async function resetDb() {
  if (!prepared) {
    // Non-destructive: creates the test DB if needed and applies pending migrations
    execSync('npx prisma migrate deploy', { stdio: 'ignore', env: { ...process.env } });
    prepared = true;
  }
  // Truncate in FK-safe order
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of ['audit_logs', 'loyalty_transactions', 'customer_rewards', 'membership_cards', 'purchase_items', 'customer_purchases',
    'otp_codes', 'customers', 'rewards', 'loyalty_settings', 'role_permissions', 'admin_users', 'roles', 'permissions']) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${t}`);
  }
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');

  await prisma.permission.createMany({ data: PERMISSIONS });
  const superRole = await prisma.role.create({ data: { key: 'SUPER_ADMIN', name: 'Super Admin', isSystem: true } });
  const staffRole = await prisma.role.create({ data: { key: 'STAFF', name: 'Staff', isSystem: true } });
  const perms = await prisma.permission.findMany({ where: { key: { in: DEFAULT_STAFF_PERMISSIONS } } });
  await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: staffRole.id, permissionId: p.id })) });
  const hash = await bcrypt.hash('Passw0rd!', 4);
  await prisma.adminUser.create({ data: { name: 'Owner', email: 'owner@test.local', passwordHash: hash, roleId: superRole.id } });
  await prisma.adminUser.create({ data: { name: 'Staff', email: 'staff@test.local', passwordHash: hash, roleId: staffRole.id } });
  await prisma.loyaltySettings.create({ data: { id: 1, minPurchaseAmount: 500, goldThreshold: 100 } });
}

export async function login(email) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/admin/login').send({ email, password: 'Passw0rd!' });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

let mobileSeq = 9000000000;
export async function newCustomer(agent, overrides = {}) {
  mobileSeq += 1;
  const res = await agent.post('/api/customers').send({ fullName: 'Test Customer', mobile: String(mobileSeq), email: `c${mobileSeq}@test.local`, ...overrides });
  if (res.status !== 201) throw new Error(`customer create failed: ${JSON.stringify(res.body)}`);
  return res.body.customer;
}

let invoiceSeq = 1;
export const nextInvoice = () => `T-${Date.now().toString(36)}-${invoiceSeq++}`;

export function buy(agent, customerId, amount, extra = {}) {
  return agent.post('/api/purchases').send({ customerId, invoiceNumber: nextInvoice(), totalAmount: amount, paymentMethod: 'CASH', ...extra });
}

export async function countOf(customerId) {
  return (await prisma.customer.findUnique({ where: { id: customerId } })).silverCount;
}

export async function setSettings(data) {
  await prisma.loyaltySettings.update({ where: { id: 1 }, data });
}
