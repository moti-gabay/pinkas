import { detect } from 'chardet';
import iconv from 'iconv-lite';

export interface DecodedText {
  text: string;
  encoding: string;
}

/**
 * BOM first, then strict UTF-8, otherwise windows-1255: Israeli bank CSV exports are almost
 * always cp1255 and chardet routinely misreads short Hebrew files as a Western code page, so it is
 * only consulted for BOM-less UTF-16.
 */
export function decodeText(buffer: Uint8Array): DecodedText {
  if (startsWith(buffer, [0xef, 0xbb, 0xbf])) {
    return { text: new TextDecoder('utf-8').decode(buffer.subarray(3)), encoding: 'utf8' };
  }
  if (startsWith(buffer, [0xff, 0xfe])) {
    return { text: iconv.decode(buffer, 'utf16-le'), encoding: 'utf16le' };
  }
  if (startsWith(buffer, [0xfe, 0xff])) {
    return { text: iconv.decode(buffer, 'utf16-be'), encoding: 'utf16be' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'utf8' };
  } catch {
    // Not valid UTF-8: fall through to the legacy code pages.
  }
  const hint = detect(buffer);
  if (hint === 'UTF-16LE') return { text: iconv.decode(buffer, 'utf16-le'), encoding: 'utf16le' };
  if (hint === 'UTF-16BE') return { text: iconv.decode(buffer, 'utf16-be'), encoding: 'utf16be' };
  return { text: iconv.decode(buffer, 'windows-1255'), encoding: 'windows-1255' };
}

function startsWith(buffer: Uint8Array, prefix: number[]): boolean {
  return prefix.every((b, i) => buffer[i] === b);
}
