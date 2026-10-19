import { defineProject } from 'vitest/config';
import { sourceConditions } from '../../vitest.shared.js';
export default defineProject({
  ...sourceConditions,
  test: { name: 'api', include: ['src/**/*.test.ts'] },
});
