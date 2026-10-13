import { commonEnv, databaseUrlEnv, loadEnv } from '@pinkas/shared';
import { z } from 'zod';

export const config = loadEnv({
  ...commonEnv,
  ...databaseUrlEnv,
  MCP_HOST: z.string().default('127.0.0.1'),
  MCP_PORT: z.coerce.number().int().default(3100),
  MCP_TOKEN: z.string().min(24),
});
