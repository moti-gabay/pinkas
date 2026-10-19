import {
  errorMessagesHe,
  loginClassErrors,
  type ErrorCode,
  type ScraperErrorType,
  type SyncRunDto,
} from '@pinkas/shared';

const errorCodeByType: Partial<Record<ScraperErrorType, ErrorCode>> = {
  INVALID_PASSWORD: 'SYNC_LOGIN_FAILED',
  CHANGE_PASSWORD: 'SYNC_CHANGE_PASSWORD',
  ACCOUNT_BLOCKED: 'SYNC_ACCOUNT_BLOCKED',
  TIMEOUT: 'SYNC_TIMEOUT',
  TWO_FACTOR_RETRIEVER_MISSING: 'SYNC_UNSUPPORTED_2FA',
};

/** Worker-side error types that are not scraper errors. */
const workerErrorsHe: Record<string, string> = {
  DISABLED: 'המקור מושבת',
  NO_CREDENTIALS: 'לא הוזנו פרטי התחברות למקור',
};

/** Sync error type → Hebrew explanation; null when there is no error. */
export function syncErrorMessageHe(errorType: string | null): string | null {
  if (errorType === null) return null;
  // Object.hasOwn keeps arbitrary server strings ("constructor") from hitting the prototype.
  if (Object.hasOwn(workerErrorsHe, errorType)) return workerErrorsHe[errorType] ?? null;
  const code = Object.hasOwn(errorCodeByType, errorType)
    ? errorCodeByType[errorType as ScraperErrorType]
    : undefined;
  return errorMessagesHe[code ?? 'SYNC_FAILED'];
}

/** Login-class errors disable the source; retrying them could lock the bank account. */
export function isLoginClassError(errorType: string | null): boolean {
  return errorType !== null && (loginClassErrors as ReadonlySet<string>).has(errorType);
}

export function isRunActive(run: Pick<SyncRunDto, 'status'> | undefined): boolean {
  return run?.status === 'queued' || run?.status === 'running';
}

/** Milliseconds → "850 מ״ש" / "12.3 שנ׳" / "2:05 דק׳"; "—" when unknown. */
export function formatDuration(ms: number | null): string {
  if (ms === null || ms < 0) return '—';
  if (ms < 1000) return `${ms} מ״ש`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} שנ׳`;
  const totalSec = Math.round(ms / 1000);
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')} דק׳`;
}

export const triggerHe: Record<SyncRunDto['trigger'], string> = {
  schedule: 'מתוזמן',
  manual: 'ידני',
};

export const runStatusHe: Record<SyncRunDto['status'], string> = {
  queued: 'בתור',
  running: 'רץ',
  success: 'הצליח',
  failed: 'נכשל',
  partial: 'חלקי',
};

export const runStatusClass: Record<SyncRunDto['status'], string> = {
  queued: 'bg-gray-100 dark:bg-gray-800',
  running: 'bg-blue-100 text-blue-800',
  success: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  partial: 'bg-amber-100 text-amber-800',
};
