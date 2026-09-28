import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env.js';

const handler = (_req, res) =>
  res.status(429).json({ error: { message: 'Too many requests, please try again later', code: 'RATE_LIMITED' } });
const skip = () => env.isTest;
const base = { standardHeaders: 'draft-7', legacyHeaders: false, handler, skip };

export const apiLimiter = rateLimit({ ...base, windowMs: 60_000, limit: 300 });
export const loginLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, limit: 10 });
// OTP emails are limited per IP *and* per account identifier
export const otpLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: 5,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.login || req.body?.mobile || '').toLowerCase()}`,
});
