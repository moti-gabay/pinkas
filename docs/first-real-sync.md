# Pre-flight: first real sync (beinleumi only)

Prepared 2026-10-19, not yet run. One bank, one source, one attempt at a time. Banks lock accounts after a few failed logins, so the rule throughout is: **a failed login is never retried blindly.**

## 0. Before touching credentials

- [ ] `~/.pinkas/backup.key` is in your password manager (see `docs/backup-restore.md`).
- [ ] You can log in to beinleumi in a normal browser with the same username and password right now. If the bank wants a password change or shows a notice, deal with it there first.
- [ ] Nothing else is listening on the stack's ports: `ss -ltn | grep -E ':(3010|5173|3100)\s'` prints nothing. The api is on 127.0.0.1:3010 (`PINKAS_API_PORT` in `.env`), away from the usual dev-server port 3000; web 5173, MCP 3100.
- [ ] `main` is green in CI and `git status` is clean.

## 1. Keys and `.env`

```bash
pnpm pinkas keygen        # creates ~/.pinkas/worker.key (600) and prints CREDENTIALS_PUBLIC_KEY=...
```

Edit `.env` (it is git-ignored):

- `CREDENTIALS_PUBLIC_KEY=` the value just printed (replaces the stale one; its private key no longer exists).
- `SCRAPER_MOCK=0` (currently `1`).
- Leave `SESSION_SECRET` and `MCP_TOKEN` as they are (rotated on 2026-10-19). Optionally set `BACKUP_COPY_DIR`.

Check without printing values:

```bash
grep -cE '^SCRAPER_MOCK=0$' .env                         # 1
grep -E '^CREDENTIALS_PUBLIC_KEY=' .env | cut -d= -f2 | wc -c   # 45 (44 chars + newline)
ls -l ~/.pinkas                                           # worker.key 600, backup.key 600, backup.pub 644
```

`worker.key` needs no backup: if it is lost, run `keygen` again and re-enter credentials.

## 2. Build and start

```bash
docker compose build
docker compose up -d --wait --wait-timeout 240
docker compose ps                       # db, api, web, sync-worker, mcp-server healthy; migrate Exited (0)
docker compose logs migrate | tail -3   # "... taxonomy seed v0 → v1: +62 categories, +66 rules"
docker compose logs sync-worker | grep -c SCRAPER_MOCK   # must be 0: no mock warning
```

This is the real `pinkas` compose project with a new `pinkas_pgdata` volume; none of the mock test data is in it.

## 3. Add the source and sync once

1. Open http://127.0.0.1:5173, set the app password.
2. Accounts → add a scraper source → **הבנק הבינלאומי** (username, password). Add only this one.
3. In a second terminal, follow the worker before triggering anything:

   ```bash
   docker compose logs -f sync-worker
   ```

4. Press **sync now** once. A scrape can take up to `SCRAPE_TIMEOUT_MS` (120 s). Do not press it again while the run is queued or running; the API returns the same run anyway.

### What to watch in the worker log

| Line                                                                                      | Meaning                                                                                               |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `sync finished` with `status: success`, `rowsAdded`, `durationMs`                         | Good. `accountsSeen` is the number of accounts the bank returned.                                     |
| `login-class failure: source disabled` + `errorType`                                      | Login rejected. The source is now disabled and will not be tried again. Go to §5.                     |
| `scrape threw` + `errName`                                                                | Chromium or page failure (no login result). Source stays enabled; next attempt is the 06:30 schedule. |
| `sync finished` with `status: failed`, `errorType: TIMEOUT` / `GENERIC` / `GENERAL_ERROR` | Not a login failure. Same as above.                                                                   |
| `tick failed`                                                                             | Worker loop error (usually the database). The container turns unhealthy after 90 s.                   |

Also check that no credential ever appears: `docker compose logs sync-worker | grep -ciE '<your username>'` must be 0 (type the username into the command yourself; do not paste it into notes).

## 4. Verify the result

- [ ] Sync history: one run, `success`, rows added > 0.
- [ ] Accounts: the account(s) appear with a masked label (`****1234`), never the full number.
- [ ] **Balance** on the Accounts page equals the balance on the beinleumi site (to the agora).
- [ ] Transactions: the latest few rows match the bank site (date, amount sign: outflow negative).
- [ ] Card settlement debits from beinleumi show as uncategorized spending for now: the card sources that let relink match them are not added yet. That is expected.
- [ ] **Sync again** (once): `success` with **`rowsAdded: 0`**. `rowsUpdated` may be non-zero when pending rows have posted.
- [ ] `pnpm pinkas backup` succeeds; with `BACKUP_COPY_DIR` set, the `.age` file appears in the cloud folder.

The source now syncs automatically every day at 06:30 (Asia/Jerusalem), at most once per day.

## 5. If the login fails

The source is already disabled; nothing will retry it. **Do not toggle it back on** (the API refuses anyway). Read `errorType` in Sync history:

| errorType                      | Do this                                                                                                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_PASSWORD`             | Log in to the bank site by hand. If that works, re-enter the credentials in Pinkas (re-enter credentials re-enables the source), then sync **once**. If the browser login also fails, fix it with the bank first. |
| `CHANGE_PASSWORD`              | Change the password on the bank site, then re-enter it in Pinkas and sync once.                                                                                                                                   |
| `ACCOUNT_BLOCKED`              | Stop. Contact the bank. Do not re-enter credentials until it is unblocked.                                                                                                                                        |
| `TWO_FACTOR_RETRIEVER_MISSING` | The bank asked for a one-time code, which Pinkas cannot enter. Use file import for this account.                                                                                                                  |

Budget: **at most one Pinkas login attempt per investigation and no more than two failed logins on the same day**, counting attempts in the browser.

For non-login failures (`TIMEOUT`, `GENERIC`, `GENERAL_ERROR`, `scrape threw`): keep `docker compose logs sync-worker` and wait for the next scheduled run, or sync once more later. If it repeats, it is a scraper/site problem to debug, not a credentials one.

## 6. Not yet

- **No other sources until beinleumi has synced cleanly at least twice** (one manual, one scheduled).
- max and visaCal next, one at a time, each with this checklist.
- **isracard needs a contract test first** (no synthetic scraper result or mock exists for it yet), before it is added as a source.
- Pepper (Leumi) is app-only; the `probe` script is for checking, expect file import.
- Outbound traffic is not restricted yet (egress proxy is Phase 2 step 7, after real sync works).

## Rollback

`docker compose down` keeps the data. `docker compose down -v` **deletes the real database**: take a backup first. Credentials can be removed by deleting the source in the UI.
