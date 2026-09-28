/**
 * Customer self-service. Every handler scopes by req.customer.id (from the session),
 * never by an id supplied in the URL, so a customer can only ever see their own data.
 */
import { prisma } from '../config/prisma.js';
import { imageUpload, publicPath, removeUpload } from '../middleware/upload.js';
import * as customers from '../services/customer.service.js';
import { setClaimStatus } from '../services/reward.service.js';
import { getSettings, publicSettings } from '../services/settings.service.js';
import { AppError } from '../utils/AppError.js';
import { clientIp } from '../utils/format.js';
import { parsePagination } from '../utils/pagination.js';

const PRIVATE_FIELDS = ['createdById', 'createdBy', 'isActive'];
const strip = (c) => Object.fromEntries(Object.entries(c).filter(([k]) => !PRIVATE_FIELDS.includes(k)));

export async function overview(req, res) {
  const [data, settings] = await Promise.all([customers.getCustomerOverview(req.customer.id), getSettings()]);
  res.json({ ...data, customer: strip(data.customer), settings: publicSettings(settings) });
}

export async function updateProfile(req, res) {
  const customer = await customers.updateCustomer(req.customer.id, req.valid.body, { customerId: req.customer.id, ip: clientIp(req) });
  res.json({ customer: strip(customer) });
}

export async function purchases(req, res) {
  const page = await customers.customerPurchases(req.customer.id, parsePagination(req.query));
  // Staff names are shown as "Added by", but no other staff details
  res.json({
    ...page,
    items: page.items.map(({ createdBy, createdById: _c, updatedById: _u, cancelledById: _x, ...p }) => ({ ...p, addedBy: createdBy?.name || 'Staff' })),
  });
}

export async function loyalty(req, res) {
  const page = await customers.customerLoyalty(req.customer.id, parsePagination(req.query));
  res.json({ ...page, items: page.items.map(({ admin: _a, adminId: _i, ...t }) => t) });
}

export async function rewards(req, res) {
  const items = await customers.customerRewards(req.customer.id);
  res.json({ items: items.map(({ processedBy: _p, processedById: _i, ...r }) => r) });
}

/** Customer presses "Claim" → AVAILABLE → CLAIMED (once). Staff then hand it over and mark DELIVERED. */
export async function claimReward(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest('Invalid reward');
  const claim = await setClaimStatus(id, 'CLAIMED', { customerId: req.customer.id, ip: clientIp(req) });
  res.json({ claim });
}

export const photoField = imageUpload.single('photo');

export async function uploadPhoto(req, res) {
  if (!req.file) throw AppError.badRequest('Choose an image to upload');
  const before = await prisma.customer.findUnique({ where: { id: req.customer.id }, select: { profilePhoto: true } });
  const customer = await customers.updateCustomer(req.customer.id, { profilePhoto: publicPath(req.file) }, { customerId: req.customer.id, ip: clientIp(req) });
  removeUpload(before?.profilePhoto);
  res.json({ customer: strip(customer) });
}
