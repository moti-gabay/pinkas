import { defineProject } from 'vitest/config';
import { sourceConditions } from '../../vitest.shared.js';
export default defineProject({
  ...sourceConditions,
  test: { name: 'domain', include: ['src/**/*.test.ts'] },
});
