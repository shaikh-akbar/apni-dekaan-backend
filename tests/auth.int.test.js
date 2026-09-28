// Authentication, RBAC and customer data isolation.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { app, buy, login, newCustomer, prisma, resetDb } from './helpers.js';

let owner;
before(async () => {
  await resetDb();
  owner = await login('owner@test.local');
});
after(() => prisma.$disconnect());

async function customerSession(login) {
  const agent = request.agent(app);
  const otp = await agent.post('/api/auth/otp').send({ login });
  assert.equal(otp.status, 200, JSON.stringify(otp.body));
  const res = await agent.post('/api/auth/login').send({ login, otp: otp.body.devOtp });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return agent;
}

describe('admin auth', () => {
  it('rejects bad credentials without revealing which part was wrong', async () => {
    const a = await request(app).post('/api/auth/admin/login').send({ email: 'owner@test.local', password: 'nope' });
    const b = await request(app).post('/api/auth/admin/login').send({ email: 'ghost@test.local', password: 'nope' });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.body.error.message, b.body.error.message);
  });

  it('sets an httpOnly cookie and never returns the password hash', async () => {
    const res = await request(app).post('/api/auth/admin/login').send({ email: 'owner@test.local', password: 'Passw0rd!' });
    assert.match(res.headers['set-cookie'][0], /HttpOnly/i);
    assert.ok(!JSON.stringify(res.body).includes('passwordHash'));
  });

  it('all admin APIs require a session', async () => {
    for (const path of ['/api/customers', '/api/purchases', '/api/dashboard', '/api/settings/loyalty', '/api/reports/customers']) {
      assert.equal((await request(app).get(path)).status, 401, path);
    }
  });

  it('staff are limited by role permissions, and permission changes apply immediately', async () => {
    const staff = await login('staff@test.local');
    assert.equal((await staff.get('/api/customers')).status, 200);
    assert.equal((await staff.get('/api/settings/loyalty')).status, 403);
    assert.equal((await staff.put('/api/settings/loyalty').send({ goldThreshold: 1 })).status, 403);
    assert.equal((await staff.get('/api/staff')).status, 403);
    assert.equal((await staff.get('/api/reports/customers')).status, 403);

    const roles = (await owner.get('/api/roles')).body.items;
    const staffRole = roles.find((r) => r.key === 'STAFF');
    await owner.put(`/api/roles/${staffRole.id}`).send({ permissions: [...staffRole.permissions, 'reports.view'] });
    assert.equal((await staff.get('/api/reports/customers')).status, 200);
  });

  it('forced password change blocks everything until done, and invalidates old sessions', async () => {
    await prisma.adminUser.update({ where: { email: 'staff@test.local' }, data: { mustChangePassword: true } });
    const staff = await login('staff@test.local');
    const blocked = await staff.get('/api/customers');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, 'PASSWORD_CHANGE_REQUIRED');
    const other = await login('staff@test.local');
    const ch = await staff.post('/api/auth/admin/change-password').send({ currentPassword: 'Passw0rd!', newPassword: 'NewPassw0rd' });
    assert.equal(ch.status, 200);
    assert.equal((await staff.get('/api/customers')).status, 200, 'this session continues');
    assert.equal((await other.get('/api/customers')).status, 401, 'other sessions are signed out');
  });
});

