// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Layering: shared ← domain ← {db, file-parsers} ← apps. Enforced via restricted imports. */
const noIo = {
  patterns: [
    { group: ['@pinkas/db', '@pinkas/db/*'], message: 'domain must stay pure (no DB).' },
    {
      group: ['@pinkas/file-parsers', '@pinkas/file-parsers/*'],
      message: 'domain must stay pure.',
    },
    {
      group: ['node:fs', 'node:http', 'node:net', 'fs', 'http', 'net', 'pg', 'postgres'],
      message: 'domain must stay pure (no I/O).',
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.config.*',
      'packages/db/migrations/**',
      'apps/web/src/routeTree.gen.ts',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-console': 'error',
      // Fastify plugins/routes are async by contract even when they only register handlers.
      '@typescript-eslint/require-await': 'off',
      // Only the sync worker's scraper module may touch the scraping library.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'israeli-bank-scrapers',
              message: 'Only apps/sync-worker/src/scrapers may import the scraper library.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/domain/src/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { ...noIo, paths: [{ name: 'israeli-bank-scrapers', message: 'domain is pure.' }] },
      ],
    },
  },
  {
    // The dedupe hash is frozen: it must never depend on the evolving merchant normalizer.
    files: ['packages/domain/src/dedupe-hash.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          ...noIo,
          patterns: [
            ...noIo.patterns,
            {
              group: ['./normalize-merchant', '**/normalize-merchant'],
              message: 'dedupe-hash must not depend on normalize-merchant (hash stability).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/sync-worker/src/scrapers/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'packages/fixtures/src/**', 'scripts/**'],
    rules: {
      // Test bodies read untyped JSON responses; the assertions are the type check.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      'no-console': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-restricted-imports': 'off',
    },
  },
);
