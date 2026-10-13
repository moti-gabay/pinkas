import { defineProject } from 'vitest/config';
export default defineProject({ test: { name: 'sync-worker', include: ['src/**/*.test.ts'] } });
