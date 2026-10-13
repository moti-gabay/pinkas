import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toCsv } from './export-csv.js';
import { toScraperResult } from './export-scraper.js';
import { toXlsx } from './export-xlsx.js';
import { CHECKING_ID, MAX_ID, generateHousehold } from './generate.js';

const outDir = fileURLToPath(new URL('../out/', import.meta.url));
mkdirSync(outDir, { recursive: true });

const household = generateHousehold({});
const write = (name: string, data: string | Uint8Array): void => {
  writeFileSync(join(outDir, name), data);
  console.log(`wrote ${name}`);
};
const json = (value: unknown): string => JSON.stringify(value, null, 2);

write('household.json', json(household));
write('expectations.json', json(household.expectations));
for (const account of household.accounts) {
  write(`scraper-${account.id}.json`, json(toScraperResult(household, account.id)));
}
write(
  'bank.csv',
  toCsv(household, CHECKING_ID, { layout: 'bank', encoding: 'utf8', withTotalRow: true }),
);
write(
  'bank-cp1255.csv',
  toCsv(household, CHECKING_ID, { layout: 'bank', encoding: 'windows-1255', withTotalRow: true }),
);
write(
  'card-max.csv',
  toCsv(household, MAX_ID, { layout: 'card', encoding: 'utf8', withTotalRow: true }),
);
write('bank.xlsx', await toXlsx(household, CHECKING_ID, { layout: 'bank' }));
write('card-max.xlsx', await toXlsx(household, MAX_ID, { layout: 'card' }));

console.log(
  `seed ${household.seed}: ${household.transactions.length} transactions over ${household.expectations.length} months → ${outDir}`,
);
