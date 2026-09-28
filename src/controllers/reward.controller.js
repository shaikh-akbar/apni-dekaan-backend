import { imageUpload, publicPath, removeUpload } from '../middleware/upload.js';
import { isRewardLive } from '../services/loyalty.service.js';
import * as rewards from '../services/reward.service.js';
import { AppError } from '../utils/AppError.js';
import { clientIp } from '../utils/format.js';
import { parsePagination } from '../utils/pagination.js';

export async function list(_req, res) {
  res.json({ items: await rewards.listRewards() });
}

/** Live rewards for the public landing page — display fields only. */
export async function listPublic(_req, res) {
  const items = (await rewards.listRewards({ includeInactive: false }))
    .filter((r) => isRewardLive(r))
    .map(({ id, name, description, requiredCount, rewardType, image }) => ({ id, name, description, requiredCount, rewardType, image }));
  res.json({ items });
}

export async function get(req, res) {
  res.json({ reward: await rewards.getReward(req.valid.params.id) });
}

export async function create(req, res) {
  res.status(201).json({ reward: await rewards.createReward(req.valid.body, req.admin, clientIp(req)) });
}

export async function update(req, res) {
  res.json({ reward: await rewards.updateReward(req.valid.params.id, req.valid.body, req.admin, clientIp(req)) });
}

export const imageField = imageUpload.single('image');

export async function uploadImage(req, res) {
  if (!req.file) throw AppError.badRequest('Choose an image to upload');
  const before = await rewards.getReward(req.valid.params.id);
  const reward = await rewards.updateReward(before.id, { image: publicPath(req.file) }, req.admin, clientIp(req));
  removeUpload(before.image);
  res.json({ reward });
}

export async function listClaims(req, res) {
  res.json(await rewards.listClaims(req.valid.query, parsePagination(req.valid.query)));
}

export async function setClaimStatus(req, res) {
  const { status, notes } = req.valid.body;
  res.json({ claim: await rewards.setClaimStatus(req.valid.params.id, status, { admin: req.admin, notes, ip: clientIp(req) }) });
}
