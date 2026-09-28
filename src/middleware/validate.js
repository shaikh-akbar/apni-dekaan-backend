import { AppError } from '../utils/AppError.js';

/**
 * validate({ body, query, params }) — each a zod schema. Parsed (coerced, trimmed)
 * values are exposed on req.valid so controllers only ever see validated input.
 * (Express 5 makes req.query a read-only getter, hence req.valid.)
 */
export const validate = (schemas) => (req, _res, next) => {
  req.valid = req.valid || {};
  for (const part of ['params', 'query', 'body']) {
    const schema = schemas[part];
    if (!schema) continue;
    const result = schema.safeParse(req[part] ?? {});
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ field: i.path.join('.') || part, message: i.message }));
      throw AppError.badRequest(details[0]?.message || 'Validation failed', { code: 'VALIDATION_ERROR', details });
    }
    req.valid[part] = result.data;
  }
  next();
};
