import { z } from 'zod';
import { PERMISSION_KEYS } from '../config/permissions.js';
import {
  enumQuery, fromQuery, mobile, money, optionalBoolQuery, optionalDate, optionalEmail, optionalIntQuery,
  optionalNumQuery, optionalStrQuery, optionalText, pageQuery, pincode, requiredText, toQuery,
} from './common.js';

export const GENDERS = ['MALE', 'FEMALE', 'OTHER'];
export const CARD_TYPES = ['SILVER', 'GOLD'];
export const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD', 'NET_BANKING', 'WALLET', 'OTHER'];
export const REWARD_TYPES = ['GIFT', 'VOUCHER', 'DISCOUNT', 'SERVICE', 'OTHER'];
export const CLAIM_STATUSES = ['AVAILABLE', 'CLAIMED', 'DELIVERED', 'CANCELLED', 'REVOKED'];

const notInFuture = (d) => !d || d <= new Date(Date.now() + 60_000);

// ───────────── Auth ─────────────
export const adminLoginBody = z.object({
  email: z.email('Enter a valid email').transform((s) => s.toLowerCase()),
  password: z.string().min(1, 'Password is required').max(200),
});
export const changePasswordBody = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(200),
  newPassword: z.string().min(8, 'New password must be at least 8 characters').max(200),
});
const otpCode = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');

/** Mobile number OR email → { type, value } (normalised). */
export const loginIdentifier = z
  .string({ error: 'Enter your mobile number or email' })
  .trim()
  .min(1, 'Enter your mobile number or email')
  .max(190)
  .transform((raw, ctx) => {
    if (raw.includes('@')) {
      const email = raw.toLowerCase();
      if (!z.email().safeParse(email).success) {
        ctx.addIssue({ code: 'custom', message: 'Enter a valid email address' });
        return z.NEVER;
      }
      return { type: 'email', value: email };
    }
    const parsed = mobile.safeParse(raw);
    if (!parsed.success) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid 10-digit mobile number or an email address' });
      return z.NEVER;
    }
    return { type: 'mobile', value: parsed.data };
  });

export const requiredEmail = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
  z.email({ error: 'Enter a valid email address — your login code is sent there' }).max(190),
);

export const loginOtpBody = z.object({ login: loginIdentifier });
export const registerOtpBody = z.object({ mobile, email: requiredEmail, fullName: z.string().trim().max(120).optional() });
export const customerLoginBody = z.object({ login: loginIdentifier, otp: otpCode });

