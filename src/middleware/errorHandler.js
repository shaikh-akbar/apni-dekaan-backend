import multer from 'multer';
import { Prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

export function notFound(req, _res, next) {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let error = err;

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = [].concat(err.meta?.target || []).join(', ');
      error = AppError.conflict(`A record with this ${target || 'value'} already exists`, { code: 'DUPLICATE' });
    } else if (err.code === 'P2025') {
      error = AppError.notFound();
    } else if (err.code === 'P2034') {
      error = AppError.conflict('The record was modified concurrently, please retry', { code: 'WRITE_CONFLICT' });
    }
  } else if (err instanceof Prisma.PrismaClientUnknownRequestError && /\b(1020|1213)\b|Record has changed since last read|Deadlock/i.test(err.message)) {
    // MariaDB snapshot-isolation conflict (1020) or InnoDB deadlock (1213): safe for the client to retry
    error = AppError.conflict('The record was modified concurrently, please retry', { code: 'WRITE_CONFLICT' });
  } else if (err instanceof multer.MulterError) {
    error = AppError.badRequest(err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 2 MB)' : err.message);
  } else if (err?.type === 'entity.parse.failed') {
    error = AppError.badRequest('Malformed JSON body');
  } else if (err?.type === 'entity.too.large') {
    error = new AppError(413, 'Request body too large');
  }

  const status = error instanceof AppError ? error.status : 500;
  if (status >= 500) console.error('[error]', req.method, req.originalUrl, err);

  res.status(status).json({
    error: {
      message: status >= 500 && env.isProd ? 'Internal server error' : error.message || 'Internal server error',
      code: error.code || (status >= 500 ? 'INTERNAL' : undefined),
      details: error.details,
    },
  });
}
