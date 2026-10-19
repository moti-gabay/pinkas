import { defineProject } from 'vitest/config';
import { sourceConditions } from '../../vitest.shared.js';
export default defineProject({
  ...sourceConditions,
  test: {
    name: 'sync-worker',
    include: ['src/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
