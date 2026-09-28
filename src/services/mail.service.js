import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

/**
 * Email delivery via Nodemailer.
 *  - SMTP_HOST set  → real SMTP (Gmail app password, Zoho, Brevo, SES SMTP, Mailtrap …)
 *  - SMTP_HOST empty → "console" mode: the email is printed to the server log (development only)
 */
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!env.smtp.host) return null;
  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure, // true for port 465, false for 587 (STARTTLS)
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    pool: true,
    maxConnections: 3,
  });
  return transporter;
}

export const mailConfigured = () => !!env.smtp.host;

/** Called at startup: logs whether SMTP credentials work, without blocking the server. */
export async function verifyMailTransport() {
  const t = getTransporter();
  if (!t) {
    if (!env.isTest) console.warn('[mail] SMTP_HOST not set — emails will be printed to the console (development mode).');
    return false;
  }
  try {
    await t.verify();
    console.log(`[mail] SMTP ready (${env.smtp.host}:${env.smtp.port})`);
    return true;
  } catch (e) {
    console.error(`[mail] SMTP connection failed: ${e.message}`);
    return false;
  }
}

export async function sendMail({ to, subject, text, html }) {
  const t = getTransporter();
  if (!t) {
    if (env.isProd) throw new Error('Email is not configured (SMTP_HOST missing)');
    if (!env.isTest) console.log(`[mail:console] → ${to}\n  Subject: ${subject}\n  ${text.replace(/\n/g, '\n  ')}`);
    return { console: true };
  }
  const info = await t.sendMail({ from: env.smtp.from, to, subject, text, html });
  if (!env.isProd && !env.isTest) {
    // Ethereal (nodemailer's fake SMTP) returns a browser preview link; real providers return false
    const preview = nodemailer.getTestMessageUrl(info);
    console.log(`[mail] sent "${subject.replace(/^\d{6}/, '******')}" → ${to}${preview ? ` · preview: ${preview}` : ''}`);
  }
  return info;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Branded OTP email (plain-text + HTML). */
export function otpEmail({ code, name, shopName, purpose, minutes }) {
  const action = purpose === 'REGISTER' ? 'complete your registration' : 'log in to your rewards account';
  const greeting = name ? `Hi ${name},` : 'Hello,';
  const text = `${greeting}

Your ${shopName} verification code is: ${code}

Use it to ${action}. It expires in ${minutes} minutes.
If you didn't request this, you can ignore this email. Never share this code with anyone — our staff will never ask for it.

— ${shopName}`;

  const shop = escapeHtml(shopName);
  const html = `<!doctype html>
<html><body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
        <tr><td style="background:#4338ca;padding:20px 28px;color:#ffffff;font-size:18px;font-weight:700">${shop}</td></tr>
        <tr><td style="padding:28px">
          <p style="margin:0 0 12px;font-size:15px">${escapeHtml(greeting)}</p>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.5">Use this code to ${action}:</p>
          <p style="margin:0 0 20px;text-align:center">
            <span style="display:inline-block;padding:14px 22px;border-radius:12px;background:#eef2ff;color:#312e81;font-size:32px;font-weight:800;letter-spacing:10px;font-family:Consolas,Menlo,monospace">${escapeHtml(code)}</span>
          </p>
          <p style="margin:0 0 8px;font-size:13px;color:#475569">This code expires in <b>${minutes} minutes</b>.</p>
          <p style="margin:0;font-size:13px;color:#475569">If you didn't request it, ignore this email. Never share this code — our staff will never ask for it.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject: `${code} is your ${shopName} verification code`, text, html };
}

/** "akbar@gmail.com" → "ak***@gmail.com" (shown in the UI so the user knows where to look). */
export function maskEmail(email) {
  const [user, domain] = String(email).split('@');
  if (!domain) return email;
  const visible = user.slice(0, Math.min(2, Math.max(1, user.length - 1)));
  return `${visible}${'*'.repeat(Math.max(3, user.length - visible.length))}@${domain}`;
}
