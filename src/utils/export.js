import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

function display(value, type) {
  if (value === null || value === undefined) return '';
  if (type === 'date' || type === 'datetime') return fmtDate(value);
  if (type === 'money') return Number(value).toFixed(2);
  return String(value);
}

/** Neutralise spreadsheet formula injection (=, +, -, @ at the start of a cell). */
const safeCell = (s) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

export function toCsv({ columns, rows }) {
  const esc = (s) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [columns.map((c) => esc(c.label)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => esc(safeCell(display(row[c.key], c.type)))).join(','));
  // BOM so Excel opens UTF-8 (₹, Hindi names) correctly
  return `﻿${lines.join('\r\n')}\r\n`;
}

export async function toXlsx({ title, columns, rows }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Apni Dukaan';
  const ws = wb.addWorksheet(title.slice(0, 31));
  ws.columns = columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 4) }));
  for (const row of rows) {
    const out = {};
    for (const c of columns) {
      const v = row[c.key];
      if (v === null || v === undefined) out[c.key] = null;
      else if (c.type === 'date' || c.type === 'datetime') out[c.key] = new Date(v);
      else if (c.type === 'money' || c.type === 'int') out[c.key] = Number(v);
      else out[c.key] = safeCell(String(v));
    }
    ws.addRow(out);
  }
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.type === 'money') col.numFmt = '#,##0.00';
    if (c.type === 'date') col.numFmt = 'dd mmm yyyy';
  });
  return wb.xlsx.writeBuffer();
}

/** Simple tabular PDF (landscape A4). Suited to reports up to a few thousand rows. */
export function toPdf({ title, columns, rows }, { shopName = 'Apni Dukaan' } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const width = doc.page.width - 60;
    const colW = width / columns.length;
    const rowH = 16;

    const header = () => {
      doc.font('Helvetica-Bold').fontSize(8);
      const y = doc.y;
      doc.rect(30, y - 2, width, rowH).fill('#eef2f7').fillColor('#111');
      columns.forEach((c, i) => doc.text(c.label, 32 + i * colW, y + 2, { width: colW - 4, ellipsis: true, lineBreak: false }));
      doc.y = y + rowH;
      doc.font('Helvetica').fontSize(8);
    };

    doc.font('Helvetica-Bold').fontSize(14).text(`${shopName} — ${title}`);
    doc.font('Helvetica').fontSize(8).fillColor('#555').text(`Generated ${new Date().toLocaleString('en-IN')} · ${rows.length} rows`).fillColor('#111');
    doc.moveDown(0.6);
    header();

    for (const row of rows) {
      if (doc.y + rowH > doc.page.height - 30) {
        doc.addPage();
        header();
      }
      const y = doc.y;
      columns.forEach((c, i) => {
        // PDF standard fonts lack ₹; money is shown as plain numbers
        doc.text(display(row[c.key], c.type), 32 + i * colW, y + 2, { width: colW - 4, ellipsis: true, lineBreak: false });
      });
      doc.moveTo(30, y + rowH - 1).lineTo(30 + width, y + rowH - 1).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
      doc.y = y + rowH;
    }
    doc.end();
  });
}
