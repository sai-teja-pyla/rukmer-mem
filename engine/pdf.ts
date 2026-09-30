import { PDFParse } from 'pdf-parse';

function toBytes(input: Buffer | Uint8Array | ArrayBuffer) {
  if (Buffer.isBuffer(input)) return new Uint8Array(input);
  if (input instanceof Uint8Array) return new Uint8Array(input);
  return new Uint8Array(input);
}

export async function textFromPdf(input: Buffer | Uint8Array | ArrayBuffer) {
  const parser = new PDFParse({ data: toBytes(input) });
  try {
    const result = await parser.getText();
    const text = (result.text || '').replace(/\u0000/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
    if (!text) throw new Error('No extractable text in this PDF (it may be scanned images only)');
    return { text, pages: result.total || result.pages?.length || 0 };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

export function looksLikePdf(name?: string, mime?: string, url?: string) {
  const n = (name || url || '').toLowerCase();
  return mime === 'application/pdf' || n.endsWith('.pdf');
}

export async function textFromPdfBase64(b64: string) {
  const raw = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64;
  return textFromPdf(Buffer.from(raw, 'base64'));
}
