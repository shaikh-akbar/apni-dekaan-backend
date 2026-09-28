import { prisma } from '../config/prisma.js';
import { SUPER_ADMIN_ROLE } from '../config/permissions.js';
import { AppError } from '../utils/AppError.js';
import { COOKIE, verifyToken } from '../utils/jwt.js';

function readToken(req, cookieName) {
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return req.cookies?.[cookieName];
}

function decode(token, expectedType) {
  if (!token) return null;
  try {
    const payload = verifyToken(token);
    return payload.typ === expectedType ? payload : null;
  } catch {
    return null;
  }
}

/** Admin + role + effective permissions, or null if the account is missing/inactive. */
export async function adminProfile(id, expectedTokenVersion) {
  const admin = await prisma.adminUser.findUnique({
    where: { id },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  if (!admin || !admin.isActive) return null;
  if (expectedTokenVersion !== undefined && admin.tokenVersion !== expectedTokenVersion) return null;
  const isSuperAdmin = admin.role.key === SUPER_ADMIN_ROLE;
  return {
    id: admin.id,
    name: admin.name,
    email: admin.email,
    mustChangePassword: admin.mustChangePassword,
    role: { id: admin.role.id, key: admin.role.key, name: admin.role.name },
    isSuperAdmin,
    permissions: isSuperAdmin ? ['*'] : admin.role.permissions.map((rp) => rp.permission.key),
  };
}

/** Loaded on every request so permission changes and deactivation apply immediately. */
export async function loadAdmin(req) {
  const payload = decode(readToken(req, COOKIE.admin), 'admin');
  if (!payload) return null;
  return adminProfile(Number(payload.sub), payload.ver);
}

export async function requireAdmin(req, _res, next) {
  const admin = await loadAdmin(req);
  if (!admin) throw AppError.unauthorized();
  req.admin = admin;
  next();
}

/** Blocks everything except the password-change endpoint until a forced change is done. */
export function enforcePasswordChange(req, _res, next) {
  if (req.admin?.mustChangePassword) {
    throw new AppError(403, 'You must change your password before continuing', { code: 'PASSWORD_CHANGE_REQUIRED' });
  }
  next();
}

export const hasPermission = (admin, key) => admin.isSuperAdmin || admin.permissions.includes(key);

/** requirePermission('a', 'b') → admin needs ALL listed permissions. */
export const requirePermission = (...keys) => (req, _res, next) => {
  if (!req.admin) throw AppError.unauthorized();
  if (!keys.every((k) => hasPermission(req.admin, k))) throw AppError.forbidden();
  next();
};

export const requireSuperAdmin = (req, _res, next) => {
  if (!req.admin?.isSuperAdmin) throw AppError.forbidden('Super Admin access required');
  next();
};

export async function requireCustomer(req, _res, next) {
  const payload = decode(readToken(req, COOKIE.customer), 'customer');
  if (!payload) throw AppError.unauthorized();
  const customer = await prisma.customer.findUnique({
    where: { id: Number(payload.sub) },
    select: { id: true, isActive: true },
  });
  if (!customer || !customer.isActive) throw AppError.unauthorized();
  req.customer = { id: customer.id };
  next();
}
