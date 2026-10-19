/**
 * Tests resolve workspace packages to their src/ through the "source" export condition, so a direct
 * `vitest run` inside a package can never pass against a stale dist/. Builds and Node ignore the condition.
 * Vite replaces (not extends) the default conditions, hence the spreads.
 */
import { defaultClientConditions, defaultServerConditions } from 'vite';

export const sourceConditions = {
  resolve: { conditions: ['source', ...defaultClientConditions] },
  ssr: { resolve: { conditions: ['source', ...defaultServerConditions] } },
};
