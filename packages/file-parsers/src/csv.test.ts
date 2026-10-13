import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv } from './csv.js';

describe('detectDelimiter', () => {
  it('picks comma, semicolon or tab by majority of lines', () => {
    expect(detectDelimiter('a,b\n1,2\n')).toBe(',');
    expect(detectDelimiter('a;b\n1;2\n')).toBe(';');
    expect(detectDelimiter('a\tb\n1\t2\n')).toBe('\t');
  });

  it('tolerates a delimiter-less title line', () => {
    expect(detectDelimiter('דוח תנועות\nתאריך,סכום\n01/03/2026,1\n')).toBe(',');
  });

  it('returns undefined when most lines have no delimiter', () => {
    expect(detectDelimiter('hello\nworld\nfoo,bar\n')).toBeUndefined();
    expect(detectDelimiter('')).toBeUndefined();
  });
});

describe('parseCsv', () => {
  it('keeps strings, quoted fields, ragged rows and blank lines as empty records', () => {
    const rows = parseCsv('a,b,c\n"1,5",x\n\n3,"q ""r""",z,extra\n', ',');
    expect(rows).toEqual([['a', 'b', 'c'], ['1,5', 'x'], [], ['3', 'q "r"', 'z', 'extra']]);
  });
});
