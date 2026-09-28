import path from 'node:path';
import dotenv from 'dotenv';

const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
dotenv.config({ path: path.resolve(process.cwd(), envFile), quiet: true });

const bool = (v, def = false) => (v === undefined ? def : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));
const int = (v, def) => (Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Number(v) : def);

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',
  port: int(process.env.PORT, 4000),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
  jwtSecret: process.env.JWT_SECRET || '',
  adminSessionHours: int(process.env.ADMIN_SESSION_HOURS, 12),
  customerSessionDays: int(process.env.CUSTOMER_SESSION_DAYS, 30),
  cookieSecure: bool(process.env.COOKIE_SECURE, process.env.NODE_ENV === 'production'),
  otpTtlMinutes: int(process.env.OTP_TTL_MINUTES, 5),
  otpMaxAttempts: int(process.env.OTP_MAX_ATTEMPTS, 5),
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || process.env.SMTP_USER || 'Apni Dukaan <no-reply@localhost>',
  },
  // Never echo OTPs in production, whatever the env says
  otpDevEcho: process.env.NODE_ENV !== 'production' && bool(process.env.OTP_DEV_ECHO, false),
  uploadDir: path.resolve(process.cwd(), 'uploads'),
};

export function assertEnv() {
  const problems = [];
  if (!process.env.DATABASE_URL) problems.push('DATABASE_URL is not set');
  if (!env.jwtSecret || env.jwtSecret.length < 32) problems.push('JWT_SECRET must be at least 32 characters');
  if (env.isProd && env.jwtSecret.startsWith('change-me')) problems.push('JWT_SECRET still has the placeholder value');
  if (env.isProd && !env.cookieSecure) problems.push('COOKIE_SECURE must be true in production');
  if (env.isProd && !env.smtp.host) problems.push('SMTP_HOST must be set in production (OTP codes are sent by email)');
  if (problems.length) {
    throw new Error(`Invalid environment configuration:\n - ${problems.join('\n - ')}`);
  }
}
