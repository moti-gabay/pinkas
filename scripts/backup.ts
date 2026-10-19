/**
 * Minimal encrypted backup and verified restore (the scheduled service and the CI restore drill are Phase 4).
 *
 * backup:  pg_dump (custom format, inside the db container, as pinkas_backup) → age → data/backups/*.dump.age.
 *          Plaintext never touches the disk. The file is then verified by decrypting into `pg_restore --list`,
 *          and optionally copied (encrypted file only) to BACKUP_COPY_DIR.
 * restore: decrypts into a NEW scratch database and prints its row counts. It refuses the live database, the
 *          system databases and any database that already exists, so it can never overwrite data.
 *
 * Keys live in ~/.pinkas (PINKAS_KEY_DIR): backup.pub encrypts, backup.key (age identity) decrypts. Back up
 * backup.key to a password manager: without it every backup is unreadable.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { finished } from 'node:stream/promises';

const LIVE_DB = process.env['PINKAS_DB'] ?? 'pinkas';
const PROTECTED_DBS = new Set([LIVE_DB.toLowerCase(), 'postgres', 'template0', 'template1']);
const BACKUP_DIR = join(process.cwd(), 'data', 'backups');

/** `docker compose exec -T db …` (the project follows COMPOSE_PROJECT_NAME like any compose command). */
const inDb = (...args: string[]) => ['compose', 'exec', '-T', 'db', ...args];

function run(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0)
    throw new Error(`${cmd} ${args[0] ?? ''} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

/** Pipes producer → consumer (and optionally producer stdin ← a file) and fails if either side fails. */
async function pipeline(
  producer: [string, string[]],
  consumer: [string, string[]],
  opts: { producerInput?: string; consumerOutput?: string } = {},
): Promise<string> {
  const p = spawn(producer[0], producer[1], { stdio: ['pipe', 'pipe', 'pipe'] });
  const c = spawn(consumer[0], consumer[1], { stdio: ['pipe', 'pipe', 'pipe'] });
  if (opts.producerInput) createReadStream(opts.producerInput).pipe(p.stdin);
  else p.stdin.end();
  p.stdout.pipe(c.stdin);
  let out = '';
  // When writing to a file, wait for the file to be flushed, not just for the process to exit.
  const written = opts.consumerOutput
    ? finished(c.stdout.pipe(createWriteStream(opts.consumerOutput, { mode: 0o600 })))
    : Promise.resolve();
  if (!opts.consumerOutput)
    c.stdout.on('data', (d: Buffer) => {
      out += d.toString();
    });
  const errs = { p: '', c: '' };
  p.stderr.on('data', (d: Buffer) => {
    errs.p += d.toString();
  });
  c.stderr.on('data', (d: Buffer) => {
    errs.c += d.toString();
  });
  const exit = (child: typeof p) =>
    new Promise<number>((resolve) => {
      child.on('close', (code) => {
        resolve(code ?? 1);
      });
    });
  const [pc, cc] = await Promise.all([exit(p), exit(c), written]);
  if (pc !== 0) throw new Error(`${producer[0]} ${producer[1][0] ?? ''} failed: ${errs.p.trim()}`);
  if (cc !== 0) throw new Error(`${consumer[0]} ${consumer[1][0] ?? ''} failed: ${errs.c.trim()}`);
  return out;
}

function keyFiles(keyDir: string) {
  return { identity: join(keyDir, 'backup.key'), recipient: join(keyDir, 'backup.pub') };
}

/** Exact row count of every table in `db`, as `role`. */
function rowCounts(db: string, role: string): [string, number][] {
  const sql = `SELECT table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
    FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`;
  return run('docker', inDb('psql', '-U', role, '-d', db, '-At', '-F', '\t', '-c', sql))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [t, n] = l.split('\t');
      return [t ?? '', Number(n)];
    });
}

function printCounts(title: string, counts: [string, number][]): void {
  const total = counts.reduce((s, [, n]) => s + n, 0);
  console.log(`${title}: ${counts.length} tables, ${total} rows`);
  for (const [t, n] of counts) if (n > 0) console.log(`  ${t.padEnd(22)} ${n}`);
}

export function backupKeygen(keyDir: string): void {
  const { identity, recipient } = keyFiles(keyDir);
  if (existsSync(identity))
    throw new Error(`${identity} already exists; refusing to overwrite it.`);
  mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  run('age-keygen', ['-o', identity]);
  spawnSync('chmod', ['600', identity]);
  const pub = run('age-keygen', ['-y', identity]).trim();
  writeFileSync(recipient, `${pub}\n`, { mode: 0o644 });
  console.log(`age identity: ${identity} (mode 600). Store a copy in your password manager now.`);
  console.log(`recipient:    ${recipient} (${pub})`);
}

export async function backup(keyDir: string): Promise<void> {
  const { identity, recipient } = keyFiles(keyDir);
  if (!existsSync(recipient))
    throw new Error(`${recipient} missing: run \`pnpm pinkas backup-keygen\` first.`);
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const file = join(BACKUP_DIR, `pinkas-${stamp}.dump.age`);

  await pipeline(
    ['docker', inDb('pg_dump', '-U', 'pinkas_backup', '-d', LIVE_DB, '--format=custom')],
    ['age', ['--encrypt', '--recipients-file', recipient]],
    { consumerOutput: file },
  );
  const size = statSync(file).size;
  if (size === 0) throw new Error('backup file is empty');
  console.log(`backup: ${file} (${(size / 1024).toFixed(1)} KiB, encrypted)`);

  // Verify: the archive must decrypt and its table of contents must parse.
  if (existsSync(identity)) {
    const toc = await pipeline(
      ['age', ['--decrypt', '--identity', identity]],
      ['docker', inDb('pg_restore', '--list')],
      { producerInput: file },
    );
    const entries = toc.split('\n').filter((l) => /^\d+;/.test(l));
    const tables = entries.filter((l) => l.includes(' TABLE DATA public ')).length;
    console.log(
      `verified: decrypts, pg_restore --list reads ${entries.length} entries (${tables} with table data)`,
    );
  } else {
    console.log(`not verified: ${identity} is not on this machine`);
  }
  printCounts(`live ${LIVE_DB} at backup time`, rowCounts(LIVE_DB, 'pinkas_backup'));

  const copyDir = process.env['BACKUP_COPY_DIR'];
  if (copyDir) {
    if (!existsSync(copyDir))
      throw new Error(`BACKUP_COPY_DIR ${copyDir} does not exist (not creating it)`);
    const dest = join(copyDir, basename(file)); // only the encrypted .age file, never a key
    copyFileSync(file, dest);
    if (statSync(dest).size !== size) throw new Error(`copy to ${dest} is incomplete`);
    console.log(`copied: ${dest}`);
  }
}

