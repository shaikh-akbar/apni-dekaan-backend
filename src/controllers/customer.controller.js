import { imageUpload, publicPath, removeUpload } from '../middleware/upload.js';
import * as customers from '../services/customer.service.js';
import { recalculateCustomer } from '../services/loyalty.service.js';
import { AppError } from '../utils/AppError.js';
import { clientIp } from '../utils/format.js';
import { parsePagination } from '../utils/pagination.js';

const ctx = (req) => ({ admin: req.admin, ip: clientIp(req) });

export async function list(req, res) {
  const { sort, order, ...filters } = req.valid.query;
  res.json(await customers.listCustomers(filters, parsePagination(req.valid.query), { sort, order }));
}

export async function create(req, res) {
  res.status(201).json({ customer: await customers.createCustomer(req.valid.body, ctx(req)) });
}

export async function get(req, res) {
  res.json(await customers.getCustomerOverview(req.valid.params.id));
}

export async function update(req, res) {
  res.json({ customer: await customers.updateCustomer(req.valid.params.id, req.valid.body, ctx(req)) });
}

export async function purchases(req, res) {
  await customers.getCustomer(req.valid.params.id);
  res.json(await customers.customerPurchases(req.valid.params.id, parsePagination(req.query)));
}

export async function loyalty(req, res) {
  await customers.getCustomer(req.valid.params.id);
  res.json(await customers.customerLoyalty(req.valid.params.id, parsePagination(req.query)));
}

export async function rewards(req, res) {
  await customers.getCustomer(req.valid.params.id);
  res.json({ items: await customers.customerRewards(req.valid.params.id) });
}

export async function recalculate(req, res) {
  await customers.getCustomer(req.valid.params.id);
  res.json(await recalculateCustomer(req.valid.params.id, { ...ctx(req), dryRun: req.valid.body.dryRun }));
}

export const photoUpload = imageUpload.single('photo');

export async function uploadPhoto(req, res) {
  if (!req.file) throw AppError.badRequest('Choose an image to upload');
  const id = req.valid.params.id;
  const before = await customers.getCustomer(id);
  const customer = await customers.updateCustomer(id, { profilePhoto: publicPath(req.file) }, ctx(req));
  removeUpload(before.profilePhoto);
  res.json({ customer });
}
