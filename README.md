# פנקס · Pinkas

Personal, self-hosted cash-flow manager for Israeli bank and credit-card accounts. Single user, runs on your own machine with docker compose. Read-only against the banks by design.

## What it does

- Pulls transactions automatically (read-only) via [`israeli-bank-scrapers`](https://github.com/eshaham/israeli-bank-scrapers) in an isolated worker container.
- Imports CSV / XLSX / PDF statements with a preview-and-confirm step.
- Normalizes everything: deduplication, pending→completed updates, credit-card charge ↔ bank debit linking, own-account transfers, installments, refunds, foreign currency.
- Categorizes with user rules, then Claude, then learns rules from your corrections.
- Hebrew RTL dashboard: monthly cash flow, budgets, safe-to-spend forecast, recurring charges, 12-month trends, AI-written monthly insights.
- Read-only MCP server so you can ask Claude Code / Claude Desktop about your finances.

## Read-only by design

The sync worker calls exactly one library function, `createScraper(...).scrape(credentials)`. There is no code path for transfers, payments or any write action against a bank, and an ESLint rule forbids importing the scraper library anywhere else. See `docs/security.md`.

**Recommendation:** check whether your bank offers a view-only user (משתמש צפייה בלבד) and use it for Pinkas, so read-only is enforced on the bank's side too.

## Setup (WSL / Ubuntu)

Prerequisites: Docker Desktop with WSL integration, Node 24, pnpm 10 (`corepack enable`).

```bash
git clone <your-repo> pinkas && cd pinkas
pnpm install
pnpm pinkas keygen            # creates ~/.pinkas/worker.key (private) and prints CREDENTIALS_PUBLIC_KEY
pnpm pinkas init-secrets      # generates docker/secrets/* (DB role passwords)
cp .env.example .env          # fill SESSION_SECRET, CREDENTIALS_PUBLIC_KEY, MCP_TOKEN, ANTHROPIC_API_KEY
docker compose up -d --build
```

Open http://127.0.0.1:5173. Everything is bound to localhost; nothing is reachable from your LAN.

### Development

```bash
docker compose up -d db migrate   # just the database
pnpm dev                          # api + web with hot reload
pnpm test                         # unit + integration (needs TEST_DATABASE_URL or docker)
pnpm seed                         # synthetic household data for the dashboard
```

### Sample statements

Drop redacted exports from your banks in `data/samples/` (gitignored). Bank-specific parser presets are written against them; synthetic fixtures mirror their structure.

## Backup & restore

See `docs/backup-restore.md`. Backups are `pg_dump` piped through `age`; the restore drill script verifies a backup can actually be restored.

## Adding a source

See `docs/adding-a-source.md` (scraper companies in `packages/shared/src/scrapers.ts`, file presets in `packages/file-parsers/src/presets/`).

## Security model

`docs/security.md` has the threat model, key handling, DB roles, network isolation and the LLM data boundary.