export async function restore(
  keyDir: string,
  file: string | undefined,
  into: string | undefined,
): Promise<void> {
  const { identity } = keyFiles(keyDir);
  if (!file || !existsSync(file))
    throw new Error('usage: pnpm pinkas restore <file.dump.age> [--into <scratch_db>]');
  if (!existsSync(identity))
    throw new Error(`${identity} missing: restore needs the backup identity.`);
  const target =
    into ?? `pinkas_restore_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(target)) throw new Error(`invalid database name: ${target}`);
  if (PROTECTED_DBS.has(target.toLowerCase()))
    throw new Error(
      `refusing to restore into ${target}: restore only ever targets a new scratch database`,
    );
  const exists = run(
    'docker',
    inDb(
      'psql',
      '-U',
      'postgres',
      '-At',
      '-c',
      `SELECT 1 FROM pg_database WHERE datname = '${target}'`,
    ),
  );
  if (exists.trim()) throw new Error(`refusing to restore into ${target}: it already exists`);

  run('docker', inDb('createdb', '-U', 'postgres', target));
  await pipeline(
    ['age', ['--decrypt', '--identity', identity]],
    [
      'docker',
      inDb(
        'pg_restore',
        '-U',
        'postgres',
        '-d',
        target,
        '--no-owner',
        '--no-privileges',
        '--exit-on-error',
      ),
    ],
    { producerInput: file },
  );
  printCounts(`restored into scratch database ${target}`, rowCounts(target, 'postgres'));
  console.log(`drop it when done: docker compose exec db dropdb -U postgres ${target}`);
}

/** Loads .env (if present) so BACKUP_COPY_DIR can live there; variables already set are not overridden. */
export function loadDotEnv(): void {
  const f = join(process.cwd(), '.env');
  if (existsSync(f)) process.loadEnvFile(f);
}
