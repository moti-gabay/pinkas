// Pre-commit guard: refuse to commit obvious secrets or real-looking financial identifiers.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const staged = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && /\.(ts|tsx|js|mjs|json|md|yml|yaml|env|sql|csv)$/.test(f))
  .filter((f) => !f.startsWith('packages/fixtures/') && !f.includes('.test.'));

const patterns = [
  { re: /sk-ant-[A-Za-z0-9_-]{20,}/, why: 'Anthropic API key' },
  { re: /AKIA[0-9A-Z]{16}/, why: 'AWS access key' },
  { re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, why: 'private key' },
  { re: /\b\d{2,3}-\d{6,9}\b/, why: 'bank account-like number (branch-account)' },
  { re: /\b(4\d{3}|5[1-5]\d{2})[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/, why: 'card number' },
];

let failed = false;
for (const file of staged) {
  const text = readFileSync(file, 'utf8');
  for (const { re, why } of patterns) {
    const m = re.exec(text);
    if (m) {
      console.error(`check-no-secrets: ${file}: possible ${why}: "${m[0].slice(0, 8)}…"`);
      failed = true;
    }
  }
}
if (failed) {
  console.error('Refusing to commit. If this is synthetic data, move it under packages/fixtures/.');
  process.exit(1);
}
