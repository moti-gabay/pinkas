/** Masks any digit run of 6+ to its last 4 digits. Applied to free-text fields that may carry account numbers. */
export function maskDigits(value: string): string {
  return value.replace(/\d{6,}/g, (run) => `${'*'.repeat(run.length - 4)}${run.slice(-4)}`);
}