// ───────────── Customers ─────────────
const customerFields = {
  fullName: requiredText('Full name', 120).refine((s) => /^[\p{L}\p{M} .'-]+$/u.test(s), 'Name can only contain letters, spaces and . \' -'),
  mobile,
  email: optionalEmail,
  dateOfBirth: optionalDate.refine((d) => !d || (d < new Date() && d > new Date('1900-01-01')), 'Enter a valid date of birth'),
  gender: z.preprocess((v) => (v === '' ? null : v), z.enum(GENDERS).nullable()).optional(),
  address: optionalText(500),
  city: optionalText(100),
  pincode,
};

export const customerCreateBody = z.object({ ...customerFields, registrationDate: optionalDate.refine(notInFuture, 'Registration date cannot be in the future') });
export const customerUpdateBody = z
  .object({ ...customerFields, registrationDate: optionalDate.refine(notInFuture, 'Registration date cannot be in the future'), isActive: z.boolean().optional() })
  .partial();
export const selfUpdateBody = z.object({
  fullName: customerFields.fullName.optional(),
  email: customerFields.email,
  dateOfBirth: customerFields.dateOfBirth,
  gender: customerFields.gender,
  address: customerFields.address,
  city: customerFields.city,
  pincode: customerFields.pincode,
});
export const customerRegisterBody = z.object({ ...customerFields, email: requiredEmail, otp: otpCode });

export const customerListQuery = z.object({
  ...pageQuery,
  q: optionalStrQuery,
  cardType: enumQuery(CARD_TYPES),
  minCount: optionalIntQuery,
  maxCount: optionalIntQuery,
  city: optionalStrQuery,
  isActive: optionalBoolQuery,
  from: fromQuery,
  to: toQuery,
  sort: enumQuery(['createdAt', 'fullName', 'silverCount', 'totalSpent', 'totalPurchases', 'registrationDate', 'customerCode']),
});

// ───────────── Purchases ─────────────
const item = z.object({
  productName: requiredText('Product name', 200),
  quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1').max(100_000),
  unitPrice: money('Unit price'),
});

export const purchaseCreateBody = z
  .object({
    customerId: z.coerce.number().int().positive('Select a customer'),
    invoiceNumber: requiredText('Invoice number', 50)
      .transform((s) => s.toUpperCase())
      .refine((s) => /^[A-Z0-9][A-Z0-9/_-]*$/.test(s), 'Invoice number may contain letters, digits, / _ -'),
    purchaseDate: optionalDate.refine(notInFuture, 'Purchase date cannot be in the future'),
    totalAmount: money('Total amount').optional(),
    discount: money('Discount').optional().default(0),
    paymentMethod: z.enum(PAYMENT_METHODS, { error: 'Select a payment method' }),
    items: z.array(item).max(200).optional().default([]),
    isEligible: z.boolean().optional().default(true),
    notes: optionalText(1000),
  })
  .refine((b) => b.items.length > 0 || (b.totalAmount !== undefined && b.totalAmount > 0), {
    message: 'Enter a total amount greater than zero or add products',
    path: ['totalAmount'],
  });

export const purchaseUpdateBody = z.object({
  invoiceNumber: requiredText('Invoice number', 50).transform((s) => s.toUpperCase())
    .refine((s) => /^[A-Z0-9][A-Z0-9/_-]*$/.test(s), 'Invoice number may contain letters, digits, / _ -').optional(),
  purchaseDate: optionalDate.refine(notInFuture, 'Purchase date cannot be in the future'),
  totalAmount: money('Total amount').optional(),
  discount: money('Discount').optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  items: z.array(item).max(200).optional(),
  isEligible: z.boolean().optional(),
  notes: optionalText(1000),
  version: z.coerce.number().int().positive().optional(),
});

export const purchaseCancelBody = z.object({ reason: requiredText('Cancellation reason', 500) });

export const purchaseListQuery = z.object({
  ...pageQuery,
  q: optionalStrQuery,
  invoice: optionalStrQuery,
  customerId: optionalIntQuery,
  paymentMethod: enumQuery(PAYMENT_METHODS),
  status: enumQuery(['ACTIVE', 'CANCELLED']),
  eligible: optionalBoolQuery,
  minAmount: optionalNumQuery,
  maxAmount: optionalNumQuery,
  from: fromQuery,
  to: toQuery,
  sort: enumQuery(['purchaseDate', 'finalAmount', 'invoiceNumber', 'createdAt']),
});

// ───────────── Rewards ─────────────
const rewardFields = {
  name: requiredText('Reward name', 150),
  description: optionalText(1000),
  requiredCount: z.coerce.number({ error: 'Required count must be a number' }).int().min(1, 'Required count must be at least 1').max(100_000),
  rewardType: z.enum(REWARD_TYPES).default('GIFT'),
  rewardValue: z.preprocess((v) => (v === '' ? null : v), money('Reward value').nullable()).optional(),
  isActive: z.boolean().default(true),
  startDate: optionalDate,
  endDate: optionalDate,
};
const datesOk = (b) => !b.startDate || !b.endDate || b.endDate >= b.startDate;
export const rewardCreateBody = z.object(rewardFields).refine(datesOk, { message: 'End date must be after start date', path: ['endDate'] });
export const rewardUpdateBody = z
  .object({ ...rewardFields, rewardType: z.enum(REWARD_TYPES), isActive: z.boolean() })
  .partial()
  .refine(datesOk, { message: 'End date must be after start date', path: ['endDate'] });

export const claimStatusBody = z.object({ status: z.enum(['AVAILABLE', 'CLAIMED', 'DELIVERED', 'CANCELLED']), notes: optionalText(500) });
export const claimListQuery = z.object({
  ...pageQuery,
  q: optionalStrQuery,
  status: enumQuery(CLAIM_STATUSES),
  rewardId: optionalIntQuery,
  customerId: optionalIntQuery,
  from: fromQuery,
  to: toQuery,
});

// ───────────── Settings ─────────────
export const settingsBody = z
  .object({
    programName: requiredText('Program name', 120),
    minPurchaseAmount: money('Minimum purchase amount').refine((n) => n > 0, 'Minimum purchase amount must be greater than zero'),
    multipleCountsPerPurchase: z.boolean(),
    maxCountsPerPurchase: z.coerce.number().int().min(1).max(1000),
    goldThreshold: z.coerce.number().int().min(1, 'Gold threshold must be at least 1').max(100_000),
    goldBenefits: optionalText(5000),
    shopName: requiredText('Shop name', 120),
    contactPhone: optionalText(20),
    contactEmail: optionalEmail,
    contactAddress: optionalText(500),
    currency: z.string().trim().length(3, 'Currency must be a 3-letter code').transform((s) => s.toUpperCase()),
    currencySymbol: requiredText('Currency symbol', 5),
  })
  .partial();

// ───────────── Staff & roles ─────────────
export const adminCreateBody = z.object({
  name: requiredText('Name', 120),
  email: z.email('Enter a valid email').transform((s) => s.toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  roleId: z.coerce.number().int().positive('Select a role'),
});
export const adminUpdateBody = z.object({
  name: requiredText('Name', 120).optional(),
  roleId: z.coerce.number().int().positive().optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(200).optional(),
});
const permList = z.array(z.enum(PERMISSION_KEYS)).max(PERMISSION_KEYS.length);
export const roleCreateBody = z.object({
  key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,48}$/, 'Key must be UPPER_SNAKE_CASE'),
  name: requiredText('Role name', 100),
  description: optionalText(255),
  permissions: permList.default([]),
});
export const roleUpdateBody = z.object({ name: requiredText('Role name', 100).optional(), description: optionalText(255), permissions: permList.optional() });

