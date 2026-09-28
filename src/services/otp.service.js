import crypto from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { maskEmail, otpEmail, sendMail } from './mail.service.js';
import { getSettings } from './settings.service.js';

const RESEND_COOLDOWN_MS = 30_000;
const MAX_PER_HOUR = 8;

/**
 * OTP rows are keyed by the customer's mobile number (their account identity). The HMAC also
 * binds the destination email, so a code sent to one address can't be used with another.
 */
const hash = (mobile, purpose, email, code) =>
  crypto.createHmac('sha256', env.jwtSecret).update(`${mobile}:${purpose}:${email.toLowerCase()}:${code}`).digest('hex');

/** Issues a 6-digit OTP and emails it. Only the HMAC is stored; previous unused codes are invalidated. */
export async function issueOtp({ mobile, email, purpose, name }) {
  const recent = await prisma.otpCode.findFirst({ where: { mobile, purpose }, orderBy: { id: 'desc' } });
  if (recent && Date.now() - recent.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    throw AppError.tooMany('Please wait a few seconds before requesting another code');
  }
  // Per-account cap independent of IP, so rotating IPs cannot flood one inbox
  const lastHour = await prisma.otpCode.count({ where: { mobile, createdAt: { gt: new Date(Date.now() - 3_600_000) } } });
  if (lastHour >= MAX_PER_HOUR) throw AppError.tooMany('Too many codes requested. Please try again later.');

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const created = await prisma.$transaction(async (tx) => {
    await tx.otpCode.updateMany({ where: { mobile, purpose, consumed: false }, data: { consumed: true } });
    return tx.otpCode.create({
      data: { mobile, purpose, codeHash: hash(mobile, purpose, email, code), expiresAt: new Date(Date.now() + env.otpTtlMinutes * 60_000) },
    });
  });

  const settings = await getSettings();
  try {
    await sendMail({ to: email, ...otpEmail({ code, name, shopName: settings.shopName, purpose, minutes: env.otpTtlMinutes }) });
  } catch (e) {
    // Don't leave a live code behind if it never reached the customer
    await prisma.otpCode.update({ where: { id: created.id }, data: { consumed: true } });
    console.error('[mail] OTP email failed:', e.message);
    throw new AppError(502, 'We could not send the verification email right now. Please try again in a minute.', { code: 'EMAIL_FAILED' });
  }

  return { sentTo: maskEmail(email), expiresInSeconds: env.otpTtlMinutes * 60, ...(env.otpDevEcho && { devOtp: code }) };
}

/** Verifies and consumes an OTP. Wrong guesses count towards a per-code attempt limit. */
export async function verifyOtp({ mobile, email, purpose, code }) {
  const otp = await prisma.otpCode.findFirst({ where: { mobile, purpose, consumed: false }, orderBy: { id: 'desc' } });
  if (!otp || otp.expiresAt < new Date()) throw AppError.badRequest('The code has expired. Please request a new one.', { code: 'OTP_EXPIRED' });
  if (otp.attempts >= env.otpMaxAttempts) throw AppError.tooMany('Too many incorrect attempts. Please request a new code.');

  const expected = Buffer.from(otp.codeHash, 'hex');
  const actual = Buffer.from(hash(mobile, purpose, email, String(code)), 'hex');
  const ok = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  if (!ok) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw AppError.badRequest('Incorrect verification code', { code: 'OTP_INVALID' });
  }
  // Conditional update: a code can be consumed exactly once even under concurrent requests
  const { count } = await prisma.otpCode.updateMany({ where: { id: otp.id, consumed: false }, data: { consumed: true } });
  if (count !== 1) throw AppError.badRequest('The code has already been used', { code: 'OTP_USED' });
  return true;
}
