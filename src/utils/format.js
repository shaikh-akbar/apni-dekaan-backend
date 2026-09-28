export const pad = (n, len) => String(n).padStart(len, '0');

export const customerCodeFor = (id) => `AD${pad(id, 6)}`;

export const goldCardNumberFor = (customerId, date = new Date()) => `GOLD-${date.getFullYear()}-${pad(customerId, 6)}`;

export const toNumber = (v) => (v === null || v === undefined ? 0 : typeof v === 'number' ? v : Number(v));

/** Parse a YYYY-MM-DD (or ISO) string as a date range bound. */
export function dayStart(s) {
  if (!s) return undefined;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setHours(0, 0, 0, 0);
  return d;
}
export function dayEnd(s) {
  if (!s) return undefined;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setHours(23, 59, 59, 999);
  return d;
}

export function clientIp(req) {
  return (req.ip || req.socket?.remoteAddress || '').slice(0, 64) || null;
}
