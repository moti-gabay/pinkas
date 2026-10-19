# Pinkas (פנקס) — Implementation Plan

> **Status:** the implementation plan agreed on 2026-10-13, kept here as the source of truth.
> Decisions that changed since are recorded as ADRs in `docs/adr/` and marked inline
> (sync scheduling: [ADR 0009](adr/0009-croner-instead-of-pg-boss.md)).

## Context

Personal, self-hosted cash-flow manager in the spirit of RiseUp, single user, runs on WSL via docker compose. Pulls transactions read-only from Israeli banks/cards via `israeli-bank-scrapers`, imports CSV/XLSX/PDF for anything unscrapeable, normalizes everything into one ledger (dedupe, card-vs-bank linking, transfers, installments, refunds), categorizes (rules → Claude → learned rules), and shows a Hebrew RTL dashboard with budgets, forecast and AI-written monthly insights. A read-only MCP server exposes aggregates to Claude Code / Claude Desktop.

Money correctness and credential/data security are the two non-negotiables; the LLM never produces a number.

### Decisions already taken (from Q&A)

| Topic         | Decision                                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Credit cards  | `max`, `visaCal`, `isracard` (Amex out; note WAF issue #1057 anyway)                                                                           |
| Installments  | Count per charged installment (library default `combineInstallments: false`)                                                                   |
| Master key    | Key file outside repo, mounted read-only into sync-worker only                                                                                 |
| MCP clients   | Claude Code (WSL) and Claude Desktop (Windows) → single Streamable-HTTP transport on 127.0.0.1                                                 |
| Sample files  | You will drop redacted exports in `data/samples/` (gitignored) before Phase 1 parsers                                                          |
| History       | 12 months initial backfill                                                                                                                     |
| Network       | Dashboard bound to 127.0.0.1 only                                                                                                              |
| Claude models | `claude-haiku-5-5` categorization, `claude-sonnet-5-5` insights + PDF extraction (env-configurable). Plain Messages API only; no Batches API   |
| Income        | Irregular freelance income: forecast uses a manual per-month expected income, plus a VAT/income-tax reserve % held back from incoming payments |
| Dedupe hash   | Must not depend on `merchant_normalized`; identifier-first, frozen minimal normalization, `hash_version` column                                |
| PDF → LLM     | Default: extracted text through the redaction masker. Raw PDF only with explicit per-import opt-in                                             |

### Verified facts about `israeli-bank-scrapers` v6.12.2 (load-bearing)

- `Transaction`: `type ('normal'|'installments')`, `identifier?: string|number`, `date`/`processedDate` ISO strings, `originalAmount`, `originalCurrency`, `chargedAmount`, `chargedCurrency?`, `description`, `memo?`, `status ('completed'|'pending')`, `installments?: {number,total}`, `category?`, `rawTransaction?`.
- `TransactionsAccount`: `accountNumber`, `balance?`, `balanceDate?`, `cardFrame?`, `cardType?`, `currency?`, `txns`.
- Result: `{ success, accounts?, futureDebits?, errorType?, errorMessage? }`. `ScraperErrorTypes`: `INVALID_PASSWORD`, `CHANGE_PASSWORD`, `TIMEOUT`, `ACCOUNT_BLOCKED`, `GENERIC`, `GENERAL_ERROR`, `TWO_FACTOR_RETRIEVER_MISSING`.
- Login fields: beinleumi/leumi/max/visaCal → `{username,password}`; isracard → `{id, card6Digits, password}`.
- `combineInstallments:false` shifts installment N's `date` forward N-1 months so each charge lands on its billing month. Exactly what we want.
- Long-term OTP exists only for `oneZero`. None of our institutions need it. Handle `TWO_FACTOR_RETRIEVER_MISSING` generically as "unsupported".
- Start-date clamps: isracard 1y, visaCal 18m, max 4y, leumi 3y, beinleumi none. 12 months fits all.
- `futureMonthsToScrape` default 1 for cards → next cycle's pending charges arrive.
- Depends on full `puppeteer ^24.40` (caret). We pin via lockfile + `pnpm.overrides`. Library adds **no** launch args → we pass `--no-sandbox --disable-dev-shm-usage` ourselves; `PUPPETEER_SKIP_DOWNLOAD=1` + system Chromium via `executablePath`.
- **Pepper**: app-only, no web login, no upstream support (issue #1089). Plan keeps an isolated `leumi` probe script; expect file import.

---

## 1. Architecture

```
                    ┌──────────────────────────── host (WSL) ────────────────────────────┐
                    │  ~/.pinkas/worker.key (X25519 private, 0600)   ./backups (age-enc) │
                    │  ./data/samples (gitignored)   ./data/uploads (volume, auto-purged) │
                    └─────────────────────────────────────────────────────────────────────┘
 127.0.0.1:5173 ─┐
                 ▼
┌──────────┐  ┌──────────────┐    ┌──────────────┐   ┌───────────────┐   ┌──────────────┐
│  web     │  │  api         │    │ sync-worker  │   │ mcp-server    │   │ backup       │
│ React/   │─▶│ Fastify      │    │ scrapers +   │   │ Streamable    │   │ pg_dump|age  │
│ Vite RTL │  │ zod, pg-boss │    │ puppeteer    │   │ HTTP :3100    │   │ nightly cron │
└──────────┘  │ LLM module   │    │ decrypts     │   │ READ-ONLY role│   └──────┬───────┘
              │ file parsers │    │ creds in RAM │   │ bearer token  │          │
              └──────┬───────┘    └──────┬───────┘   └──────┬────────┘          │
   role: pinkas_api  │   role: pinkas_worker│   role: pinkas_readonly│            │
                     ▼                    ▼                   ▼                  ▼
              ┌──────────────────────────────────────────────────────────────────────┐
              │  postgres 17  (docker network only, no host port)                     │
              └──────────────────────────────────────────────────────────────────────┘
                                         ▲
   networks:  frontend (web↔api)   backend (api,worker,mcp,backup ↔ db)
              worker-egress (internal:true, worker ↔ egress-proxy only)
              egress-proxy (allowlisted bank domains) ──▶ internet
   Claude API: api ──▶ api.anthropic.com (allow-listed payload builder)
```

Service boundaries:

| Service       | Owns                                                                                                                                            | Must never                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `api`         | HTTP for web, file import pipeline, categorization/insights jobs (pg-boss), credential _encryption_ (public key only), budgets/forecast queries | hold the private key; import `israeli-bank-scrapers`; call banks               |
| `sync-worker` | Scheduled + on-demand scrapes, decrypt creds in memory, normalize + upsert, write `sync_runs`                                                   | expose HTTP; log credentials or raw payloads; retry failed logins; call Claude |
| `mcp-server`  | MCP tools over aggregates via `pinkas_readonly` role                                                                                            | touch credentials/scrapers; write anything (role enforces)                     |
| `web`         | Hebrew RTL UI                                                                                                                                   | call anything but `api`                                                        |
| `backup`      | nightly encrypted dump, retention                                                                                                               | —                                                                              |

Read-only by design: the only scraper call is `createScraper(opts).scrape(credentials)`. There is no code path that imports anything else from the library. Documented in `docs/architecture.md` and enforced by an ESLint `no-restricted-imports` rule outside `apps/sync-worker/src/scrapers/`.

---

## 2. Stack decisions

| Area          | Choice                                                                                                                         | Why                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo      | pnpm workspaces + Turborepo (task graph/caching)                                                                               | TS end to end, shared packages                                                                                                                                                                      |
| Backend       | **Fastify 5**                                                                                                                  | Schema-first, zod type provider, built-in hooks for rate-limit/helmet/cookies, faster than Express, better TS                                                                                       |
| DB layer      | **Drizzle ORM + drizzle-kit**                                                                                                  | SQL-shaped: GROUP BY/window/CTE aggregations read naturally; no engine binary (small worker/MCP images); explicit SQL migrations we can review. Down migrations hand-written per migration (see §4) |
| Jobs/schedule | **pg-boss**                                                                                                                    | Postgres-backed queue + cron, no Redis. API enqueues `sync.run`, worker consumes; API consumes `categorize.batch`, `insights.month`, `uploads.purge`                                                | _(Sync scheduling uses croner + a `sync_runs` queue instead: [ADR 0009](adr/0009-croner-instead-of-pg-boss.md).)_ |
| Frontend      | React 19 + Vite, TanStack Query + Router, Tailwind v4 + shadcn/ui (RTL via `dir="rtl"` + logical utilities), font Heebo        | Mature, RTL-capable                                                                                                                                                                                 |
| Charts        | **Recharts 3**                                                                                                                 | Composable React API, SVG, fine with RTL when chart wrapper is `dir="ltr"` and labels formatted via our `format` module                                                                             |
| Validation    | zod 4 in `@pinkas/shared`, shared by all apps                                                                                  | Single source of truth                                                                                                                                                                              |
| Money         | integer agorot in `bigint` columns (Drizzle `mode:'number'`), `Money` module (`packages/domain/money`)                         | Exact; JS safe-integer range ≫ any personal balance                                                                                                                                                 |
| Dates         | `date` columns for txn dates, `timestamptz` for events; `Temporal` polyfill (`temporal-polyfill`) for Asia/Jerusalem math      | Civil dates are what banks give us                                                                                                                                                                  |
| Crypto        | `libsodium-wrappers` sealed boxes (X25519 + XSalsa20-Poly1305)                                                                 | API encrypts with public key only; worker decrypts                                                                                                                                                  |
| Logging       | pino + `redact` + custom masking serializer                                                                                    | Structured, redaction at the sink                                                                                                                                                                   |
| LLM           | `@anthropic-ai/sdk` with `output_config.format` structured outputs, synchronous Messages API only                              | Typed outputs; single-user volume does not justify Batches API async handling                                                                                                                       |
| Files         | `csv-parse` + `chardet`/`iconv-lite` (windows-1255), `exceljs`, `pdfjs-dist` text extraction, `file-type` for content sniffing | SheetJS npm is stale; exceljs is maintained                                                                                                                                                         |
| Tests         | Vitest, `@testcontainers/postgresql`, Playwright, fast-check                                                                   | Per §8                                                                                                                                                                                              |
| Lint/format   | ESLint 9 flat config + typescript-eslint strict-type-checked, Prettier, husky + lint-staged                                    | Per §9                                                                                                                                                                                              |

---

## 3. Repository structure

```
pinkas/
├─ apps/
│  ├─ api/            # @pinkas/api (Fastify)
│  │  └─ src/{server.ts, config.ts, plugins/, routes/, services/, jobs/, llm/, import/}
│  ├─ web/            # @pinkas/web (Vite React)
│  │  └─ src/{app/, features/{dashboard,transactions,budgets,import,sources,sync-history,settings}, components/, lib/}
│  ├─ sync-worker/    # @pinkas/sync-worker
│  │  └─ src/{main.ts, config.ts, scrapers/{index.ts, run-scrape.ts, probe-leumi.ts}, credentials/, pipeline/, jobs/}
│  ├─ mcp-server/     # @pinkas/mcp-server
│  │  └─ src/{main.ts, tools/, queries/}
│  └─ backup/         # Dockerfile + scripts (pg_dump | age), restore-drill.sh
├─ packages/
│  ├─ shared/         # @pinkas/shared: zod schemas, DTO types, enums, formatters (ILS, dates), error codes + Hebrew messages
│  ├─ domain/         # @pinkas/domain: PURE. money, normalize, dedupe, pending-match, card-link, transfers, installments, refunds, categorize-rules, budgets, forecast, recurring, anomalies. No I/O, no imports from db/http/llm.
│  ├─ db/             # @pinkas/db: drizzle schema, migrations (up + down), role-scoped client factories, repositories, seed
│  ├─ file-parsers/   # @pinkas/file-parsers: SourceAdapter impls for csv/xlsx/pdf + per-bank presets
│  ├─ fixtures/       # @pinkas/fixtures: synthetic Israeli data generator, recorded scraper outputs (synthetic)
│  └─ config/         # @pinkas/config: tsconfig.base.json, eslint preset, prettier
├─ docker/            # compose files, Dockerfiles, egress-proxy allowlist, postgres init SQL (roles)
├─ docs/              # architecture.md, adr/NNNN-*.md, security.md, backup-restore.md, adding-a-source.md
├─ scripts/           # keygen.ts, seed.ts, restore-drill.sh, migrate.ts
├─ data/              # gitignored: samples/, uploads/, backups/
├─ .github/workflows/ci.yml
├─ docker-compose.yml, docker-compose.test.yml
├─ CLAUDE.md, README.md, .env.example, .gitignore, pnpm-workspace.yaml, turbo.json
```

Dependency direction (enforced by ESLint `import/no-restricted-paths`): `shared ← domain ← {db, file-parsers} ← apps`. `domain` imports only `shared`. `israeli-bank-scrapers` is a dependency of `apps/sync-worker` only.

---

## 4. Database schema (Postgres 17)

Conventions: `id uuid pk default gen_random_uuid()`, `created_at/updated_at timestamptz`, amounts `bigint` agorot (sign: negative = outflow, positive = inflow, on every account type), enums as Postgres enums. Migrations: `drizzle-kit generate` → `packages/db/migrations/NNNN_name.sql`, paired hand-written `NNNN_name.down.sql`; `scripts/migrate.ts up|down` applies; CI runs up → down → up from scratch.

### Roles (created by `docker/postgres/init/01-roles.sql`, passwords from secrets)

| Role              | Grants                                                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pinkas_migrator` | owner of schema; used only by migrate script                                                                                                                                                    |
| `pinkas_api`      | SELECT/INSERT/UPDATE/DELETE on all app tables; **no SELECT on `credentials.ciphertext`** (column-level grant), INSERT/UPDATE allowed                                                            |
| `pinkas_worker`   | SELECT on `sources`,`credentials`,`accounts`,`transactions`,`transaction_links`; INSERT/UPDATE on `accounts`,`transactions`,`transaction_links`,`sync_runs`,`balance_snapshots`; pg-boss schema |
| `pinkas_readonly` | SELECT on reporting tables only; **no access** to `credentials`, `imports`, `settings`; `default_transaction_read_only=on`                                                                      |

### Tables

**sources** — a connection (scraper or file-based).
`id, kind enum('scraper','file'), company_id text null (CompanyTypes), display_name text, enabled bool, schedule_cron text null, hash_kind enum('identifier','fields') NOT NULL default 'identifier', hash_kind_downgraded_at timestamptz null, last_success_at timestamptz null, last_error_type text null, last_error_at timestamptz null, created_at`
`hash_kind` is sticky: once downgraded to `fields` it is never set back to `identifier` (enforced by a trigger `sources_hash_kind_no_upgrade`).

**credentials** — one per scraper source.
`source_id fk unique, ciphertext bytea (sealed box of JSON {username,password,...}), key_fingerprint text, updated_at`
No plaintext column ever. No API endpoint returns this row.

**accounts** — bank account or card as seen by a source.
`id, source_id fk, external_id text (full number, pinkas_api can read; UI shows masked), masked_label text ('****1234'), type enum('checking','credit_card','savings'), currency char(3) default 'ILS', display_name text, is_active bool, balance_agorot bigint null, balance_at timestamptz null, card_cycle_day smallint null, created_at`
UNIQUE `(source_id, external_id)`.

**balance_snapshots** — `account_id, as_of timestamptz, balance_agorot` (for trends/forecast).

**transactions** — the unified ledger.

```
id uuid pk
account_id fk accounts
dedupe_hash text NOT NULL            -- see §5.1
hash_version smallint NOT NULL default 1
hash_kind enum('identifier','fields') NOT NULL
previous_hashes text[] default '{}'  -- hashes this row has had (pending→completed)
origin enum('scraper','import','manual')
import_id fk imports null
external_identifier text null
txn_date date NOT NULL               -- civil date, Asia/Jerusalem
processed_date date null
charged_amount_agorot bigint NOT NULL
original_amount_minor bigint null
original_currency char(3) null
status enum('pending','completed') NOT NULL
description_raw text NOT NULL
merchant_normalized text NOT NULL    -- domain/normalize-merchant
memo text null
installment_number smallint null, installment_total smallint null
installment_group_key text null      -- hash(account, merchant, original_amount, first charge month)
category_id fk categories null
category_source enum('rule','ai','manual','refund_link','default') null
category_confidence numeric(3,2) null
category_rule_id fk category_rules null
is_fixed bool null                   -- fixed vs variable; null = inherit from category
exclude_reason enum('card_settlement','internal_transfer','duplicate','user') null
counted_in_cashflow bool GENERATED ALWAYS AS (exclude_reason IS NULL) STORED
notes text null
tags text[] default '{}'
raw jsonb null                       -- scraper/parsed row minus identifiers; purged after 90d
created_at, updated_at
```

Indexes: UNIQUE `(hash_version, dedupe_hash)`; `(account_id, external_identifier) WHERE external_identifier IS NOT NULL`; `(account_id, txn_date)`; `(txn_date) WHERE counted_in_cashflow`; `(category_id, txn_date)`; `(merchant_normalized)`; GIN `(tags)`; `(status) WHERE status='pending'`; `(installment_group_key)`.
Constraints: `CHECK ((installment_number IS NULL) = (installment_total IS NULL))`, `CHECK (installment_number <= installment_total)`.

**transaction_links** — all pairings.
`id, kind enum('card_settlement','transfer','refund','pending_update'), from_txn_id fk, to_txn_id fk, confidence numeric(3,2), created_by enum('system','user'), created_at`
UNIQUE `(kind, from_txn_id, to_txn_id)`. Transfer: from=outflow, to=inflow. Refund: from=refund txn, to=original purchase. Card settlement: from=bank debit, to=`card_settlements.id` via next table instead.

**card_settlements** — one bank debit ↔ one card billing cycle.
`id, bank_txn_id fk transactions unique, card_account_id fk accounts, cycle_date date, expected_total_agorot bigint (sum of card txns with processed_date in cycle), status enum('matched','partial','unmatched'), diff_agorot bigint, created_at`

**categories** — Hebrew taxonomy.
`id, parent_id fk null, slug text unique, name_he text, kind enum('expense','income','transfer'), is_fixed_default bool, icon text, sort smallint, is_system bool`

**category_rules** — user-editable.
`id, pattern text, match enum('contains','exact','regex','prefix'), field enum('merchant_normalized','description_raw'), category_id fk, is_fixed bool null, priority int, account_scope fk accounts null, enabled bool, origin enum('seed','user','learned'), hit_count int, created_at`
Index on `(enabled, priority)`.

**budgets** — `id, category_id fk, amount_agorot bigint, effective_from date (first of month), created_at`. UNIQUE `(category_id, effective_from)`. Effective budget for month M = latest row with `effective_from <= M`.

**expected_income** — manual per-month income plan for irregular freelance income.
`month date pk (first of month), amount_agorot bigint, note text null, updated_at`. Used by forecast (§5.9) instead of recurring-income detection.

**settings** additions: `tax_reserve_pct numeric(5,2) default 0` (VAT/income-tax reserve held back from incoming payments), `tax_reserve_applies_to enum('all_income','category_ids')` + `tax_reserve_category_ids uuid[]` (default: income categories flagged `is_business`).

**recurring_series** — detected subscriptions/standing orders.
`id, account_id, merchant_normalized, category_id, cadence enum('weekly','monthly','bimonthly','quarterly','yearly'), typical_amount_agorot, amount_tolerance_pct, day_of_month smallint null, first_seen date, last_seen date, next_expected date, occurrences int, status enum('active','paused','ended','ignored'), is_new bool, user_confirmed bool`
UNIQUE `(account_id, merchant_normalized, cadence)`.

**sync_runs** — `id, source_id fk, trigger enum('schedule','manual'), started_at, finished_at, status enum('running','success','failed','partial'), error_type text null (ScraperErrorTypes), error_message text null (redacted), accounts_seen int, rows_added int, rows_updated int, rows_linked int, duration_ms int`
Index `(source_id, started_at desc)`.

**imports** — `id, file_name text, file_sha256 text, size_bytes int, mime text, parser_id text, account_id fk null, status enum('uploaded','parsed','awaiting_confirm','committed','failed','cancelled'), llm_mode enum('none','redacted_text','raw_pdf') default 'none', column_mapping jsonb, rows_parsed int, rows_added int, rows_skipped int, statement_total_agorot bigint null, computed_total_agorot bigint null, reconciled bool null, error text null, file_deleted_at timestamptz null, created_at, committed_at`
UNIQUE `(file_sha256)` partial `WHERE status='committed'` → same file twice = no-op with message.

**import_rows** — staging. `import_id fk, row_index int, raw jsonb, parsed jsonb null, dedupe_hash text null, decision enum('insert','duplicate','update_pending','error'), error text null`. PK `(import_id,row_index)`. Deleted on commit/cancel.

**insights** — `id, month date, kind enum('monthly_summary','anomaly','budget','recurring'), facts jsonb (the numbers given to the model), content_he text, model text, input_tokens int, output_tokens int, created_at`

**llm_calls** — audit: `id, purpose, model, input_tokens, output_tokens, latency_ms, ok bool, error text, created_at` (no payloads).

**settings** — single-row key/value jsonb (`auth_password_hash`, `safe_to_spend_mode`, `data_retention_days`, …).

**sessions** — `id, token_hash, created_at, expires_at, last_seen_at`.

Reporting views (what MCP reads): `v_cashflow_transactions` (counted rows only, no `raw`, no `external_identifier`, masked account label), `v_monthly_cashflow`, `v_category_month`.

---

## 5. Domain logic (packages/domain) — the critical part

All pure functions, fully unit-tested, no I/O.

### 5.1 Dedupe hash (stable across normalization changes)

Two hash kinds, chosen per row, both versioned (`HASH_VERSION = 1` constant in `domain/dedupe-hash`):

```
// identifier-first: when the source provides a usable identifier
usable(id) = id != null && trim(id) not in {'', '0', '-'} && not all-same-char
hash_kind='identifier':  dedupe_hash = sha256('v1|id|' + account_id + '|' + trim(String(external_identifier)))

// fallback: field-based
hash_kind='fields':      key = [account_id, txn_date, charged_amount_agorot, descriptionKey(description_raw), ordinal]
                         dedupe_hash = sha256('v1|f|' + join(key, '|'))
```

- `descriptionKey()` is a **frozen** minimal normalization living in `dedupe-hash.ts` itself: NFKC, trim, collapse internal whitespace to one space, strip RTL/LTR/zero-width marks. Nothing else (no lowercasing, no digit stripping, no merchant dictionary). It must never import or share code with `normalize-merchant`; ESLint `no-restricted-imports` enforces that in this file, and a golden-file test (`dedupe-hash.golden.json`: 200 raw descriptions → hashes) must pass unchanged on every commit. A second test mutates `normalizeMerchant` (stub returning `'X'`) and asserts hashes for the fixture batch are identical.
- `ordinal` = index among rows in the _same incoming batch_ sharing the first four fields (0,1,2…). Two genuine identical purchases on one day get 0 and 1; re-importing the same batch reproduces the same ordinals → idempotent.
- Which kind a row gets is decided by **`sources.hash_kind`, not per batch**. A source starts as `identifier`; rows without a usable identifier still get a fields hash (that is per row, not a downgrade).
- Identifier safety (sticky downgrade): if an incoming batch contains two rows with the same `external_identifier` but different `(date, amount)`, or an incoming row's identifier matches an existing row of that source with different `(date, amount)` beyond the pending tolerance, the source's identifiers are proven non-unique. In **one DB transaction** the pipeline: (1) sets `sources.hash_kind='fields'`, `hash_kind_downgraded_at=now()`; (2) recomputes `dedupe_hash`/`hash_kind` for every existing `identifier`-hashed row of that source from stored `description_raw`, `txn_date`, `charged_amount_agorot` (ordinals recomputed per `(account, date, amount, descriptionKey)` group ordered by `created_at`), pushing the old hash to `previous_hashes`; (3) hashes the incoming batch with fields; (4) upserts. A warning is logged once with the company id and the UI shows a badge on the source. The downgrade is permanent (trigger blocks upgrades), so a later collision-free batch cannot flip back and duplicate rows. Pending rows typically lack identifiers and get an identifier when completed; §5.2 handles that transition and records the old hash in `previous_hashes`.
- Changing the algorithm later means bumping `HASH_VERSION`, adding a migration that recomputes `dedupe_hash` for all rows from stored `description_raw`/`external_identifier` (possible because raw inputs are stored), and keeping the unique index on `(hash_version, dedupe_hash)`.

### 5.2 Pending → completed

A completed incoming row with no exact hash match is tested against existing `pending` rows in the same account: same `merchant_normalized`, `txn_date` within ±4 days, amount within ±2% or ±5 ILS (FX settlements drift). Best match → `UPDATE` in place: status, amount, dates, push old hash to `previous_hashes`, write a `pending_update` link row. Pending rows older than 45 days with no match are flagged `stale_pending` (shown in UI, excluded from totals).

### 5.3 Card settlement linking

For each credit-card account, group card txns by `processed_date` (= bank charge date from the card scraper) → cycle totals. For each bank txn on a checking account whose `merchant_normalized` matches the issuer pattern set (`מקס`, `max it`, `כאל`, `cal`, `ישראכרט`, `isracard`, …) and date within ±3 days of a cycle date: if `|amount| == cycle_total` → `matched`, set `exclude_reason='card_settlement'` on the bank txn. If no exact match: pick closest, status `partial`, still exclude but surface diff in the Reconciliation panel. Never exclude card-level txns. Runs after every sync/import (idempotent re-link).

### 5.4 Own-account transfers

Candidate pairs: txn A (outflow) in account X, txn B (inflow) in account Y≠X, same owner, `|amount|` equal, dates within ±3 days, and either description matches transfer vocabulary (`העברה`, `הע' `, `הפקדה`, `משיכה`, `bit`, `paybox` with own name) or the other account's last 4 digits appear in the description. Score; above threshold → link kind `transfer`, both `exclude_reason='internal_transfer'`. User can confirm/unlink; user decisions stored with `created_by='user'` and never overridden by re-runs.

### 5.5 Installments

Keep library default (one row per charged installment, dated on its billing month). Store `installment_number/total` and `installment_group_key` for the "purchase view" (sum of group) and to detect the _last_ installment for forecast. Credit deals (קרדיט) arrive as installments too; if a scraper reports them `type:'normal'` with a memo, a normalizer rule maps `memo ~ 'קרדיט'` to installment metadata when `installments` is absent. ADR-0003 documents this.

### 5.6 Refunds

On card accounts any positive amount is a refund candidate; on checking accounts positive amounts are income unless a rule/transfer says otherwise. Refund matching: same account, same `merchant_normalized`, `amount <= original`, within 120 days, original not already fully refunded → link kind `refund`, `category_source='refund_link'`, category copied from original. Unmatched refunds get category by rules/AI with `kind='expense'` (negative expense), never income. Partial refunds reduce the category total in the refund's month (no retroactive edits; documented).

### 5.7 Foreign currency

Store `original_amount_minor`+`original_currency` (minor units per ISO 4217 exponent table in `money`), totals always use `charged_amount_agorot`. A later FX adjustment row (small amount, same merchant, memo contains `הפרשי שער`/`conversion`) is categorized to the original purchase's category via refund-style matching with `kind='fx_adjustment'` tag.

### 5.8 Categorization

`applyRules(txn, rules)` → first enabled rule by priority (user > learned > seed). Unmatched → `uncategorized` system category, queued for AI. Learned rule proposal on manual edit: `{pattern: merchant_normalized, match:'exact'}`; UI offers it once per merchant.

### 5.9 Budgets, forecast, recurring, anomalies

- `monthSummary(txns, month)` → income, expenses, net, fixed, variable, by category tree (only `counted_in_cashflow`).
- `effectiveBudgets(budgets, month)`, `budgetStatus` → spent, remaining, pct, over flag.
- `detectRecurring(txns)`: group by `(account, merchant_normalized)`, amount tolerance 10%, interval histogram → cadence; needs ≥3 occurrences (≥2 for yearly). `is_new` if first_seen within 45 days.
- `forecast(month, today, summary, recurring, budgets, expectedIncome, taxReserve)` — income is irregular (freelance), so no recurring-income detection feeds the forecast:
  - `received_income` = counted inflows this month (excluding transfers/refunds)
  - `expected_income` = `expected_income.amount` for the month if set, else `max(received_income, 0)` with a UI hint "לא הוגדרה הכנסה צפויה"
  - `tax_reserve` = `received_income_in_scope × tax_reserve_pct` (scope per settings; shown as its own line and never spendable)
  - `committed_fixed` = recurring _expenses_ expected this month (paid or not) + budgets flagged fixed without a recurring series
  - `variable_spent`, `daily_pace` = variable_spent / elapsed_days (exclude today's partial)
  - `projected_variable` = variable_spent + pace × remaining_days
  - `safe_to_spend` (the one number) = expected_income − tax_reserve_on_expected − committed_fixed − variable_spent, where `tax_reserve_on_expected = expected_income × pct` when expected income is set (so the reserve is planned, not only realized)
  - `projected_net` = expected_income − tax_reserve_on_expected − committed_fixed − projected_variable
  - Recurring detection still runs on income merchants for the Recurring page, but only expenses enter the forecast.
- `anomalies(month, history)`: category > 1.5× 6-month avg and > 200 ILS; new recurring; budget > 100%; merchant first seen with amount > p95. These are the _facts_ given to the LLM.

All month math via `Temporal.PlainDate` in `Asia/Jerusalem`; scraper ISO timestamps converted with `Temporal.Instant.toZonedDateTimeISO('Asia/Jerusalem').toPlainDate()` in the worker before touching domain code.

---

## 6. Security & data protection design

### 6.1 Credentials

- `pnpm pinkas keygen` → `~/.pinkas/worker.key` (X25519 secret, 0600) and prints the public key; `.env` has `CREDENTIALS_PUBLIC_KEY`. Key dir is outside repo; `.gitignore` also ignores `*.key`.
- UI "add source" posts fields → `api` validates with zod (per-company field list derived from `SCRAPERS[company].loginFields`, copied as a constant into `shared`, not imported from the lib) → `sodium.crypto_box_seal(JSON, pubKey)` → `credentials.ciphertext`. API process never has decryption capability.
- Worker: key file mounted `ro` at `/run/secrets/worker.key`; `crypto_box_seal_open` inside `runScrape()` scope only; plaintext object is zeroed (`sodium.memzero` on Buffer) in `finally`. Never assigned to logger context, never in error objects (errors carry `errorType` only).
- Rotation: `pnpm pinkas rotate-key` re-wraps via the worker (worker has both keys for one run).
- Log redaction: pino `redact: ['*.password','*.username','*.id','*.card6Digits','req.headers.authorization','req.headers.cookie']` plus a serializer masking any 6+ digit run in `accountNumber`-like fields to last 4.

### 6.2 Network isolation

- `worker-egress` network is `internal: true`; worker's only route is `egress-proxy` (tinyproxy with `Filter` allowlist: `*.fibi.co.il`, `*.leumi.co.il`, `*.max.co.il`, `*.cal-online.co.il`, `*.isracard.co.il`, plus their CDNs). Puppeteer launched with `--proxy-server=egress-proxy:8888`. Allowlist discovery: `EGRESS_MODE=log` first run logs denied hosts; then lock to `enforce`. Documented risk: bank CDN changes break sync (visible as `TIMEOUT` + proxy denial log).
- Worker container: non-root user, `read_only: true` fs with tmpfs `/tmp`, `cap_drop: ALL`, `no-new-privileges`, Chromium with `--no-sandbox` **only because** the container itself is the sandbox (ADR-0005).
- Postgres: no `ports:`; data volume on an encrypted host disk (WSL: enable BitLocker on the Windows volume; documented). Passwords via docker secrets files.
- `api` listens on `127.0.0.1:3000`, `web` dev server on `127.0.0.1:5173`, MCP on `127.0.0.1:3100`.

### 6.3 API hardening

- Single-user password login: Argon2id hash in `settings`; session cookie `__Host-pinkas`, `HttpOnly; Secure`-equivalent (`Secure` requires TLS; on localhost we set `SameSite=Strict`, host-only), 12h idle expiry.
- CSRF: `SameSite=Strict` + Origin/Referer check on mutating routes + required `X-Pinkas-Request: 1` header (no form posts).
- `@fastify/helmet`, `@fastify/rate-limit` (login: 5/15min; global 300/min), `@fastify/multipart` 15 MB limit, content sniff with `file-type` + CSV heuristic, upload stored under random name, processed by parsers in a `worker_threads` pool with timeout; never executed.
- Every route has zod schemas; errors → `{code, message_he}`; stack traces only in logs.
- "Delete all data" → confirm phrase, truncates all tables, deletes uploads, rotates sessions; retention job purges `transactions.raw` > 90 days and uploads > 24h.

### 6.4 LLM boundary (`apps/api/src/llm/`)

- `buildCategorizationPayload`, `buildInsightsPayload`, `buildPdfExtractionPayload` take domain objects and emit payloads via an **allow-list projection** (`pick(['merchantNormalized','amountAgorot','date','categoryHint'])`). A shared `FORBIDDEN_LLM_FIELDS` list (`externalId`, `accountNumber`, `username`, `password`, `id`, `card6Digits`, `notes`, `raw`, `description_raw`? → description is allowed but passed through the redaction masker for digit runs ≥ 6).
- Test: fast-check generates transactions with every forbidden field populated; asserts serialized payload contains none of them.
- Prompt injection: descriptions are wrapped as data (`<transactions>` JSON) with a system prompt that says the content is untrusted merchant text; outputs are structured (`output_config.format` JSON schema) and validated with zod; category ids must be from the provided enum; insights output is rendered as plain text (no markdown/HTML execution).
- Haiku 5.5 for categorization (synchronous calls, chunks of 50, sequential with backoff; no Batches API), Sonnet 5.5 for insights and PDF fallback; `max_tokens` sized per task; typed error chain (`RateLimitError` → `APIStatusError` → `APIConnectionError`); any failure leaves rows `uncategorized`, never blocks.
- **PDF extraction goes through the same allow-list boundary.** Default `llm_mode='redacted_text'`: `pdfjs-dist` text → redaction masker (digit runs ≥ 6 → `****1234`, Israeli ID pattern, IBAN, phone numbers, email, lines matching name/address header heuristics) → Sonnet 5.5 with a structured-output row schema. `llm_mode='raw_pdf'` (PDF as `document` block) is available only via an explicit per-import checkbox in the Import wizard with a Hebrew warning that the full statement, including name, address and account numbers, is sent to Anthropic; the choice is recorded on `imports.llm_mode` and in `llm_calls`. The forbidden-fields test covers the redacted-text path by asserting that no masked token from a synthetic statement fixture (account numbers, ID, name) survives into the payload.

### 6.5 Backups

- `backup` service: daily `pg_dump -Fc` (role `pinkas_readonly` is insufficient for dump → dedicated `pinkas_backup` SELECT-all role) piped to `age -r <recipient>` → `data/backups/pinkas-YYYYMMDD.dump.age`; keep 30 daily + 12 monthly. Age identity at `~/.pinkas/backup.key` (0600).
- `scripts/restore-drill.sh`: starts throwaway Postgres on compose test profile, decrypts latest dump, restores, runs `scripts/invariants.sql` (row counts, sum per month, no duplicate hashes), prints diff vs live. Run manually monthly; CI runs it against a seeded fixture DB to keep the script alive.

### 6.6 Threat model

| Asset            | Threat                                                | Mitigation                                                                                                                                                                                    |
| ---------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bank credentials | Malicious/compromised dependency in `api`/`web`/`mcp` | Those processes cannot decrypt (sealed box, no private key mounted); column grant denies ciphertext read to api anyway                                                                        |
| Bank credentials | Compromised `israeli-bank-scrapers`/puppeteer         | Pinned exact versions + lockfile, updates reviewed manually (Renovate ignores them); worker egress allowlist blocks exfiltration to arbitrary hosts; worker has no DB write beyond its tables |
| Financial data   | Stolen laptop                                         | Host disk encryption (BitLocker), key files in `~/.pinkas` (also encrypted at rest with disk), dashboard requires password                                                                    |
| Financial data   | Leaked backup file                                    | `age` encryption; key never alongside dumps                                                                                                                                                   |
| Financial data   | Other LAN devices                                     | Everything bound to 127.0.0.1; DB has no host port                                                                                                                                            |
| LLM              | Prompt injection via merchant text                    | Data-only wrapping, structured outputs, enum-constrained categories, text-only rendering, no tools given to the model                                                                         |
| Privacy          | Over-sharing with Anthropic                           | Allow-list payload builder + forbidden-fields test; account numbers never sent                                                                                                                |
| Bank account     | Lockout from repeated failed logins                   | Worker stops on first `INVALID_PASSWORD`/`CHANGE_PASSWORD`/`ACCOUNT_BLOCKED`, disables source (`enabled=false`) until user re-enters credentials; scheduler never retries a failed login      |
| Bank account     | Any write action                                      | Only `scrape()` is called; ESLint restricted-import rule; README documents; user to check for view-only bank user                                                                             |
| Repo             | Real data committed                                   | `.gitignore` for `data/`, `.env*`, `*.key`; fixtures synthetic; pre-commit `gitleaks`-style regex check for Israeli bank account patterns + `ANTHROPIC_API_KEY`                               |

---

## 7. Phases

Each phase: code + tests + docs + CI green = done.

### Phase 0 — Skeleton (½ day)

1. pnpm workspace, Turborepo, `@pinkas/config` (tsconfig strict, ESLint flat + typescript-eslint strict-type-checked, Prettier, import boundaries), husky + lint-staged, conventional commits (`commitlint`).
2. `docker-compose.yml`: postgres 17 (secrets, roles init SQL), api, web, worker (stub), mcp (stub), backup (stub). `docker-compose.test.yml` profile.
3. `@pinkas/shared` env schema (`zod`) per app, fail-fast `loadConfig()`.
4. CI: `pnpm install --frozen-lockfile`, lint, typecheck, unit, build.
5. `CLAUDE.md`, `README.md` (WSL setup), `docs/architecture.md`, ADR-0001 stack, ADR-0002 money as agorot.
   **Accept**: `docker compose up` boots db+api+web; `/healthz` 200; CI green.

### Phase 1 — MVP: import, dedupe, rules, basic dashboard (1–1.5 weeks)

1. `@pinkas/db`: schema (all tables of §4, so later phases only add columns), migrations up/down, seed categories + seed rules (Hebrew taxonomy), role-scoped clients.
2. `@pinkas/domain`: `money`, `normalize-merchant`, `dedupe-hash`, `pending-match`, `categorize-rules`, `month-summary`, `dates` (Asia/Jerusalem). Property tests with fast-check.
3. `@pinkas/file-parsers`: `SourceAdapter` interface (`detect(file) → confidence`, `parse(file, mapping) → ParsedRow[]`, `defaultMapping`), encoding detection (UTF-8 BOM / windows-1255), CSV + XLSX engines, presets written against your `data/samples/` (one preset per source), generic mapper fallback. Header heuristics: Hebrew header dictionary (`תאריך`, `סכום`, `חובה`, `זכות`, `תיאור`, `פרטים`, `אסמכתא`), date format sniffing, merged header/summary row skipping.
4. API: auth (login/logout/session), accounts CRUD (manual accounts for file sources), import pipeline (`POST /imports` upload → parse in worker thread → `import_rows` → `GET /imports/:id/preview` → `POST /imports/:id/confirm {mapping, accountId}` → dedupe/pending-match/rules → insert → delete file), transactions list/search/filter/edit (category, notes, tags, exclude), categories/rules CRUD, `GET /reports/month/:yyyy-mm`.
5. Web: RTL shell, login, Import wizard (upload → preview table with column mapping dropdowns, duplicate/new badges, totals → confirm), Transactions table (TanStack Table, filters, inline category edit with "save as rule?" toast), Monthly overview (income/expenses/net cards, category donut, category table drill-down), Accounts page, Settings (change password, delete all data).
6. `@pinkas/fixtures`: generator (salaries, rent, arnona, Shufersal/Rami Levy/Wolt/Paz/Cellcom/Netflix…, card cycles, installments, refunds, transfers) + CSV/XLSX fixture files; `pnpm seed`.
7. Integration tests (Testcontainers): migrations from scratch, import flow idempotency, month report numbers vs fixture ground truth. E2E (Playwright): import → preview → confirm → dashboard totals; edit category → rule created.
   **Accept**: importing the fixture CSV twice yields zero new rows; month report equals generator's expected totals to the agora; all §8.3 edge-case tests for parsers/dedupe pass; coverage ≥90% on `domain`.

### Phase 2 — Sync worker, linking, scheduling (1–1.5 weeks)

1. `scripts/keygen.ts`, sealed-box encryption in api, `credentials` table + "Add source" UI (fields per company), no read endpoint.
2. `apps/sync-worker`: Dockerfile (node:24-slim + apt chromium + fonts, non-root, `PUPPETEER_SKIP_DOWNLOAD`), `runScrape(source)` with `createScraper({companyId, startDate: max(lastSuccess−14d, 12 months ago), combineInstallments:false, executablePath, args:[...], timeout, storeFailureScreenShotPath: null})`, result mapping → domain normalize → upsert via `dedupe-hash` + `pending-match`, `sync_runs` row, structured logs with `errorType`. On login-class errors: disable source, no retry. Timeout/Generic: mark failed, next scheduled run proceeds (max 1/day automatic).
3. Scheduling: pg-boss cron per source (default 06:30 Asia/Jerusalem), `POST /sources/:id/sync` enqueues manual job; worker concurrency 1 (one Chromium at a time). Sync-history screen + per-source status on Accounts page. _(Sync scheduling uses croner + a `sync_runs` queue instead: [ADR 0009](adr/0009-croner-instead-of-pg-boss.md).)_
4. `domain/card-link`, `domain/transfers` + a `relink` job after each sync/import; Reconciliation panel in UI (unmatched card settlements, suspected transfers to confirm/unlink).
5. `probe-leumi.ts`: standalone script (`pnpm --filter sync-worker probe --company leumi`) that runs one scrape with `showBrowser` optional and prints only `success/errorType/accounts count` — used to test Pepper. Documented expectation: likely fails → file import.
6. Contract tests: recorded **synthetic** scraper results for beinleumi/max/visaCal/isracard (every `ScraperErrorTypes` value + success + partial + pending→completed sequences) run through the worker pipeline against Testcontainers DB. Invariant tests (§8.4).
7. **Last, after real sync is verified working**: egress proxy sidecar with allowlist, `EGRESS_MODE=off|log|enforce` (default `off` until the allowlist is learned), discovery run per source, docs. Acceptance for this step is separate: sync of every source still succeeds with `enforce`.
   **Accept**: real sync of beinleumi + 3 cards works end-to-end (steps 1–6) before step 7 begins; re-running sync adds 0 rows; card settlement debits excluded and matched; a wrong password disables the source with a Hebrew error and no second attempt (verified by contract test and by log inspection).

### Phase 3 — AI: categorization, PDF import, MCP server (1 week)

1. `apps/api/src/llm/`: client, allow-list builders, forbidden-fields test, `categorize.batch` job (Haiku 5.5, structured output `{id, categorySlug, confidence}`), confidence < 0.6 → stays uncategorized with suggestion shown; UI accept → `manual` + rule proposal.
2. PDF adapter: `pdfjs-dist` text → heuristic table parser (per-source preset) → if parse confidence low or totals mismatch → Sonnet 5.5 extraction from **redacted text** (default) producing structured rows + declared statement total; the raw-PDF `document` path only when the user ticked the per-import opt-in. Reconcile `Σ rows == statement_total` else import marked `reconciled=false` and blocked from confirm until user acknowledges.
3. `apps/mcp-server`: `@modelcontextprotocol/sdk` Streamable HTTP on 127.0.0.1:3100 with bearer token (`MCP_TOKEN`), tools `get_monthly_cashflow(months)`, `get_spending_by_category(from,to)`, `compare_periods(a,b)`, `get_recurring_charges()`, `get_budget_status(month)`, `search_transactions(query, filters)` (masked labels only), `get_accounts_overview()`. Role `pinkas_readonly`. Config snippets for Claude Code (`claude mcp add --transport http`) and Claude Desktop (`mcp-remote` bridge; WSL2 localhost forwarding).
4. Tests: MCP tool outputs vs fixture DB; attempted INSERT through the readonly client fails; LLM mocked (msw) for malformed/timeout/429 paths.
5. **Host reachability (found in the Phase 2 smoke test, 2026-10-19):** `mcp-server` is only on the `backend` network, which is `internal: true`, so Docker does not publish `127.0.0.1:3100` and the host (Claude Code / Desktop) cannot connect; it is healthy only inside the container. Attach it to a non-internal network as well (keep the 127.0.0.1 binding and the bearer token). A TODO marks the line in `docker-compose.yml`.
   **Accept**: backlog categorization runs without blocking; forbidden-field test green; PDF fixture with deliberate mismatch is flagged; Claude Code can call all tools; `curl 127.0.0.1:3100/healthz` succeeds from the host.

### Phase 4 — Planning: budgets, recurring, forecast, insights, trends (1 week)

1. `domain/budgets`, `domain/recurring`, `domain/forecast`, `domain/anomalies` with golden tests.
2. API: budgets CRUD, `PUT /expected-income/:month`, tax-reserve settings, `GET /reports/forecast/:month` (returns expected income, reserve, committed fixed, variable spent, pace, safe-to-spend, projected net), `GET /reports/trends?months=12`, recurring list + confirm/ignore, `POST /insights/:month/generate` (job, Sonnet 5.5, facts stored), `GET /insights`.
3. Web: Budgets page (progress bars, over-budget badges), "Safe to spend" hero number + projection on dashboard with an inline "הכנסה צפויה החודש" editor and a "מע״מ/מס שמור" line, Settings → tax reserve % and scope, Recurring page (new ones flagged), 12-month trends (stacked bars income/expense/net, category lines), Insights card with regenerate.
4. Backup service + restore drill + `docs/backup-restore.md`; retention jobs.
   **Accept**: forecast numbers match hand-computed fixture scenario; budgets alert at >100%; insights generated and stored with facts; restore drill passes in CI on fixture DB.

---

## 8. Testing strategy

### 8.1 Layers

| Layer       | Tool                              | Scope                                                                                                                                                  |
| ----------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit        | Vitest + fast-check               | `domain`, `shared/format`, `file-parsers` (fixture files), llm payload builders, redaction                                                             |
| Integration | Vitest + Testcontainers Postgres  | migrations up/down/up, repositories, import pipeline, relink job, reports SQL vs domain reference implementation (same fixture, two paths, must agree) |
| Contract    | Vitest                            | worker pipeline on recorded synthetic scraper outputs; parser presets on `data/samples`-derived synthetic files                                        |
| E2E         | Playwright (compose test profile) | import flow; category edit → rule; add source (fake scraper mode `SCRAPER_MOCK=1` returns fixtures); sync-now; budgets                                 |
| MCP         | Vitest                            | each tool vs fixture DB; write attempt rejected by role                                                                                                |
| Security    | Vitest                            | forbidden LLM fields; log redaction; api cannot read `credentials.ciphertext`; ESLint restricted-import for scrapers                                   |

### 8.2 Invariants (tests + `GET /healthz/invariants` runtime check)

1. `Σ counted transactions in month == income − expenses` reported.
2. No `dedupe_hash` duplicates (DB unique) and no two rows sharing an `external_identifier` within an account.
3. Every `card_settlements.status='matched'` bank txn is excluded; no card-level txn is excluded for `card_settlement`.
4. Transfer links are symmetric and both sides excluded.
5. Re-running last import/sync → `rows_added = 0`.
6. Import with `statement_total` → `computed_total == statement_total` or `reconciled=false`.
7. No `pending` row older than 45 days without `stale_pending` flag.

### 8.3 Edge cases → tests

| Case                                                                                        | Test                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pending posted with different amount/date                                                   | `pending-match.test`: ±2%, ±4d matches; beyond → new row + stale flag                                                                                                                                                                                |
| Partial/full refund, refund next month                                                      | `refunds.test`: category offset in refund month; income total unchanged                                                                                                                                                                              |
| Installments across year boundary; קרדיט                                                    | `installments.test`: 12×, Dec→Jan; group key stable; memo-based detection                                                                                                                                                                            |
| FX purchase + later adjustment                                                              | `fx.test`: original kept, charged used, adjustment linked                                                                                                                                                                                            |
| Same merchant/amount/day ×2                                                                 | `dedupe.test`: ordinals → 2 rows; re-import → 0 new                                                                                                                                                                                                  |
| Normalization logic evolves                                                                 | `dedupe-hash.stability.test`: golden hashes unchanged; stubbing `normalizeMerchant` leaves hashes identical; ESLint forbids importing `normalize-merchant` from `dedupe-hash`                                                                        |
| Source identifier reused for different txns                                                 | `dedupe.test`: source downgraded to `fields`, existing identifier hashes recomputed in the same transaction, one warning logged                                                                                                                      |
| Sticky downgrade across syncs                                                               | `worker-contract.test`: sync N has an identifier collision → downgrade; sync N+1 has no collision and overlaps N → 0 new rows, `sources.hash_kind` still `fields`; attempting `UPDATE sources SET hash_kind='identifier'` is rejected by the trigger |
| Downgrade transaction fails midway                                                          | `dedupe-downgrade.integration.test`: injected failure after step (2) → rollback leaves source `identifier`, no hashes changed, sync run marked failed                                                                                                |
| Identifier appears only after pending→completed                                             | `pending-match.test`: fields-hash pending row updated to identifier hash, old hash kept in `previous_hashes`                                                                                                                                         |
| Forecast with no expected income set / with reserve 17%                                     | `forecast.test`: falls back to received income with hint flag; reserve subtracted from safe-to-spend and from projected net; reserve scope by category                                                                                               |
| PDF with name/address/account number                                                        | `pdf-redaction.test`: masked tokens absent from payload in `redacted_text` mode; `raw_pdf` requires opt-in flag or request rejected                                                                                                                  |
| Hebrew/English/mixed, RTL marks, emoji, whitespace, NFKC                                    | `normalize-merchant.test` table-driven                                                                                                                                                                                                               |
| windows-1255 CSV, UTF-8 BOM, UTF-16                                                         | `csv-encoding.test` with fixture bytes                                                                                                                                                                                                               |
| XLSX merged headers, summary rows, empty rows, `DD/MM/YYYY` vs `YYYY-MM-DD` vs Excel serial | `xlsx-preset.test`                                                                                                                                                                                                                                   |
| Empty month, new account, closed account                                                    | `month-summary.test`, UI empty states (Playwright)                                                                                                                                                                                                   |
| Scraper errors: each `ScraperErrorTypes`, change-password page, partial accounts, timeout   | `worker-contract.test`: run status, source disabled only for login-class, no retry (spy on `scrape` called once)                                                                                                                                     |
| LLM down / malformed JSON / 429                                                             | `categorize-job.test` with msw: rows remain `uncategorized`, job retried with backoff max 3, UI unaffected                                                                                                                                           |
| Midnight/DST/month boundary                                                                 | `dates.test`: `2026-03-27T00:30+02:00` vs UTC; Oct DST end; `31/12 23:59`                                                                                                                                                                            |
| Card cycle with missing card data                                                           | `card-link.test`: `partial`, diff shown, still excluded                                                                                                                                                                                              |
| Transfer false positive (same amount, unrelated merchants)                                  | `transfers.test`: vocabulary required; user unlink persists over relink                                                                                                                                                                              |
| Upload: wrong extension, zip bomb, 20 MB, HTML disguised as CSV                             | `upload.test`: rejected by sniff/size                                                                                                                                                                                                                |
| Duplicate file upload                                                                       | `imports.test`: sha256 unique → 409 with Hebrew message                                                                                                                                                                                              |

### 8.4 Fixtures

`@pinkas/fixtures`: seeded PRNG generator (`generateHousehold({months:12, seed})`) producing accounts, salary (10th), rent, arnona bi-monthly, standing orders, ~120 card txns/month across merchants with Hebrew names, 2 installment plans, 3 refunds, monthly card settlement debits that sum exactly, 4 transfers, 1 FX purchase; emits ground-truth expected monthly totals; exports as scraper-result JSON, CSV (both encodings), XLSX, and a PDF-like text fixture.

### 8.5 CI (`.github/workflows/ci.yml`)

Jobs: `lint` → `typecheck` → `unit` (coverage, thresholds: `domain` 90% lines/branches, `file-parsers` 85%, others informational) → `integration` (Postgres service container) → `build` (docker images) → `e2e` (compose test profile, Playwright, on PR + main). `restore-drill` weekly cron. Renovate config: automerge patch for non-sensitive deps; `israeli-bank-scrapers`, `puppeteer*`, `@anthropic-ai/sdk`, `libsodium-wrappers` require manual PR review (labelled `security-review`).

---

## 9. Code quality setup

- TS `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; `@typescript-eslint/no-explicit-any: error` (justify with `// eslint-disable-next-line ... -- reason`).
- ESLint: `import/no-restricted-paths` (layering), `no-restricted-imports` for `israeli-bank-scrapers` outside worker scrapers dir, `no-console` (use pino), `eslint-plugin-security` basics.
- Errors: `PinkasError` base with `code` (from `shared/errors.ts`), `messageHe`, `cause`; Fastify error handler maps to HTTP; worker maps `ScraperErrorTypes` → `SyncError`.
- Commits: conventional (`feat(api): …`), branches `feat/…`, PRs with template checklist (tests, docs, migration down).
- Docs: `README.md`, `docs/architecture.md`, `docs/security.md`, `docs/backup-restore.md`, `docs/adding-a-source.md`, ADRs: 0001 stack (Fastify/Drizzle/Recharts), 0002 money as agorot, 0003 installments per charge, 0004 sealed-box credentials, 0005 worker isolation & `--no-sandbox`, 0006 LLM boundary, 0007 MCP transport.

### Initial `CLAUDE.md`

```
# Pinkas — project conventions
- Monorepo: pnpm + turbo. Apps: api (Fastify), web (Vite/React RTL), sync-worker, mcp-server. Packages: shared, domain, db, file-parsers, fixtures, config.
- Layering: shared ← domain ← {db, file-parsers} ← apps. `domain` is pure (no I/O). Never import `israeli-bank-scrapers` outside apps/sync-worker/src/scrapers.
- Money: integer agorot (`bigint` in DB, `number` in TS via packages/domain/money). Never use floats for amounts. Sign: negative = outflow.
- Dates: `txn_date` is a civil date in Asia/Jerusalem. Use `domain/dates` (Temporal); never `new Date()` arithmetic for months.
- Dedupe: `domain/dedupe-hash` is frozen (identifier-first, minimal `descriptionKey`, `HASH_VERSION`). Never make it depend on `normalize-merchant`; changing it requires a version bump + recompute migration + golden-file update. Hash kind is decided by `sources.hash_kind` (sticky, downgrade-only, recompute in the same transaction), never per batch.
- Income is irregular (freelance): forecast uses `expected_income` per month and the tax-reserve setting, never recurring-income inference.
- Security: credentials are sealed-box encrypted; only sync-worker can decrypt. Never log/return/send credentials, account numbers, or raw scrape payloads. LLM payloads only via apps/api/src/llm/payloads.ts allow-list.
- Sync: never retry a failed login. Login-class errors disable the source.
- UI text Hebrew (RTL); code, comments, logs English. Use `shared/format` for ILS and DD/MM/YYYY.
- Tests: Vitest unit (domain ≥90%), Testcontainers integration, Playwright e2e. Fixtures are synthetic (packages/fixtures); no real data in repo. Run `pnpm test` before claiming done.
- DB: Drizzle schema in packages/db/src/schema; `pnpm db:generate` + write the `.down.sql`; `pnpm db:migrate`.
- Commands: `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `docker compose up`, `pnpm seed`.
- Conventional commits. Keep changes surgical; no speculative abstractions.
```

---

## 10. Risks & open decisions (with recommendation)

| Item                                                 | Recommendation                                                                                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fastify vs Express                                   | **Fastify** (schema-first + zod provider, hooks, perf)                                                                                                          |
| Drizzle vs Prisma                                    | **Drizzle**; down migrations hand-written; CI enforces up/down/up                                                                                               |
| Charts                                               | **Recharts 3**; revisit ECharts only if we need heavy interactivity                                                                                             |
| Installments                                         | **Per charged installment** (decided); purchase-view via group key                                                                                              |
| Credential key                                       | **Sealed box + key file** (decided); passphrase mode not built                                                                                                  |
| Pepper                                               | Expect `leumi` probe to fail (app-only). Keep probe script; use file import. Risk: Pepper export formats unknown until you share samples                        |
| Amex                                                 | Excluded; WAF blocks headless (issue #1057)                                                                                                                     |
| Egress allowlist                                     | Bank CDNs change → sync breaks. Mitigation: discovery mode + clear "proxy denied host" log line. Can be disabled via `EGRESS_MODE=off`                          |
| Chromium in WSL/docker                               | Use Debian `chromium` package in worker image, pin image digest; `--disable-dev-shm-usage` + `shm_size: 1g`                                                     |
| PDF parsing                                          | Heuristic first; Sonnet fallback on redacted text with mandatory total reconciliation; raw PDF only by per-import opt-in; never auto-commit unreconciled        |
| Dedupe hash drift                                    | Identifier-first hashing, frozen `descriptionKey`, `hash_version` + raw inputs stored so a future recompute migration is possible; golden test guards it        |
| Identifier uniqueness flips between batches          | `sources.hash_kind` is sticky; downgrade to `fields` recomputes the source's existing hashes in the same transaction and a trigger forbids upgrading back       |
| Irregular income                                     | Manual expected income per month + tax reserve %; no recurring-income inference in forecast                                                                     |
| Batches API                                          | Dropped; synchronous calls with backoff are sufficient at single-user volume                                                                                    |
| Egress proxy timing                                  | Built last in Phase 2, default `EGRESS_MODE=off`, so it cannot mask scraper problems while sync is first brought up                                             |
| Card settlement matching when card scrape is partial | `partial` status, still excluded, surfaced; manual link in UI                                                                                                   |
| `transactions.raw` retention                         | Keep 90 days (debug), purge job; `pinkas_readonly` cannot see it                                                                                                |
| MCP for Claude Desktop                               | HTTP + `mcp-remote` bridge (keeps DB internal). Fallback: `wsl.exe` stdio launcher with a second MCP entry point reading via HTTP from api—not needed initially |
| pg-boss vs node-cron                                 | pg-boss (one mechanism for cron + queue + retries, no Redis) Superseded for sync by ADR 0009.                                                                   |
| Scraper updates                                      | Renovate opens PR but never automerges; `pnpm.overrides` pins `puppeteer` exactly                                                                               |
| Startup secrets                                      | docker secrets files under `docker/secrets/` (gitignored), generated by `scripts/init-secrets.sh`                                                               |

---

## 11. Verification (end-to-end)

1. `pnpm install && pnpm lint && pnpm typecheck && pnpm test` green locally and in CI.
2. `docker compose up -d` → open `http://127.0.0.1:5173`, login, import `packages/fixtures/out/beinleumi.csv` → preview shows mapping and duplicates → confirm → dashboard month totals equal `expected.json` from the generator; import again → "0 new rows".
3. Add a real source (beinleumi) → "sync now" → sync history shows success, accounts + balances appear; run again → 0 added; card settlement rows show "מקושר לחיוב כרטיס" and are excluded.
4. Enter a wrong password on purpose for a card source → one failed run, source disabled, Hebrew error, no second attempt in logs.
5. `claude mcp add --transport http pinkas http://127.0.0.1:3100/mcp` → ask "כמה הוצאתי על מזון החודש?" → numbers match dashboard.
6. `scripts/restore-drill.sh` restores last night's backup into a scratch DB and invariants pass.
7. `GET /healthz/invariants` returns all green on real data.
8. Change `normalizeMerchant` locally (e.g. strip a new suffix), run sync again → 0 new rows, confirming hashes are independent of merchant normalization.
9. Set expected income for the month and a 17% reserve → dashboard safe-to-spend equals `expected − reserve − committed fixed − variable spent` computed by hand from the transactions table.
10. Import a PDF fixture without the opt-in → the LLM audit row shows `redacted_text` and the captured payload (test mode) contains no account number or name.
