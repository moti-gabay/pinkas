/** Month math on YYYY-MM strings. No Date arithmetic: civil months in Asia/Jerusalem. */

const jerusalem = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Jerusalem',
  year: 'numeric',
  month: '2-digit',
});

export function currentMonth(now: Date = new Date()): string {
  const parts = jerusalem.formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${y}-${m}`;
}

function split(month: string): [number, number] {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new RangeError(`expected YYYY-MM, got ${month}`);
  return [Number(m[1]), Number(m[2])];
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = split(month);
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export function daysInMonth(month: string): number {
  const [y, m] = split(month);
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** First and last civil day of the month as YYYY-MM-DD. */
export function monthRange(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${month}-${String(daysInMonth(month)).padStart(2, '0')}` };
}

export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

const jerusalemDateTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Jerusalem',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** ISO timestamp → "DD/MM/YYYY HH:MM" in Asia/Jerusalem. */
export function formatDateTime(iso: string): string {
  const p = new Map(jerusalemDateTime.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const hour = p.get('hour') === '24' ? '00' : (p.get('hour') ?? '00');
  return `${p.get('day') ?? '??'}/${p.get('month') ?? '??'}/${p.get('year') ?? '????'} ${hour}:${p.get('minute') ?? '00'}`;
}
