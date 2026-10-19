import { defineProject } from 'vitest/config';
import { sourceConditions } from '../../vitest.shared.js';
export default defineProject({
  ...sourceConditions,
  test: { name: 'web', include: ['src/**/*.test.{ts,tsx}'], environment: 'jsdom' },
});
