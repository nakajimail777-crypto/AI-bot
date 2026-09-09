import { createHash } from 'node:crypto';
export const MAX_PDF_BYTES = 3 * 1024 * 1024;
export function validatePdfAttachment(value) {
  if (value == null) return null;
  const reject = message => { throw new Error(message); };
  if (typeof value !== 'object' || Array.isArray(value) || value.mimeType !== 'application/pdf' ||
      typeof value.name !== 'string' || !value.name.trim() || value.name.length > 160 ||
      /[\x00-\x1f\x7f]/.test(value.name) || !/\.pdf$/i.test(value.name)) {
    reject('添付できるのはPDFファイルだけです。');
  }
  if (typeof value.data !== 'string' || !value.data.length || value.data.length > Math.ceil(MAX_PDF_BYTES / 3) * 4 ||
      value.data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data)) {
    reject('PDFは3MB以下のファイルを選んでください。');
  }
  const bytes = Buffer.from(value.data, 'base64');
  if (bytes.length > MAX_PDF_BYTES || bytes.toString('base64') !== value.data || bytes.subarray(0,5).toString('ascii') !== '%PDF-') {
    reject('PDFを読み取れません。正しいPDFファイルを選び直してください。');
  }
  return { name: value.name.trim(), mimeType: 'application/pdf', data: value.data, sha256: createHash('sha256').update(bytes).digest('hex') };
}
export function pdfMessageText(text, pdf) {
  return pdf ? `${text}\n\n［添付PDF：${pdf.name}］` : text;
}
