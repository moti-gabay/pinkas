import { describe, expect, it } from 'vitest';
import { addMonths, currentMonth, daysInMonth, monthRange } from './month';

describe('month', () => {
  it('adds and subtracts months across year boundaries', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-03', -15)).toBe('2024-12');
    expect(addMonths('2026-03', 0)).toBe('2026-03');
  });

  it('computes month ranges with leap years', () => {
    expect(monthRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(monthRange('2100-02').to).toBe('2100-02-28');
    expect(monthRange('2026-04').to).toBe('2026-04-30');
    expect(daysInMonth('2026-10')).toBe(31);
  });

  it('resolves the current month in Asia/Jerusalem', () => {
    // 2026-03-31 23:30 UTC is already April 1st in Jerusalem (UTC+3 in DST).
    expect(currentMonth(new Date('2026-03-31T23:30:00Z'))).toBe('2026-04');
    expect(currentMonth(new Date('2026-03-31T12:00:00Z'))).toBe('2026-03');
  });
});
