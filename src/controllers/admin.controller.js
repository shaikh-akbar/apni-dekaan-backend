import { prisma } from '../config/prisma.js';
import { imageUpload, publicPath, removeUpload } from '../middleware/upload.js';
import { listAuditLogs } from '../services/audit.service.js';
import { adminDashboard } from '../services/dashboard.service.js';
import { recalculateAll } from '../services/loyalty.service.js';
import { REPORTS } from '../services/report.service.js';
import { getSettings, publicSettings, updateSettings } from '../services/settings.service.js';
import * as staff from '../services/staff.service.js';
import { AppError } from '../utils/AppError.js';
import { toCsv, toPdf, toXlsx } from '../utils/export.js';
import { clientIp } from '../utils/format.js';
import { paginated, parsePagination } from '../utils/pagination.js';

// ── Dashboard
export async function dashboard(req, res) {
  const days = Math.min(90, Math.max(7, Number(req.query.days) || 30));
  res.json(await adminDashboard({ days }));
}

// ── Settings
export async function getPublicSettings(_req, res) {
  res.json({ settings: publicSettings(await getSettings()) });
}

export async function getLoyaltySettings(_req, res) {
  res.json({ settings: await getSettings() });
}

export async function putLoyaltySettings(req, res) {
  res.json({ settings: await updateSettings(req.valid.body, req.admin, clientIp(req)) });
}

export const logoField = imageUpload.single('logo');

export async function uploadLogo(req, res) {
  if (!req.file) throw AppError.badRequest('Choose an image to upload');
  const before = await getSettings();
  const settings = await updateSettings({ shopLogo: publicPath(req.file) }, req.admin, clientIp(req));
  removeUpload(before.shopLogo);
  res.json({ settings });
}

// ── Loyalty ledger (all customers)
export async function loyaltyHistory(req, res) {
  const { q, customerId, action, from, to } = req.valid.query;
  const page = parsePagination(req.valid.query);
  const and = [];
  if (customerId) and.push({ customerId });
  if (action) and.push({ action });
  if (from || to) and.push({ createdAt: { ...(from && { gte: from }), ...(to && { lte: to }) } });
  if (q) and.push({ OR: [{ invoiceNumber: { contains: q } }, { customer: { fullName: { contains: q } } }, { customer: { customerCode: { contains: q } } }, { customer: { mobile: { contains: q } } }] });
  const where = and.length ? { AND: and } : {};
  const [items, total] = await Promise.all([
    prisma.loyaltyTransaction.findMany({
      where,
      orderBy: { id: 'desc' },
      skip: page.skip,
      take: page.take,
      include: { customer: { select: { id: true, fullName: true, customerCode: true } }, admin: { select: { id: true, name: true } } },
    }),
    prisma.loyaltyTransaction.count({ where }),
  ]);
  res.json(paginated(items, total, page));
}

export async function recalculateEveryone(req, res) {
  res.json(await recalculateAll({ admin: req.admin, ip: clientIp(req), dryRun: req.valid.body.dryRun }));
}

// ── Reports
export async function report(req, res) {
  const build = REPORTS[req.params.type];
  if (!build) throw AppError.notFound('Unknown report');
  const { format = 'json', ...filters } = req.valid.query;
  const data = await build(filters);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${req.params.type}-report-${stamp}`;

  if (format === 'json') return res.json(data);
  if (format === 'csv') {
    res.type('text/csv; charset=utf-8').attachment(`${filename}.csv`);
    return res.send(toCsv(data));
  }
  if (format === 'xlsx') {
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(`${filename}.xlsx`);
    return res.send(Buffer.from(await toXlsx(data)));
  }
  const settings = await getSettings();
  res.type('application/pdf').attachment(`${filename}.pdf`);
  res.send(await toPdf(data, { shopName: settings.shopName }));
}

// ── Staff & roles
export async function listAdmins(_req, res) {
  res.json({ items: await staff.listAdmins() });
}
export async function createAdmin(req, res) {
  res.status(201).json({ admin: await staff.createAdmin(req.valid.body, req.admin, clientIp(req)) });
}
export async function updateAdmin(req, res) {
  res.json({ admin: await staff.updateAdmin(req.valid.params.id, req.valid.body, req.admin, clientIp(req)) });
}
export async function listRoles(_req, res) {
  res.json({ items: await staff.listRoles(), permissions: await staff.listPermissions() });
}
export async function createRole(req, res) {
  res.status(201).json({ role: await staff.createRole(req.valid.body, req.admin, clientIp(req)) });
}
export async function updateRole(req, res) {
  res.json({ role: await staff.updateRole(req.valid.params.id, req.valid.body, req.admin, clientIp(req)) });
}

// ── Audit
export async function auditLogs(req, res) {
  const { page: _p, pageSize: _s, order: _o, ...filters } = req.valid.query;
  res.json(await listAuditLogs(filters, parsePagination(req.valid.query)));
}
