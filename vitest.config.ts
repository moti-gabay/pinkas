import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Globs are matched against the repo root in an unfiltered run but against each project's root under
      // --project, so 'packages/*/src/**' and 'src/**' each match nothing in one of the two modes. This matches both.
      include: ['**/src/**'],
      exclude: ['**/node_modules/**', '**/*.test.ts', '**/*.test.tsx', '**/index.ts', '**/*.d.ts'],
      // Plan §7, Phase 1 acceptance: domain coverage >= 90%.
      thresholds: {
        '**/packages/domain/src/**': { statements: 90, branches: 90, functions: 90, lines: 90 },
      },
    },
  },
});
