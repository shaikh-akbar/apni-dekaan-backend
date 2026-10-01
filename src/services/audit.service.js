import { prisma } from '../config/prisma.js';
import { paginated } from '../utils/pagination.js';

const REDACT = new Set(['passwordHash', 'codeHash', 'tokenVersion']);

/** JSON-safe snapshot with secrets stripped (Decimals → numbers, Dates → ISO strings). */
function snapshot(obj) {
  if (obj === undefined || obj === null) return undefined;
  return JSON.parse(JSON.stringify(obj, (k, v) => (REDACT.has(k) ? undefined : v)));
}

/**
 * Write an audit record. Pass the transaction client so the audit row commits
 * (or rolls back) together with the change it describes.
 */
export async function audit(db, { admin, customerId, action, entity, entityId, before, after, ip }) {
  return (db || prisma).auditLog.create({
    data: {
      adminId: admin?.id ?? null,
      actorType: admin ? 'ADMIN' : customerId ? 'CUSTOMER' : 'SYSTEM',
      actorId: admin?.id ?? customerId ?? null,
      action,
      entity,
      entityId: entityId === undefined || entityId === null ? null : String(entityId),
      before: snapshot(before),
      after: snapshot(after),
      ip: ip || null,
    },
  });
}

export async function listAuditLogs({ entity, entityId, adminId, action, from, to }, page) {
  const where = {
    ...(entity && { entity }),
    ...(entityId && { entityId: String(entityId) }),
    ...(adminId && { adminId }),
    ...(action && { action: { contains: action, mode: 'insensitive' } }),
    ...((from || to) && { createdAt: { ...(from && { gte: from }), ...(to && { lte: to }) } }),
  };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      skip: page.skip,
      take: page.take,
      include: { admin: { select: { id: true, name: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return paginated(items, total, page);
}
