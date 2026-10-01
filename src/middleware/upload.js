import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (process.env.VERCEL === '1') {
      return cb(new AppError(503, 'Image uploads require persistent object storage on this hosting platform'));
    }
    fs.mkdir(env.uploadDir, { recursive: true }, (err) => cb(err, env.uploadDir));
  },
  // Random server-side filenames; the client-supplied name and extension are never used
  filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${EXT[file.mimetype]}`),
});

export const imageUpload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!EXT[file.mimetype]) return cb(AppError.badRequest('Only JPEG, PNG or WEBP images are allowed'));
    cb(null, true);
  },
});

export const publicPath = (file) => (file ? `/uploads/${path.basename(file.filename)}` : undefined);

export function removeUpload(publicUrl) {
  if (!publicUrl?.startsWith('/uploads/')) return;
  fs.promises.unlink(path.join(env.uploadDir, path.basename(publicUrl))).catch(() => {});
}
