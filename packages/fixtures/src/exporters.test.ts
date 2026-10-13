import iconv from 'iconv-lite';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { BANK_HEADERS, CARD_HEADERS, TOTAL_LABEL, formatAmount, toCsv } from './export-csv.js';
import { jerusalemMidnightIso, toScraperResult } from './export-scraper.js';
import { toXlsx } from './export-xlsx.js';
import { CHECKING_ID, MAX_ID, generateHousehold } from './generate.js';

const h = generateHousehold({ seed: 42, endMonth: '2026-10', months: 12 });
const checking = h.transactions.filter((t) => t.accountId === CHECKING_ID);
const max = h.transactions.filter((t) => t.accountId === MAX_ID);

/** Minimal RFC-4180 reader: CRLF rows, optional quotes, doubled quotes. */
function parseCsv(text: string): string[][] {
  return text
    .replace(/^\uFEFF/, '')
    .split('\r\n')
    .filter((line) => line !== '')
    .map((line) => {
      const cells: string[] = [];
      let cur = '';
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i]!;
        if (quoted) {
          if (c !== '"') cur += c;
          else if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else quoted = false;
        } else if (c === '"') quoted = true;
        else if (c === ',') {
          cells.push(cur);
          cur = '';
        } else cur += c;
      }
      cells.push(cur);
      return cells;
    });
}

const parseAmount = (s: string): number => Math.round(Number(s.replace(/,/g, '')) * 100);

describe('toScraperResult', () => {
  const result = toScraperResult(h, MAX_ID);
  const txns = result.accounts[0]!.txns;

  it('mirrors every row with decimal amounts equal to agorot/100', () => {
    expect(result.success).toBe(true);
    expect(result.accounts[0]!.accountNumber).toBe('4580');
    expect(txns.length).toBe(max.length);
    txns.forEach((txn, i) => {
      const row = max[i]!;
      expect(txn.chargedAmount).toBe(row.chargedAmountAgorot / 100);
      expect(txn.originalAmount).toBe((row.originalAmountMinor ?? row.chargedAmountAgorot) / 100);
      expect(txn.originalCurrency).toBe(row.originalCurrency ?? 'ILS');
      expect(txn.description).toBe(row.descriptionRaw);
      expect(txn.status).toBe(row.status);
      expect(txn.date).toBe(jerusalemMidnightIso(row.txnDate));
      expect(txn.date.startsWith(row.txnDate)).toBe(true);
      expect(txn.processedDate.startsWith(row.processedDate!)).toBe(true);
      expect('identifier' in txn).toBe(false);
    });
  });

  it('emits installments and memos only where present', () => {
    const inst = txns.filter((t) => t.type === 'installments');
    expect(inst.length).toBe(12);
    expect(inst[0]!.installments).toEqual({ number: 1, total: 12 });
    expect(txns.filter((t) => t.memo === 'הפרשי שער').length).toBe(1);
    expect(txns.filter((t) => t.type === 'normal').every((t) => !('installments' in t))).toBe(true);
  });

  it('uses Jerusalem midnight with the DST-aware offset', () => {
    expect(jerusalemMidnightIso('2026-01-15')).toBe('2026-01-15T00:00:00.000+02:00');
    expect(jerusalemMidnightIso('2026-07-15')).toBe('2026-07-15T00:00:00.000+03:00');
    expect(jerusalemMidnightIso('2026-03-27')).toBe('2026-03-27T00:00:00.000+02:00');
    expect(jerusalemMidnightIso('2026-03-28')).toBe('2026-03-28T00:00:00.000+03:00');
    expect(jerusalemMidnightIso('2026-10-25')).toBe('2026-10-25T00:00:00.000+03:00');
    expect(jerusalemMidnightIso('2026-10-26')).toBe('2026-10-26T00:00:00.000+02:00');
  });

  it('sets identifiers and a running balance for the checking account', () => {
    const bank = toScraperResult(h, CHECKING_ID).accounts[0]!;
    expect(bank.txns.every((t) => typeof t.identifier === 'string')).toBe(true);
    expect(bank.balance).toBe(
      (2_500_000 + checking.reduce((a, t) => a + t.chargedAmountAgorot, 0)) / 100,
    );
  });
});

