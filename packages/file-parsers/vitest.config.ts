import { defineProject } from 'vitest/config';
import { sourceConditions } from '../../vitest.shared.js';
export default defineProject({
  ...sourceConditions,
  test: { name: 'file-parsers', include: ['src/**/*.test.ts'] },
});
