import { defineProject } from 'vitest/config';
export default defineProject({ test: { name: 'fixtures', include: ['src/**/*.test.ts'] } });
