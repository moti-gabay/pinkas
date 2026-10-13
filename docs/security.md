# Security and data protection

## Read-only against banks

The only call into `israeli-bank-scrapers` is `createScraper(options).scrape(credentials)` in `apps/sync-worker/src/scrapers/`. ESLint forbids the import elsewhere. There is no code for transfers or payments.

## Credentials

- `pnpm pinkas keygen` creates an X25519 keypair. Private key: `~/.pinkas/worker.key` (0600), mounted read-only into the sync-worker container only. Public key: `CREDENTIALS_PUBLIC_KEY` in `.env`.
- The API seals credentials with `crypto_box_seal` (libsodium). It cannot decrypt them. The `pinkas_api` role is additionally denied `SELECT` on `credentials.ciphertext`.
- The worker opens the box inside the scrape function, zeroes the buffer afterwards, and never attaches the object to a logger, error or job payload.

## Database roles

`pinkas_migrator` (schema owner), `pinkas_api`, `pinkas_worker` (transactions/accounts/sync_runs only), `pinkas_readonly` (reporting views, `default_transaction_read_only`), `pinkas_backup`. Grants are in `packages/db/src/grants.sql` and re-applied after each migration.

## Network

Postgres has no host port. API, web and MCP bind to 127.0.0.1. The worker gets its own egress network; the allow-listing proxy is added as the last step of Phase 2 (`EGRESS_MODE`).

## Logs

pino redaction for credential fields and cookies; any field whose name looks like an account/description has 6+ digit runs masked to the last 4. Raw scrape payloads are never logged.

## LLM boundary

All payloads are built in `apps/api/src/llm/payloads.ts` from an allow-list of fields; a test asserts forbidden fields never appear. PDFs are sent as redacted text by default; sending the raw PDF requires a per-import opt-in. Model output is structured and validated; merchant text is treated as untrusted data.

## Threat model

| Asset        | Threat                              | Mitigation                                                                             |
| ------------ | ----------------------------------- | -------------------------------------------------------------------------------------- |
| Credentials  | malicious dependency in api/web/mcp | those processes cannot decrypt; column grant denies ciphertext                         |
| Credentials  | compromised scraper/puppeteer       | exact pins, manual review (Renovate label), egress allowlist, worker limited DB grants |
| Data         | stolen laptop                       | host disk encryption, password-protected dashboard, keys in `~/.pinkas`                |
| Data         | leaked backup                       | `age` encryption, key kept apart from dumps                                            |
| Data         | LAN devices                         | localhost-only binds, no DB port                                                       |
| LLM          | prompt injection via merchant text  | data-only wrapping, structured outputs, enum categories, text-only rendering           |
| Privacy      | over-sharing with the LLM           | allow-list builder + forbidden-fields test; PDFs redacted by default                   |
| Bank account | lockout from repeated logins        | first login-class failure disables the source; no retries                              |
| Repo         | real data committed                 | gitignored data dirs, synthetic fixtures, pre-commit secret/identifier scan            |
