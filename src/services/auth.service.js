import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { audit } from './audit.service.js';
import { createCustomer } from './customer.service.js';
import { issueOtp, verifyOtp } from './otp.service.js';

export const BCRYPT_ROUNDS = 12;
// Constant-time-ish login: compare against a dummy hash when the email doesn't exist
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

export const adminSessionSeconds = () => env.adminSessionHours * 3600;
export const customerSessionSeconds = () => env.customerSessionDays * 86400;

export async function adminLogin(email, password, ip) {
  const admin = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
  const ok = await bcrypt.compare(password, admin?.passwordHash || DUMMY_HASH);
  if (!admin || !ok || !admin.isActive) {
    await audit(null, { action: 'ADMIN_LOGIN_FAILED', entity: 'admin_user', entityId: admin?.id, after: { email }, ip });
    throw AppError.unauthorized('Invalid email or password');
  }
  await prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
  await audit(null, { admin, action: 'ADMIN_LOGIN', entity: 'admin_user', entityId: admin.id, ip });
  return admin;
}

export function validatePasswordStrength(pw) {
  if (pw.length < 8 || !/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) {
    throw AppError.badRequest('Password must be at least 8 characters and include upper-case, lower-case and a number');
  }
}

/** Changing password bumps tokenVersion → all other sessions are signed out. */
export async function changeAdminPassword(adminId, currentPassword, newPassword, ip) {
  const admin = await prisma.adminUser.findUnique({ where: { id: adminId } });
  if (!admin || !(await bcrypt.compare(currentPassword, admin.passwordHash))) {
    throw AppError.badRequest('Current password is incorrect');
  }
  if (currentPassword === newPassword) throw AppError.badRequest('New password must be different from the current one');
  validatePasswordStrength(newPassword);
  const updated = await prisma.adminUser.update({
    where: { id: adminId },
    data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS), mustChangePassword: false, tokenVersion: { increment: 1 } },
  });
  await audit(null, { admin: updated, action: 'ADMIN_PASSWORD_CHANGED', entity: 'admin_user', entityId: adminId, ip });
  return updated;
}

// ───────────────────────────── Customers (OTP) ─────────────────────────────

/**
 * The OTP is emailed to the customer's registered address.
 * `login` is either a 10-digit mobile number or an email address.
 * Unknown accounts get a clear "please register" error: this is a shop-front loyalty app,
 * and the per-IP/per-account rate limits bound enumeration.
 */
async function findLoginCustomer(login) {
  const customer = await prisma.customer.findUnique({
    where: login.type === 'email' ? { email: login.value } : { mobile: login.value },
    select: { id: true, fullName: true, mobile: true, email: true, isActive: true },
  });
  if (!customer) {
    throw AppError.notFound(`No customer is registered with this ${login.type === 'email' ? 'email' : 'mobile number'}. Please register first.`);
  }
  if (!customer.isActive) throw AppError.forbidden('This account is inactive. Please contact the shop.');
  if (!customer.email) {
    throw AppError.badRequest('No email address is saved on this account, so we cannot send a login code. Please ask the shop to add your email.', { code: 'NO_EMAIL' });
  }
  return customer;
}

async function assertRegistrable(mobile, email) {
  const [byMobile, byEmail] = await Promise.all([
    prisma.customer.findUnique({ where: { mobile }, select: { id: true } }),
    prisma.customer.findUnique({ where: { email }, select: { id: true } }),
  ]);
  if (byMobile) throw AppError.conflict('This mobile number is already registered. Please log in.', { code: 'DUPLICATE_MOBILE', details: [{ field: 'mobile', message: 'This mobile number is already registered' }] });
  if (byEmail) throw AppError.conflict('This email is already registered. Please log in.', { code: 'DUPLICATE_EMAIL', details: [{ field: 'email', message: 'This email is already registered' }] });
}

export async function requestLoginOtp(login) {
  const c = await findLoginCustomer(login);
  return issueOtp({ mobile: c.mobile, email: c.email, purpose: 'LOGIN', name: c.fullName.split(' ')[0] });
}

export async function requestRegisterOtp({ mobile, email, fullName }) {
  await assertRegistrable(mobile, email);
  return issueOtp({ mobile, email, purpose: 'REGISTER', name: fullName?.split(' ')[0] });
}

export async function customerLogin(login, otp) {
  const c = await findLoginCustomer(login);
  await verifyOtp({ mobile: c.mobile, email: c.email, purpose: 'LOGIN', code: otp });
  return prisma.customer.findUnique({ where: { id: c.id } });
}

export async function customerRegister(input, ip) {
  await assertRegistrable(input.mobile, input.email);
  // The code is bound to the email it was sent to — the address is proven, not just typed
  await verifyOtp({ mobile: input.mobile, email: input.email, purpose: 'REGISTER', code: input.otp });
  const { otp: _otp, ...profile } = input;
  return createCustomer({ ...profile, registrationDate: new Date() }, { ip });
}
