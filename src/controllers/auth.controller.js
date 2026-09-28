import { adminProfile } from '../middleware/auth.js';
import * as auth from '../services/auth.service.js';
import { clientIp } from '../utils/format.js';
import { clearAuthCookie, COOKIE, setAuthCookie, signToken } from '../utils/jwt.js';

function startAdminSession(res, admin) {
  const ttl = auth.adminSessionSeconds();
  setAuthCookie(res, COOKIE.admin, signToken({ sub: String(admin.id), typ: 'admin', ver: admin.tokenVersion }, ttl), ttl);
}

function startCustomerSession(res, customer) {
  const ttl = auth.customerSessionSeconds();
  setAuthCookie(res, COOKIE.customer, signToken({ sub: String(customer.id), typ: 'customer' }, ttl), ttl);
}

// ── Admin
export async function adminLogin(req, res) {
  const { email, password } = req.valid.body;
  const admin = await auth.adminLogin(email, password, clientIp(req));
  startAdminSession(res, admin);
  res.json({ admin: await adminProfile(admin.id) });
}

export async function adminMe(req, res) {
  res.json({ admin: req.admin });
}

export async function adminLogout(_req, res) {
  clearAuthCookie(res, COOKIE.admin);
  res.json({ ok: true });
}

export async function adminChangePassword(req, res) {
  const { currentPassword, newPassword } = req.valid.body;
  const updated = await auth.changeAdminPassword(req.admin.id, currentPassword, newPassword, clientIp(req));
  startAdminSession(res, updated); // re-issue: the previous token version is now invalid
  res.json({ admin: await adminProfile(updated.id) });
}

// ── Customer
/** POST /auth/otp — email a login code to the customer found by mobile or email. */
export async function requestLoginOtp(req, res) {
  res.json(await auth.requestLoginOtp(req.valid.body.login));
}

/** POST /auth/register/otp — email a code to the address being registered. */
export async function requestRegisterOtp(req, res) {
  res.json(await auth.requestRegisterOtp(req.valid.body));
}

const customerSummary = (c) => ({ id: c.id, fullName: c.fullName, customerCode: c.customerCode });

export async function customerLogin(req, res) {
  const { login, otp } = req.valid.body;
  const customer = await auth.customerLogin(login, otp);
  startCustomerSession(res, customer);
  res.json({ customer: customerSummary(customer) });
}

export async function customerRegister(req, res) {
  const customer = await auth.customerRegister(req.valid.body, clientIp(req));
  startCustomerSession(res, customer);
  res.status(201).json({ customer: customerSummary(customer) });
}

export async function customerLogout(_req, res) {
  clearAuthCookie(res, COOKIE.customer);
  res.json({ ok: true });
}
