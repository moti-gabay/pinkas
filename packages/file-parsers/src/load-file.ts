import { fileTypeFromBuffer } from 'file-type';
import { PinkasError } from '@pinkas/shared';
import { decodeText } from './encoding.js';
import { detectDelimiter, parseCsv } from './csv.js';
import { parseXlsx } from './xlsx.js';
import type { LoadedFile } from './types.js';

export interface LoadHint {
  filename?: string;
  mime?: string;
}

/**
 * Sniffs real content (zip signature for xlsx, text heuristics for CSV). The filename and mime
 * are untrusted and only label the result or the error.
 */
export async function loadFile(buffer: Uint8Array, hint: LoadHint): Promise<LoadedFile> {
  const detected = await fileTypeFromBuffer(buffer);
  if (detected) {
    if (detected.ext === 'xlsx') return { format: 'xlsx', tables: await parseXlsx(buffer) };
    const why =
      detected.ext === 'pdf' ? 'PDF import is not implemented yet' : 'unsupported file type';
    throw unsupported(why, hint, detected.mime);
  }

  const { text, encoding } = decodeText(buffer);
  if (!looksLikeText(text)) throw unsupported('binary content', hint);
  if (looksLikeHtml(text)) throw unsupported('HTML content', hint);
  const delimiter = detectDelimiter(text);
  if (!delimiter) throw unsupported('no CSV delimiter found', hint);

  const stem = hint.filename?.replace(/\.[^.]+$/, '');
  const name = stem === undefined || stem === '' ? 'csv' : stem;
  return { format: 'csv', encoding, tables: [{ name, rows: parseCsv(text, delimiter) }] };
}

function unsupported(reason: string, hint: LoadHint, detectedMime?: string): PinkasError {
  return new PinkasError('UPLOAD_UNSUPPORTED', `cannot load file: ${reason}`, {
    details: { reason, filename: hint.filename, mime: hint.mime, detectedMime },
  });
}

function looksLikeText(text: string): boolean {
  if (text.length === 0) return false;
  const sample = text.slice(0, 4096);
  // eslint-disable-next-line no-control-regex -- we are looking for control bytes on purpose.
  const control = sample.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F�]/g)?.length ?? 0;
  return control === 0 || control / sample.length < 0.01;
}

function looksLikeHtml(text: string): boolean {
  return /<\s*(!doctype|html|head|body|table|script|meta)\b/i.test(text.slice(0, 1024));
}
