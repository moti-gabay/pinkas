import { commonEnv, databaseUrlEnv, loadEnv } from '@pinkas/shared';
import { z } from 'zod';

export const config = loadEnv({
  ...commonEnv,
  ...databaseUrlEnv,
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SESSION_SECRET: z.string().min(32),
  /** X25519 public key (base64) used to seal bank credentials. The private key never reaches this process. */
  CREDENTIALS_PUBLIC_KEY: z.string().min(40).optional(),
  UPLOAD_DIR: z.string().default('/data/uploads'),
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .default(15 * 1024 * 1024),
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODEL_CATEGORIZE: z.string().default('claude-haiku-5-5'),
  LLM_MODEL_INSIGHTS: z.string().default('claude-sonnet-5-5'),
});

export type Config = typeof config;
