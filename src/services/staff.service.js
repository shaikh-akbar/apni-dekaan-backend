import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma.js';
import { PERMISSION_KEYS, SUPER_ADMIN_ROLE } from '../config/permissions.js';
import { AppError } from '../utils/AppError.js';
import { audit } from './audit.service.js';
import { BCRYPT_ROUNDS, validatePasswordStrength } from './auth.service.js';

const adminSelect = {
  id: true, name: true, email: true, isActive: true, mustChangePassword: true, lastLoginAt: true, createdAt: true,
  role: { select: { id: true, key: true, name: true } },
};

export const listAdmins = () => prisma.adminUser.findMany({ select: adminSelect, orderBy: { id: 'asc' } });

export async function createAdmin({ name, email, password, roleId }, actor, ip) {
  validatePasswordStrength(password);
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) throw AppError.badRequest('Role not found');
  const admin = await prisma.adminUser.create({
    data: { name, email: email.toLowerCase(), roleId, passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS), mustChangePassword: true },
    select: adminSelect,
  });
  await audit(null, { admin: actor, action: 'ADMIN_CREATED', entity: 'admin_user', entityId: admin.id, after: admin, ip });
  return admin;
}

async function superAdminCount(exceptId) {
  return prisma.adminUser.count({ where: { isActive: true, role: { key: SUPER_ADMIN_ROLE }, ...(exceptId && { id: { not: exceptId } }) } });
}

export async function updateAdmin(id, { name, roleId, isActive, password }, actor, ip) {
  const before = await prisma.adminUser.findUnique({ where: { id }, include: { role: true } });
  if (!before) throw AppError.notFound('Staff member not found');

  const losingSuper = before.role.key === SUPER_ADMIN_ROLE && (isActive === false || (roleId && roleId !== before.roleId));
  if (losingSuper && (await superAdminCount(id)) === 0) throw AppError.badRequest('There must always be at least one active Super Admin');
  if (id === actor.id && isActive === false) throw AppError.badRequest('You cannot deactivate your own account');

  const data = { ...(name && { name }), ...(roleId && { roleId }), ...(isActive !== undefined && { isActive }) };
  if (password) {
    validatePasswordStrength(password);
    Object.assign(data, { passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS), mustChangePassword: true });
  }
  // Any security-relevant change signs the user out everywhere
  if (password || roleId || isActive === false) data.tokenVersion = { increment: 1 };

  const after = await prisma.adminUser.update({ where: { id }, data, select: adminSelect });
  await audit(null, { admin: actor, action: 'ADMIN_UPDATED', entity: 'admin_user', entityId: id, before, after: { ...after, passwordReset: !!password }, ip });
  return after;
}

export async function listRoles() {
  const roles = await prisma.role.findMany({
    orderBy: { id: 'asc' },
    include: { permissions: { include: { permission: true } }, _count: { select: { admins: true } } },
  });
  return roles.map((r) => ({
    id: r.id, key: r.key, name: r.name, description: r.description, isSystem: r.isSystem,
    adminCount: r._count.admins,
    permissions: r.key === SUPER_ADMIN_ROLE ? PERMISSION_KEYS : r.permissions.map((p) => p.permission.key),
  }));
}

export const listPermissions = () => prisma.permission.findMany({ orderBy: [{ group: 'asc' }, { id: 'asc' }] });

async function permissionIds(keys) {
  const perms = await prisma.permission.findMany({ where: { key: { in: keys } } });
  if (perms.length !== new Set(keys).size) throw AppError.badRequest('Unknown permission key');
  return perms.map((p) => p.id);
}

export async function createRole({ key, name, description, permissions = [] }, actor, ip) {
  const ids = await permissionIds(permissions);
  const role = await prisma.role.create({
    data: { key, name, description, permissions: { create: ids.map((permissionId) => ({ permissionId })) } },
  });
  await audit(null, { admin: actor, action: 'ROLE_CREATED', entity: 'role', entityId: role.id, after: { ...role, permissions }, ip });
  return role;
}

export async function updateRole(id, { name, description, permissions }, actor, ip) {
  const before = await prisma.role.findUnique({ where: { id }, include: { permissions: { include: { permission: true } } } });
  if (!before) throw AppError.notFound('Role not found');
  if (before.key === SUPER_ADMIN_ROLE && permissions) throw AppError.badRequest('Super Admin always has every permission');
  const ids = permissions ? await permissionIds(permissions) : null;
  const role = await prisma.$transaction(async (tx) => {
    if (ids) {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.rolePermission.createMany({ data: ids.map((permissionId) => ({ roleId: id, permissionId })) });
    }
    return tx.role.update({ where: { id }, data: { ...(name && { name }), ...(description !== undefined && { description }) } });
  });
  await audit(null, {
    admin: actor, action: 'ROLE_UPDATED', entity: 'role', entityId: id,
    before: { name: before.name, permissions: before.permissions.map((p) => p.permission.key) },
    after: { name: role.name, permissions }, ip,
  });
  return role;
}
