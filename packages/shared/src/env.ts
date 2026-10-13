import { z } from 'zod';

/**
 * Validated-at-startup configuration. Each app composes its own schema from these pieces and
 * calls `loadEnv(schema)`; a missing/invalid variable aborts the process before any I/O starts.
 */
export const commonEnv = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  TZ: z.literal('Asia/Jerusalem').default('Asia/Jerusalem'),
};

export const databaseUrlEnv = {
  DATABASE_URL: z.url().startsWith('postgres'),
};

export function loadEnv<T extends z.ZodRawShape>(
  shape: T,
  source: NodeJS.ProcessEnv = process.env,
): z.infer<z.ZodObject<T>> {
  const result = z.object(shape).safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${lines}`);
  }
  return result.data;
}
