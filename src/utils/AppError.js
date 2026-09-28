export class AppError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(msg, opts) { return new AppError(400, msg, { code: 'BAD_REQUEST', ...opts }); }
  static unauthorized(msg = 'Authentication required') { return new AppError(401, msg, { code: 'UNAUTHORIZED' }); }
  static forbidden(msg = 'You do not have permission to perform this action') { return new AppError(403, msg, { code: 'FORBIDDEN' }); }
  static notFound(msg = 'Resource not found') { return new AppError(404, msg, { code: 'NOT_FOUND' }); }
  static conflict(msg, opts) { return new AppError(409, msg, { code: 'CONFLICT', ...opts }); }
  static tooMany(msg = 'Too many requests, please try again later') { return new AppError(429, msg, { code: 'RATE_LIMITED' }); }
}