// ───────────── Reports / misc ─────────────
export const reportQuery = z.object({
  format: enumQuery(['json', 'csv', 'xlsx', 'pdf']),
  cardType: enumQuery(CARD_TYPES),
  minCount: optionalIntQuery,
  maxCount: optionalIntQuery,
  customerId: optionalIntQuery,
  paymentMethod: enumQuery(PAYMENT_METHODS),
  status: enumQuery(['ACTIVE', 'CANCELLED', ...CLAIM_STATUSES]),
  rewardId: optionalIntQuery,
  minAmount: optionalNumQuery,
  maxAmount: optionalNumQuery,
  from: fromQuery,
  to: toQuery,
});

export const loyaltyListQuery = z.object({
  ...pageQuery,
  q: optionalStrQuery,
  customerId: optionalIntQuery,
  action: enumQuery(['COUNT_ADDED', 'COUNT_REMOVED', 'COUNT_ADJUSTED', 'REWARD_UNLOCKED', 'REWARD_REVOKED', 'GOLD_UPGRADE', 'GOLD_DOWNGRADE']),
  from: fromQuery,
  to: toQuery,
});

export const auditListQuery = z.object({
  ...pageQuery,
  entity: optionalStrQuery,
  entityId: optionalStrQuery,
  action: optionalStrQuery,
  adminId: optionalIntQuery,
  from: fromQuery,
  to: toQuery,
});

export const recalcBody = z.object({ dryRun: z.boolean().default(true) });
