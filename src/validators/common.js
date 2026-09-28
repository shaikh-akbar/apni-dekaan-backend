import { z } from 'zod';
import { dayEnd, dayStart } from '../utils/format.js';

const blankToNull = (v) => (v === '' || v === undefined ? null : v);
const blankToUndef = (v) => (v === '' || v === null ? undefined : v);

/** Indian mobile: accepts "+91 98765 43210", "09876543210", "9876543210" → "9876543210". */
export const mobile = z.preprocess(
  (v) => (typeof v === 'string' ? v.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '') : v),
  z.string({ error: 'Mobile number is required' }).regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'),
);

export const optionalText = (max) => z.preprocess(blankToNull, z.string().trim().max(max).nullable()).optional();
export const requiredText = (label, max = 200) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max, `${label} is too long`);

export const optionalEmail = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() || null : v ?? null),
  z.email('Enter a valid email address').max(190).nullable(),
).optional();

export const optionalDate = z.preprocess(blankToNull, z.coerce.date({ error: 'Invalid date' }).nullable()).optional();

export const pincode = z.preprocess(blankToNull, z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits').nullable()).optional();

export const money = (label) =>
  z.coerce.number({ error: `${label} must be a number` }).finite().min(0, `${label} cannot be negative`).max(99_999_999, `${label} is too large`)
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, `${label} can have at most 2 decimals`);

export const idParam = z.object({ id: z.coerce.number().int().positive('Invalid id') });

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
export const optionalBoolQuery = z.preprocess(blankToUndef, bool.optional());
export const optionalIntQuery = z.preprocess(blankToUndef, z.coerce.number().int().min(0).optional());
export const optionalNumQuery = z.preprocess(blankToUndef, z.coerce.number().min(0).optional());
export const optionalStrQuery = z.preprocess(blankToUndef, z.string().trim().max(100).optional());
export const fromQuery = z.preprocess(blankToUndef, z.string().optional()).transform(dayStart);
export const toQuery = z.preprocess(blankToUndef, z.string().optional()).transform(dayEnd);

export const pageQuery = {
  page: optionalIntQuery,
  pageSize: optionalIntQuery,
  order: z.preprocess(blankToUndef, z.enum(['asc', 'desc']).optional()),
};

export const enumQuery = (values) => z.preprocess(blankToUndef, z.enum(values).optional());