describe('customer OTP auth & isolation', () => {
  it('email OTP login works once; wrong/used codes fail', async () => {
    const c = await newCustomer(owner, { mobile: '9123456780', email: 'ravi@test.local' });
    const agent = request.agent(app);
    const otp = await agent.post('/api/auth/otp').send({ login: '+91 91234 56780' });
    assert.equal(otp.status, 200, JSON.stringify(otp.body));
    assert.match(otp.body.devOtp, /^\d{6}$/);
    assert.equal(otp.body.sentTo, 'ra***@test.local', 'destination email is masked');
    const wrong = otp.body.devOtp === '000000' ? '111111' : '000000';
    assert.equal((await agent.post('/api/auth/login').send({ login: c.mobile, otp: wrong })).status, 400);
    assert.equal((await agent.post('/api/auth/login').send({ login: c.mobile, otp: otp.body.devOtp })).status, 200);
    assert.equal((await request(app).post('/api/auth/login').send({ login: c.mobile, otp: otp.body.devOtp })).status, 400, 'code is single-use');
    const stored = await prisma.otpCode.findFirst({ where: { mobile: c.mobile } });
    assert.notEqual(stored.codeHash, otp.body.devOtp, 'OTP is stored hashed');
  });

  it('customers can log in with their email instead of mobile', async () => {
    await newCustomer(owner, { mobile: '9123456781', email: 'Meera@Test.local' });
    const agent = await customerSession('  MEERA@test.local ');
    assert.equal((await agent.get('/api/me')).body.customer.mobile, '9123456781');
  });

  it('accounts without an email get a clear error instead of a code', async () => {
    await newCustomer(owner, { mobile: '9123456782', email: '' });
    const r = await request(app).post('/api/auth/otp').send({ login: '9123456782' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'NO_EMAIL');
    assert.equal((await request(app).post('/api/auth/otp').send({ login: 'nobody@test.local' })).status, 404);
  });

  it('self-registration requires an emailed OTP bound to that email, and unique mobile + email', async () => {
    const agent = request.agent(app);
    assert.equal((await agent.post('/api/auth/register/otp').send({ mobile: '9988776655' })).status, 400, 'email is required');
    const otp = await agent.post('/api/auth/register/otp').send({ mobile: '9988776655', email: 'new@example.com', fullName: 'New Person' });
    assert.equal(otp.status, 200, JSON.stringify(otp.body));

    // Same code, different email → rejected (the code proves ownership of new@example.com only)
    const swapped = await agent.post('/api/auth/register').send({ fullName: 'New Person', mobile: '9988776655', otp: otp.body.devOtp, email: 'attacker@example.com' });
    assert.equal(swapped.status, 400);

    const otp2 = await (async () => {
      await prisma.otpCode.updateMany({ where: { mobile: '9988776655' }, data: { createdAt: new Date(Date.now() - 60_000) } }); // skip resend cooldown
      return agent.post('/api/auth/register/otp').send({ mobile: '9988776655', email: 'new@example.com' });
    })();
    const reg = await agent.post('/api/auth/register').send({ fullName: 'New Person', mobile: '9988776655', otp: otp2.body.devOtp, email: 'NEW@example.com' });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    assert.match(reg.body.customer.customerCode, /^AD\d{6}$/);
    assert.equal((await agent.get('/api/me')).status, 200);

    const dupMobile = await request(app).post('/api/auth/register/otp').send({ mobile: '9988776655', email: 'other@example.com' });
    assert.equal(dupMobile.body.error.code, 'DUPLICATE_MOBILE');
    const dupEmail = await request(app).post('/api/auth/register/otp').send({ mobile: '9988776600', email: 'new@example.com' });
    assert.equal(dupEmail.body.error.code, 'DUPLICATE_EMAIL');
  });

  it('admins cannot give two customers the same email', async () => {
    const r = await owner.post('/api/customers').send({ fullName: 'Copy', mobile: '9123456799', email: 'ravi@test.local' });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'DUPLICATE_EMAIL');
  });

  it('a customer sees only their own data and cannot reach admin APIs', async () => {
    const a = await newCustomer(owner, { mobile: '9111111111', fullName: 'Alice' });
    const b = await newCustomer(owner, { mobile: '9222222222', fullName: 'Bob' });
    await buy(owner, a.id, 800);
    await buy(owner, b.id, 900);
    const alice = await customerSession(a.mobile);

    const me = await alice.get('/api/me');
    assert.equal(me.body.customer.id, a.id);
    const purchases = (await alice.get('/api/me/purchases')).body.items;
    assert.equal(purchases.length, 1);
    assert.equal(purchases[0].customerId, a.id);

    assert.equal((await alice.get(`/api/customers/${b.id}`)).status, 401);
    assert.equal((await alice.get('/api/purchases')).status, 401);

    // Claiming someone else's reward id is indistinguishable from a missing one
    const bobReward = await prisma.reward.create({ data: { name: 'R', requiredCount: 1 } });
    const cr = await prisma.customerReward.create({ data: { customerId: b.id, rewardId: bobReward.id, milestone: 1 } });
    assert.equal((await alice.post(`/api/me/rewards/${cr.id}/claim`).send({})).status, 404);
  });

  it('customers cannot change their own loyalty fields', async () => {
    const c = await newCustomer(owner, { mobile: '9333333333' });
    const agent = await customerSession(c.mobile);
    const r = await agent.put('/api/me').send({ fullName: 'Renamed', silverCount: 999, cardType: 'GOLD', mobile: '9444444444' });
    assert.equal(r.status, 200);
    const fresh = await prisma.customer.findUnique({ where: { id: c.id } });
    assert.deepEqual([fresh.fullName, fresh.silverCount, fresh.cardType, fresh.mobile], ['Renamed', 0, 'SILVER', '9333333333']);
  });

  it('rejects cross-origin state-changing requests', async () => {
    const r = await request(app).post('/api/auth/admin/login').set('Origin', 'https://evil.example').send({ email: 'owner@test.local', password: 'Passw0rd!' });
    assert.equal(r.status, 403);
  });
});