describe('toCsv', () => {
  it('formats amounts with thousands separators and two decimals', () => {
    expect(formatAmount(123456)).toBe('1,234.56');
    expect(formatAmount(-5)).toBe('-0.05');
    expect(formatAmount(100000000)).toBe('1,000,000.00');
  });

  it('round-trips the bank layout with a total row', () => {
    const bytes = toCsv(h, CHECKING_ID, { layout: 'bank', encoding: 'utf8', withTotalRow: true });
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    const rows = parseCsv(text);
    expect(rows[0]).toEqual([...BANK_HEADERS]);
    expect(rows.length).toBe(checking.length + 2);
    const total = rows.at(-1)!;
    expect(total[0]).toBe(TOTAL_LABEL);
    const debit = checking
      .filter((t) => t.chargedAmountAgorot < 0)
      .reduce((a, t) => a - t.chargedAmountAgorot, 0);
    const credit = checking
      .filter((t) => t.chargedAmountAgorot > 0)
      .reduce((a, t) => a + t.chargedAmountAgorot, 0);
    expect(parseAmount(total[4]!)).toBe(debit);
    expect(parseAmount(total[5]!)).toBe(credit);
    expect(parseAmount(total[6]!)).toBe(2_500_000 + credit - debit);
    const first = rows[1]!;
    expect(first[0]).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(first[2]).toBe(checking[0]!.descriptionRaw);
    expect(first[3]).toBe(checking[0]!.externalIdentifier);
  });

  it('round-trips the card layout without a total row', () => {
    const rows = parseCsv(
      new TextDecoder().decode(toCsv(h, MAX_ID, { layout: 'card', encoding: 'utf8' })),
    );
    expect(rows[0]).toEqual([...CARD_HEADERS]);
    expect(rows.length).toBe(max.length + 1);
    const fx = rows.find((r) => r[4] === 'USD')!;
    expect(fx[3]).toBe('79.99');
    expect(rows.some((r) => r[6] === 'תשלום 1 מתוך 12')).toBe(true);
    const refundIdx = max.findIndex((t) => t.tag === 'refund');
    expect(rows[refundIdx + 1]![5]!.startsWith('-')).toBe(true);
  });

  it('encodes windows-1255 losslessly for the bank layout', () => {
    const utf8 = new TextDecoder()
      .decode(toCsv(h, CHECKING_ID, { layout: 'bank', encoding: 'utf8', withTotalRow: true }))
      .replace(/^\uFEFF/, '');
    const cp = toCsv(h, CHECKING_ID, {
      layout: 'bank',
      encoding: 'windows-1255',
      withTotalRow: true,
    });
    expect(cp.length).toBeLessThan(new TextEncoder().encode(utf8).length);
    expect(iconv.decode(Buffer.from(cp), 'windows-1255')).toBe(utf8);
  });
});

describe('toXlsx', () => {
  it('writes a title, headers, rows and a total row', async () => {
    const bytes = await toXlsx(h, CHECKING_ID, { layout: 'bank' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.slice().buffer);
    const sheet = wb.worksheets[0]!;
    expect(sheet.rowCount).toBe(checking.length + 4);
    expect(sheet.getCell(1, 1).value).toContain('12-345-671234');
    expect(sheet.getRow(3).values).toEqual([undefined, ...BANK_HEADERS]);
    expect(sheet.getCell(4, 3).value).toBe(checking[0]!.descriptionRaw);
    expect(sheet.getCell(sheet.rowCount, 1).value).toBe(TOTAL_LABEL);
    expect(typeof sheet.getCell(sheet.rowCount, 7).value).toBe('number');
  });

  it('writes the card layout', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await toXlsx(h, MAX_ID, { layout: 'card' })).slice().buffer);
    const sheet = wb.worksheets[0]!;
    expect(sheet.rowCount).toBe(max.length + 4);
    expect(sheet.getRow(3).values).toEqual([undefined, ...CARD_HEADERS]);
    expect(sheet.getCell(4, 6).value).toBe(-max[0]!.chargedAmountAgorot / 100);
  });
});
