# Architecture

```
 127.0.0.1:5173 → web (nginx, static React) → /api → api (Fastify)
                                                      │ pinkas_api role
 sync-worker (Chromium + israeli-bank-scrapers) ──────┤ pinkas_worker role
 mcp-server (127.0.0.1:3100, bearer token) ───────────┤ pinkas_readonly role
 backup (pg_dump | age, nightly) ─────────────────────┤ pinkas_backup role
                                                      ▼
                                           postgres (backend network only)
```

## Services

| Service     | Owns                                                                                                                 | Must never                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| api         | HTTP for web, file import pipeline, categorization/insights jobs, credential _encryption_ (public key only), reports | hold the private key; import `israeli-bank-scrapers`; call banks               |
| sync-worker | scheduled + manual scrapes, decrypts credentials in memory, normalizes + upserts, writes `sync_runs`                 | expose HTTP; log credentials or raw payloads; retry failed logins; call Claude |
| mcp-server  | MCP tools over aggregates via the read-only role                                                                     | touch credentials/scrapers; write anything (role enforces)                     |
| web         | Hebrew RTL UI                                                                                                        | call anything but api                                                          |

## Packages and layering

`shared ← domain ← {db, file-parsers} ← apps`. `domain` is pure TypeScript with no I/O: money, dates, dedupe hashing, pending matching, card-settlement linking, transfers, installments, refunds, rule categorization, budgets, recurring detection, forecast, anomalies. Everything with a number in it is tested there.

## Data flow

1. Source → raw rows (scraper result or parsed file).
2. Worker/import converts to `NormalizedTxn` (civil date in Asia/Jerusalem, integer agorot).
3. `dedupe-hash` assigns a stable hash (identifier-first per `sources.hash_kind`).
4. Upsert: exact hash → no-op; pending match → in-place update; else insert.
5. `relink` job: card settlements, transfers, refunds.
6. Rules categorize; the rest queue for Claude.
7. Reports are SQL over `counted_in_cashflow` rows; the LLM only narrates numbers computed in code.

ADRs in `docs/adr/`.
