import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import { buy, login, newCustomer, prisma, resetDb } from './helpers.js';

let owner;
before(async () => {
  await resetDb();
  owner = await login('owner@test.local');
});
after(() => prisma.$disconnect());

it('keeps mixed-case customer and invoice searches working', async () => {
  const customer = await newCustomer(owner, { fullName: 'MixedCase Shopper', city: 'Mumbai' });
  const purchase = await buy(owner, customer.id, 500, { invoiceNumber: 'Pg-Search-001' });
  assert.equal(purchase.status, 201, JSON.stringify(purchase.body));
  const customers = await owner.get('/api/customers').query({ q: 'mixedcase', city: 'mUMbAI' });
  assert.equal(customers.status, 200);
  assert.ok(customers.body.items.some((row) => row.id === customer.id));
  const purchases = await owner.get('/api/purchases').query({ q: 'pg-search' });
  assert.equal(purchases.status, 200);
  assert.ok(purchases.body.items.some((row) => row.id === purchase.body.purchase.id));
});

it('returns dashboard daily totals as numbers and local calendar dates', async () => {
  // Isolate chart totals from other test fixtures.
  await resetDb();
  owner = await login('owner@test.local');
  const today = new Date();
  const customer = await newCustomer(owner, { registrationDate: today.toISOString() });
  const purchase = await buy(owner, customer.id, 1234.56, { purchaseDate: today.toISOString() });
  assert.equal(purchase.status, 201, JSON.stringify(purchase.body));
  const response = await owner.get('/api/dashboard').query({ days: 7 });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const point = response.body.series.find((row) => row.date === key);
  assert.deepEqual(point, { date: key, purchases: 1, revenue: 1234.56, counts: 1, newCustomers: 1 });
});

it('enables RLS on every application table for Supabase browser isolation', async () => {
  const rows = await prisma.$queryRaw`
    SELECT tablename, rowsecurity FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
  assert.equal(rows.length, 14);
  assert.ok(rows.every((row) => row.rowsecurity));
});
