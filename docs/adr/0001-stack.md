# ADR 0001: Stack

**Status:** accepted (2026-10-13)

- Fastify 5 over Express: schema-first routes with a zod type provider, built-in hooks for helmet/rate-limit/cookies, better TypeScript.
- Drizzle over Prisma: SQL-shaped queries for the many aggregations, no engine binary (small worker/MCP images), reviewable SQL migrations. Down migrations are hand-written per migration and CI runs up→down→up.
- Recharts 3 for charts: composable React API; charts render LTR inside the RTL page.
- pg-boss for cron + queue: Postgres-backed, no Redis. _Superseded for bank sync by [ADR 0009](0009-croner-instead-of-pg-boss.md) (croner + a `sync_runs` queue)._
- Vite + React 19 + TanStack Router/Query/Table + Tailwind 4 for the web app.
