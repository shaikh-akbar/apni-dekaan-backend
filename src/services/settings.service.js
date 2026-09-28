import { prisma } from '../config/prisma.js';
import { audit } from './audit.service.js';

const SETTINGS_ID = 1;

/** Returns the single settings row, creating it with defaults on first access. */
export async function getSettings(db = prisma) {
  const row = await db.loyaltySettings.findUnique({ where: { id: SETTINGS_ID } });
  if (row) return row;
  return db.loyaltySettings.upsert({ where: { id: SETTINGS_ID }, update: {}, create: { id: SETTINGS_ID } });
}

/** Rule values the LoyaltyService needs, as plain numbers. */
export function rulesFrom(settings) {
  return {
    minAmount: Number(settings.minPurchaseAmount),
    multiple: settings.multipleCountsPerPurchase,
    maxPerPurchase: settings.maxCountsPerPurchase,
    goldThreshold: settings.goldThreshold,
  };
}

/** Public, non-sensitive subset shown on customer-facing pages. */
export function publicSettings(s) {
  return {
    programName: s.programName,
    shopName: s.shopName,
    shopLogo: s.shopLogo,
    contactPhone: s.contactPhone,
    contactEmail: s.contactEmail,
    contactAddress: s.contactAddress,
    currency: s.currency,
    currencySymbol: s.currencySymbol,
    minPurchaseAmount: s.minPurchaseAmount,
    multipleCountsPerPurchase: s.multipleCountsPerPurchase,
    maxCountsPerPurchase: s.maxCountsPerPurchase,
    goldThreshold: s.goldThreshold,
    goldBenefits: s.goldBenefits,
  };
}

/**
 * Changing settings only affects purchases recorded from now on. Each purchase stores
 * the rule snapshot it was evaluated with, so history is never silently recalculated.
 */
export async function updateSettings(data, admin, ip) {
  return prisma.$transaction(async (tx) => {
    const before = await getSettings(tx);
    const after = await tx.loyaltySettings.update({
      where: { id: SETTINGS_ID },
      data: { ...data, updatedById: admin.id },
    });
    await audit(tx, { admin, action: 'SETTINGS_UPDATED', entity: 'settings', entityId: SETTINGS_ID, before, after, ip });
    return after;
  });
}
