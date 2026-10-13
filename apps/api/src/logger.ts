import { pino } from 'pino';
import { config } from './config.js';
import { maskDigits } from './redact.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      'password',
      '*.password',
      '*.*.password',
      'username',
      '*.username',
      '*.*.username',
      'card6Digits',
      '*.card6Digits',
      '*.*.card6Digits',
      'credentials',
      '*.credentials',
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'ciphertext',
      '*.ciphertext',
    ],
    censor: '[REDACTED]',
  },
  formatters: {
    log(obj) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k] =
          typeof v === 'string' && /account|description|external|label/i.test(k)
            ? maskDigits(v)
            : v;
      }
      return out;
    },
  },
  ...(config.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } }
    : {}),
});
