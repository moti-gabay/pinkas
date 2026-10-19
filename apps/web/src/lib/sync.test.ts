import { errorMessagesHe } from '@pinkas/shared';
import { describe, expect, it } from 'vitest';
import { formatDuration, isLoginClassError, isRunActive, syncErrorMessageHe } from './sync';

describe('sync helpers', () => {
  it('maps scraper error types to Hebrew explanations', () => {
    expect(syncErrorMessageHe(null)).toBeNull();
    expect(syncErrorMessageHe('INVALID_PASSWORD')).toBe(errorMessagesHe.SYNC_LOGIN_FAILED);
    expect(syncErrorMessageHe('CHANGE_PASSWORD')).toBe(errorMessagesHe.SYNC_CHANGE_PASSWORD);
    expect(syncErrorMessageHe('ACCOUNT_BLOCKED')).toBe(errorMessagesHe.SYNC_ACCOUNT_BLOCKED);
    expect(syncErrorMessageHe('TIMEOUT')).toBe(errorMessagesHe.SYNC_TIMEOUT);
    expect(syncErrorMessageHe('TWO_FACTOR_RETRIEVER_MISSING')).toBe(
      errorMessagesHe.SYNC_UNSUPPORTED_2FA,
    );
  });

  it('falls back to the generic message for unknown and prototype-named types', () => {
    expect(syncErrorMessageHe('GENERIC')).toBe(errorMessagesHe.SYNC_FAILED);
    expect(syncErrorMessageHe('GENERAL_ERROR')).toBe(errorMessagesHe.SYNC_FAILED);
    expect(syncErrorMessageHe('constructor')).toBe(errorMessagesHe.SYNC_FAILED);
    expect(syncErrorMessageHe('DISABLED')).toBe('המקור מושבת');
  });

  it('classifies login-class errors and active runs', () => {
    expect(isLoginClassError('INVALID_PASSWORD')).toBe(true);
    expect(isLoginClassError('TWO_FACTOR_RETRIEVER_MISSING')).toBe(true);
    expect(isLoginClassError('TIMEOUT')).toBe(false);
    expect(isLoginClassError(null)).toBe(false);
    expect(isRunActive({ status: 'queued' })).toBe(true);
    expect(isRunActive({ status: 'running' })).toBe(true);
    expect(isRunActive({ status: 'partial' })).toBe(false);
    expect(isRunActive(undefined)).toBe(false);
  });

  it('formats durations', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(850)).toBe('850 מ״ש');
    expect(formatDuration(12_340)).toBe('12.3 שנ׳');
    expect(formatDuration(125_000)).toBe('2:05 דק׳');
    expect(formatDuration(119_600)).toBe('2:00 דק׳');
  });
});
