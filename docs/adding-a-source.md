# Adding a source

## Scraper company

1. Add it to `supportedCompanies` in `packages/shared/src/scrapers.ts` (name, kind, login fields — copy from the library's `SCRAPERS`, do not import it).
2. Add a synthetic recorded result under `packages/fixtures/src/scraper-results/`.
3. Run the contract tests in `apps/sync-worker`.

## File preset

1. Drop a redacted sample in `data/samples/` (gitignored).
2. Create `packages/file-parsers/src/presets/<source>.ts` implementing `SourceAdapter` (`detect`, `defaultMapping`, `parse`).
3. Add a synthetic fixture file mirroring its structure in `packages/fixtures` and a test.
