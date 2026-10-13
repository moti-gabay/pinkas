import { encode } from 'iconv-lite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from '../test-app.js';

const bankCsv = (rows: string[], total?: string) =>
  [
    'תאריך,תאריך ערך,תיאור,אסמכתא,חובה,זכות,יתרה',
    ...rows,
    ...(total ? [`סה"כ,,,,${total},,`] : []),
  ].join('\r\n');

describe('import flow', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let accountId: string;
  beforeAll(async () => {
    t = await startTestApp();
    const res = await t.app.inject({
      method: 'POST',
      url: '/sources/file',
      headers: t.auth,
      payload: {
        displayName: 'פפר',
        account: { displayName: 'פפר', type: 'checking', externalId: '98-765-432109' },
      },
    });
    accountId = res.json().account.id;
  }, 120_000);
  afterAll(async () => {
    await t.stop();
  });

  async function upload(bytes: Uint8Array, filename: string) {
    const boundary = 'pinkasboundary';
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="accountId"\r\n\r\n${accountId}\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      Buffer.from(bytes),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return t.app.inject({
      method: 'POST',
      url: '/imports',
      headers: { ...t.auth, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
  }

  it('upload → preview → confirm → idempotent re-import, with windows-1255 and a total row', async () => {
    const csv = bankCsv(
      [
        '07/03/2026,07/03/2026,שופרסל דיל,100001,123.45,,5000.00',
        '08/03/2026,08/03/2026,העברה מ- לקוח בע"מ,100002,,4000.00,9000.00',
        '08/03/2026,08/03/2026,פז,100003,250.00,,8750.00',
      ],
      '3626.55',
    );
    const bytes = encode(csv, 'windows-1255');
    const up = await upload(bytes, 'pepper.csv');
    expect(up.statusCode).toBe(200);
    const { importId } = up.json();
    const preview = await t.app.inject({
      method: 'GET',
      url: `/imports/${importId}/preview`,
      headers: t.auth,
    });
    expect(preview.statusCode).toBe(200);
    const p = preview.json();
    expect(p.mapping).toMatchObject({
      date: 'תאריך',
      debit: 'חובה',
      credit: 'זכות',
      description: 'תיאור',
      identifier: 'אסמכתא',
    });
    expect(p.parsed.counts).toMatchObject({ insert: 3, duplicate: 0, error: 0 });
    expect(p.parsed.computedTotalAgorot).toBe(362655);
    expect(p.parsed.statementTotalAgorot).toBe(-362655); // printed in the debit column
    expect(p.parsed.reconciled).toBe(true);
    const confirm = await t.app.inject({
      method: 'POST',
      url: `/imports/${importId}/confirm`,
      headers: t.auth,
      payload: {},
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json()).toMatchObject({ rowsAdded: 3, rowsSkipped: 0, reconciled: true });

    const report = await t.app.inject({
      method: 'GET',
      url: '/reports/month/2026-03',
      headers: t.auth,
    });
    expect(report.json()).toMatchObject({
      incomeAgorot: 400000,
      expensesAgorot: 37345,
      netAgorot: 362655,
    });

    // Same file again → refused as duplicate; same rows in a differently named file → zero new rows.
    expect((await upload(bytes, 'pepper.csv')).statusCode).toBe(409);
    const up2 = await upload(encode(`${csv}\r\n`, 'windows-1255'), 'pepper2.csv');
    const id2 = up2.json().importId;
    const p2 = (
      await t.app.inject({ method: 'GET', url: `/imports/${id2}/preview`, headers: t.auth })
    ).json();
    expect(p2.parsed.counts).toMatchObject({ insert: 0, duplicate: 3 });
    const c2 = (
      await t.app.inject({
        method: 'POST',
        url: `/imports/${id2}/confirm`,
        headers: t.auth,
        payload: {},
      })
    ).json();
    expect(c2).toMatchObject({ rowsAdded: 0, rowsSkipped: 3 });
    const list = await t.app.inject({
      method: 'GET',
      url: '/transactions?from=2026-03-01&to=2026-03-31',
      headers: t.auth,
    });
    expect(list.json().total).toBe(3);
  });

  it('blocks confirm when the statement total does not reconcile unless acknowledged', async () => {
    const csv = bankCsv(['01/04/2026,01/04/2026,רמי לוי,200001,100.00,,1000.00'], '999.99');
    const { importId } = (await upload(Buffer.from(`\ufeff${csv}`, 'utf8'), 'april.csv')).json();
    const p = (
      await t.app.inject({ method: 'GET', url: `/imports/${importId}/preview`, headers: t.auth })
    ).json();
    expect(p.parsed.reconciled).toBe(false);
    const blocked = await t.app.inject({
      method: 'POST',
      url: `/imports/${importId}/confirm`,
      headers: t.auth,
      payload: {},
    });
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().code).toBe('IMPORT_NOT_RECONCILED');
    const ok = await t.app.inject({
      method: 'POST',
      url: `/imports/${importId}/confirm`,
      headers: t.auth,
      payload: { acknowledgeMismatch: true },
    });
    expect(ok.json()).toMatchObject({ rowsAdded: 1, reconciled: false });
  });

  it('rejects disguised and oversized uploads', async () => {
    const html = Buffer.from('<html><body>not a csv</body></html>');
    expect((await upload(html, 'evil.csv')).statusCode).toBe(400);
  });

  it('edit category → proposes a learned rule → rule recategorizes matching rows', async () => {
    const list = (
      await t.app.inject({
        method: 'GET',
        url: `/transactions?q=${encodeURIComponent('פז')}`,
        headers: t.auth,
      })
    ).json();
    const txn = list.items[0];
    const cats = (await t.app.inject({ method: 'GET', url: '/categories', headers: t.auth })).json<
      { id: string; slug: string }[]
    >();
    const parking = cats.find((c) => c.slug === 'transport.parking');
    if (!parking) throw new Error('taxonomy missing transport.parking');
    const edit = await t.app.inject({
      method: 'PATCH',
      url: `/transactions/${txn.id}`,
      headers: t.auth,
      payload: { categoryId: parking.id },
    });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().transaction.categorySource).toBe('manual');
    expect(edit.json().proposedRule).toMatchObject({
      pattern: 'פז',
      match: 'exact',
      alreadyExists: false,
    });
    const rule = await t.app.inject({
      method: 'POST',
      url: '/rules',
      headers: t.auth,
      payload: { ...edit.json().proposedRule, origin: 'learned' },
    });
    expect(rule.statusCode).toBe(201);
    expect(rule.json().rule.priority).toBe(20);
  });
});
