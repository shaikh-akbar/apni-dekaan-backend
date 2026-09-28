import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const COOKIE = { admin: 'ad_admin', customer: 'ad_customer' };

export function signToken(payload, expiresInSeconds) {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: expiresInSeconds, issuer: 'apni-dukaan' });
}

export function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret, { issuer: 'apni-dukaan' });
}

export function setAuthCookie(res, name, token, maxAgeSeconds) {
  res.cookie(name, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds * 1000,
  });
}

export function clearAuthCookie(res, name) {
  res.clearCookie(name, { httpOnly: true, secure: env.cookieSecure, sameSite: 'lax', path: '/' });
}
