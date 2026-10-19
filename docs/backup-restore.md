# Backup and restore

The manual commands below exist now. The scheduled backup service (nightly, 30 daily + 12 monthly retained) and the restore drill in CI land with Phase 4.

## Keys

`pnpm pinkas backup-keygen` creates, in `~/.pinkas` (mode 700):

| File         | Mode | Role                                                                                         |
| ------------ | ---- | -------------------------------------------------------------------------------------------- |
| `backup.pub` | 644  | age recipient: encrypts backups. Also mounted as the `backup_recipient` compose secret.      |
| `backup.key` | 600  | age identity: the only way to decrypt a backup. It never leaves `~/.pinkas` except as below. |

**Put a copy of `backup.key` in your password manager now.** Without it every backup, including the off-machine copies, is unreadable once the laptop is gone. It refuses to overwrite an existing key.

`worker.key` (credentials sealing) does not need a backup: if it is lost, run `pnpm pinkas keygen`, update `CREDENTIALS_PUBLIC_KEY` and re-enter the bank credentials.

## Backup

```bash
pnpm pinkas backup
```

1. `pg_dump --format=custom` runs inside the `db` container (same major version as the server) as `pinkas_backup`, the read-only role with `SELECT` on every table.
2. The dump is streamed straight into `age --encrypt` to `data/backups/pinkas-<UTC timestamp>.dump.age` (mode 600). Plaintext never touches the disk.
3. Verification: the file is decrypted into `pg_restore --list`, which must parse its table of contents. Size, entry count and the live database's row counts per table are printed.
4. If `BACKUP_COPY_DIR` is set (in `.env`), the **encrypted** file is copied there and its size checked. Point it at a synced folder, e.g. `/mnt/c/Users/<you>/OneDrive/pinkas-backups`. The folder must already exist; a typo fails loudly rather than creating a new folder. The key is never copied.

The backup includes everything needed to restore the app: sealed credentials (still encrypted with `worker.key`), the login password hash and sessions.

## Restore (scratch databases only)

```bash
pnpm pinkas restore data/backups/pinkas-<timestamp>.dump.age [--into <name>]
```

Decrypts with `backup.key` into a **new** database (default `pinkas_restore_<timestamp>`) and prints its row counts. It refuses the live database (`pinkas`, or `PINKAS_DB`), `postgres`, `template0`, `template1`, any database that already exists and any name that is not a plain lower-case identifier, so it cannot overwrite data. Drop the scratch database when done: `docker compose exec db dropdb -U postgres <name>`.

Promoting a restored database to live is deliberately not automated: stop the stack, rename databases by hand, start it again.

Both commands use `docker compose exec -T db`, so they act on the running compose project (set `COMPOSE_PROJECT_NAME` to target another one).

## Verified (2026-10-19, mock data)

Backup of 21 tables / 480 rows: 105 KiB in 2 s; `pg_restore --list` read 181 entries. Restore into a scratch database reproduced all 21 tables with identical row counts, the same transaction amount total and the same 332 dedupe hashes. Each refusal above was exercised and left the database list unchanged.
