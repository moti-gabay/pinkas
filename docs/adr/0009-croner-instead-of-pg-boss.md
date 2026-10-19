# ADR 0009: croner and a `sync_runs` queue instead of pg-boss for sync scheduling

**Status:** accepted (2026-10-19). Supersedes the pg-boss choice in ADR 0001 and plan §2 / Phase 2 step 3 **for bank sync only**; background jobs for Phase 3 (categorization, insights) are decided there.

## Context

Sync has three requirements that a general job queue works against:

1. **A failed login is never retried.** Banks lock accounts after a few bad logins. pg-boss's main features for this use case (retries, backoff, re-delivery of jobs whose worker died) are exactly what must not happen to a login.
2. **One scrape at a time.** One Chromium per container; concurrency is 1 by design.
3. **Single user, single worker.** A handful of sources, one or two runs a day each.

## Decision

- **Scheduling:** the worker ticks every 15 s (`apps/sync-worker/src/pipeline/tick.ts`). For each scraper source that is `enabled` and has no login-class `last_error_type`, it asks [croner](https://github.com/hexagon/croner) for the first occurrence of `schedule_cron` (default `30 6 * * *`, Asia/Jerusalem) inside the last 60 s, and runs it at most once per occurrence.
- **Manual sync ("sync now"):** `POST /sources/:id/sync` inserts a `sync_runs` row with `status = 'queued'` (enum value added in migration 0002). It is refused (409) for a disabled source, and returns the existing row if one is already `queued` or `running`, so double-clicks do not stack. Each tick first runs queued rows oldest-first; `syncSource` marks the row `running`, then `success` / `partial` / `failed`.
- **History and status** live in `sync_runs` and on `sources`, which the API and UI already read. There is no second job store.

## The no-retry guarantee

- Nothing re-runs a finished run. A failed run is final; the next attempt is the next cron occurrence, at most once per day by default.
- A login-class result (`INVALID_PASSWORD`, `CHANGE_PASSWORD`, `ACCOUNT_BLOCKED`, `TWO_FACTOR_RETRIEVER_MISSING`; `loginClassErrors` in `@pinkas/shared`) sets `enabled = false` and keeps the marker in `last_error_type`. Outcomes that never reached the bank (`DISABLED`, `NO_CREDENTIALS`) cannot overwrite it (`recordSourceOutcome`).
- The tick skips disabled sources **and** marked sources, so even a source re-enabled outside the API is not scheduled. A queued run for a disabled source is closed as `DISABLED` without calling the scraper.
- Only `PUT /sources/:id/credentials` clears the marker and re-enables the source; `PATCH {enabled: true}` returns 409 while it is set.
- The guard is database state, not process memory: a restarted worker skips the same sources. Proven by `tick.test.ts` (including a restarted process) and by the Phase 2 smoke test, in which a disabled source on an every-minute schedule was skipped for three consecutive occurrences.

## What we give up

- **No catch-up of missed schedules.** If the worker is down at 06:30, that day's scheduled run is skipped (a manual "sync now" still works). pg-boss would run it late.
- **At most one worker replica.** Queued rows are claimed without `FOR UPDATE SKIP LOCKED`; two replicas could run the same manual request twice. Adding the lock is a small change if a second worker is ever needed.
- **Occurrence state is in memory.** A worker restarted within the 60 s window right after firing an occurrence can fire it once more. For a login failure this is harmless (the source is already disabled and skipped); for other outcomes it is one extra scrape, never a loop.
- **No generic retries or backoff,** deliberately.

## Consequences

One fewer runtime dependency and no extra schema owned by a library. The scheduling and no-retry rules are under 100 lines (`tick.ts`) that tests drive directly with a fake clock.
