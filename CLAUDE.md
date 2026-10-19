# Pinkas — project conventions

- Monorepo: pnpm + turbo. Apps: `api` (Fastify), `web` (Vite/React, Hebrew RTL), `sync-worker`, `mcp-server`. Packages: `shared`, `domain`, `db`, `file-parsers`, `fixtures`, `config`.
- Layering: `shared ← domain ← {db, file-parsers} ← apps`. `domain` is pure (no I/O, no DB, no Node APIs). Never import `israeli-bank-scrapers` outside `apps/sync-worker/src/scrapers`. ESLint enforces both.
- Money: integer agorot (`bigint` in DB, `number` in TS via `packages/domain/src/money.ts`). Never floats for amounts. Sign: negative = outflow, positive = inflow, on every account type.
- Dates: `txn_date` is a civil date in Asia/Jerusalem. Use `packages/domain/src/dates.ts` (Temporal); never `new Date()` arithmetic for months.
- Dedupe: `packages/domain/src/dedupe-hash.ts` is frozen (identifier-first, minimal `descriptionKey`, `HASH_VERSION`). It must never depend on `normalize-merchant`. Hash kind is decided by `sources.hash_kind` (sticky, downgrade-only, recompute in the same transaction), never per batch. Changing the algorithm needs a version bump, a recompute migration and a golden-file update.
- Security: credentials are sealed-box encrypted; only `sync-worker` holds the private key. Never log, return, or send to the LLM: credentials, account numbers, raw scrape payloads. LLM payloads only through `apps/api/src/llm/payloads.ts` allow-list; PDFs go to the LLM as redacted text unless the import explicitly opted in.
- Sync: never retry a failed login. Login-class errors disable the source.
- Income is irregular (freelance): forecast uses `expected_income` per month plus the tax-reserve setting, never recurring-income inference.
- UI text Hebrew (RTL); code, comments, logs English. Use `@pinkas/shared` `format*` helpers for ILS and DD/MM/YYYY.
- Tests: Vitest unit (domain ≥90% coverage), Testcontainers/`TEST_DATABASE_URL` integration, Playwright e2e. Fixtures are synthetic (`packages/fixtures`); no real data in the repo. Run `pnpm lint && pnpm typecheck && pnpm test` before claiming done.
- DB: Drizzle schema in `packages/db/src/schema`; `pnpm db:generate`, then write the matching `.down.sql`; `pnpm db:migrate`. Grants live in `packages/db/grants.sql` and are re-applied after every migration.
- Commands: `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `docker compose up`, `pnpm seed`, `pnpm pinkas keygen`.
- Conventional commits. Surgical changes; no speculative abstractions.
