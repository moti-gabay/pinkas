import { describe, expect, it } from 'vitest';
import iconv from 'iconv-lite';
import { decodeText } from './encoding.js';

const hebrew = 'תאריך,סכום\n01/03/2026,-12.50\n';

describe('decodeText', () => {
  it('strips a UTF-8 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(hebrew)]);
    expect(decodeText(bytes)).toEqual({ text: hebrew, encoding: 'utf8' });
  });

  it('accepts valid UTF-8 without a BOM', () => {
    expect(decodeText(new TextEncoder().encode(hebrew))).toEqual({
      text: hebrew,
      encoding: 'utf8',
    });
  });

  it('decodes UTF-16 LE and BE by BOM', () => {
    const le = iconv.encode(hebrew, 'utf16-le', { addBOM: true });
    const be = iconv.encode(hebrew, 'utf16-be', { addBOM: true });
    expect(decodeText(le)).toEqual({ text: hebrew, encoding: 'utf16le' });
    expect(decodeText(be)).toEqual({ text: hebrew, encoding: 'utf16be' });
  });

  it('falls back to windows-1255 for non-UTF-8 bytes', () => {
    const bytes = iconv.encode(hebrew, 'windows-1255');
    expect(decodeText(bytes)).toEqual({ text: hebrew, encoding: 'windows-1255' });
  });
});
