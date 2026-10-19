/**
 * `pnpm pinkas <command>` — local operator commands.
 *   keygen        create ~/.pinkas/worker.key (X25519 private) and print the public key for .env
 *   init-secrets  generate docker/secrets/* role passwords (idempotent: never overwrites)
 *   backup-keygen create ~/.pinkas/backup.key (age identity) and backup.pub (recipient; also a compose secret)
 *   backup        encrypted pg_dump to data/backups/, verified; copied to BACKUP_COPY_DIR when set
 *   restore FILE [--into DB]  restore into a new scratch database (never the live one) and print row counts
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import sodium from 'libsodium-wrappers';
import { backup, backupKeygen, loadDotEnv, restore } from './backup.js';

const keyDir = process.env['PINKAS_KEY_DIR'] ?? join(homedir(), '.pinkas');

async function keygen(): Promise<void> {
  await sodium.ready;
  mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  const keyFile = join(keyDir, 'worker.key');
  if (existsSync(keyFile)) {
    console.error(
      `${keyFile} already exists; refusing to overwrite. Use rotate-key (phase 2) to replace it.`,
    );
    process.exit(1);
  }
  const kp = sodium.crypto_box_keypair();
  writeFileSync(keyFile, sodium.to_base64(kp.privateKey, sodium.base64_variants.ORIGINAL), {
    mode: 0o600,
  });
  chmodSync(keyFile, 0o600);
  writeFileSync(
    join(keyDir, 'worker.pub'),
    sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL),
    { mode: 0o644 },
  );
  console.log(`Private key written to ${keyFile} (mode 600). Add to .env:`);
  console.log(
    `CREDENTIALS_PUBLIC_KEY=${sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL)}`,
  );
}

function initSecrets(): void {
  const dir = join(process.cwd(), 'docker', 'secrets');
  mkdirSync(dir, { recursive: true });
  for (const role of ['superuser', 'migrator', 'api', 'worker', 'readonly', 'backup']) {
    const file = join(dir, `pg_${role}_password`);
    if (existsSync(file)) {
      console.log(`exists: ${file}`);
      continue;
    }
    // 0644: the postgres init script reads these as the container's postgres user. The directory is gitignored.
    writeFileSync(file, randomBytes(24).toString('base64url'), { mode: 0o644 });
    console.log(`created: ${file}`);
  }
}

const cmd = process.argv[2];
switch (cmd) {
  case 'keygen':
    await keygen();
    break;
  case 'init-secrets':
    initSecrets();
    break;
  case 'backup-keygen':
    backupKeygen(keyDir);
    break;
  case 'backup':
    loadDotEnv();
    await backup(keyDir);
    break;
  case 'restore': {
    const intoAt = process.argv.indexOf('--into');
    await restore(keyDir, process.argv[3], intoAt > 0 ? process.argv[intoAt + 1] : undefined);
    break;
  }
  default:
    console.error(
      'usage: pnpm pinkas <keygen|init-secrets|backup-keygen|backup|restore FILE [--into DB]>',
    );
    process.exit(1);
}
