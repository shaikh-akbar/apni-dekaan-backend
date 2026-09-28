import * as purchases from '../services/purchase.service.js';
import { clientIp } from '../utils/format.js';
import { parsePagination } from '../utils/pagination.js';

export async function list(req, res) {
  const { sort, order, ...filters } = req.valid.query;
  res.json(await purchases.listPurchases(filters, parsePagination(req.valid.query), { sort, order }));
}

export async function create(req, res) {
  res.status(201).json(await purchases.createPurchase(req.valid.body, req.admin, clientIp(req)));
}

export async function get(req, res) {
  res.json({ purchase: await purchases.getPurchase(req.valid.params.id) });
}

export async function update(req, res) {
  res.json(await purchases.updatePurchase(req.valid.params.id, req.valid.body, req.admin, clientIp(req)));
}

/** DELETE never removes data: it cancels the purchase and reverses its loyalty counts. */
export async function cancel(req, res) {
  res.json(await purchases.cancelPurchase(req.valid.params.id, req.valid.body.reason, req.admin, clientIp(req)));
}
