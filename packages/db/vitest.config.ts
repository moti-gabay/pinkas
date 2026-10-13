import { defineProject } from 'vitest/config';
export default defineProject({
  test: { name: 'db', include: ['src/**/*.test.ts'], testTimeout: 60_000, hookTimeout: 120_000 },
});
