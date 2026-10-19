/**
 * Records a sync run's outcome on its source. Outcomes that never reached the bank (DISABLED, NO_CREDENTIALS)
 * must not replace a login-class marker: the API refuses to re-enable a source while that marker is set, so
 * overwriting it would let a plain toggle trigger another failed login. The guard is in the UPDATE itself.
 */
import { loginClassErrors } from '@pinkas/shared';
import { and, eq, isNull, notInArray, or } from 'drizzle-orm';
import type { Db } from './client.js';
import * as schema from './schema/index.js';

/** Run outcomes decided before any scrape was attempted. */
export const notAttemptedErrors: ReadonlySet<string> = new Set(['DISABLED', 'NO_CREDENTIALS']);

const s = schema.sources;

/** `errorType` null means success. */
export async function recordSourceOutcome(
  db: Db,
  sourceId: string,
  errorType: string | null,
): Promise<void> {
  if (errorType === null) {
    await db
      .update(s)
      .set({ lastSuccessAt: new Date(), lastErrorType: null, lastErrorAt: null })
      .where(eq(s.id, sourceId));
    return;
  }
  const keepLoginMarker = notAttemptedErrors.has(errorType)
    ? or(isNull(s.lastErrorType), notInArray(s.lastErrorType, [...loginClassErrors]))
    : undefined;
  await db
    .update(s)
    .set({ lastErrorType: errorType, lastErrorAt: new Date() })
    .where(and(eq(s.id, sourceId), keepLoginMarker));
}
