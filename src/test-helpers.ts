import { install, type InstalledClock } from '@sinonjs/fake-timers';
import { CrntError, isResolved } from './common';

export { withResolvers } from './common';

/**
 * Helper function to expect abortion errors from promises across different test runners
 */
export async function expectAbortError(
  promise: Promise<unknown>
): Promise<void> {
  try {
    await promise;
    throw new Error(
      'Expected promise to reject with abort error, but it resolved'
    );
  } catch (error) {
    if (
      error instanceof Error &&
      // node / bun
      (error.message.includes('operation was aborted') ||
        // chrome
        error.message.includes('signal is aborted without reason'))
    ) {
      return; // Success - got the expected abort error
    }
    throw error; // Re-throw if it's not the expected abort error
  }
}

export const DEADLOCK_ERROR =
  'Test function is not resolved. This may mean a deadlock.';
/**
 * Helper for tests that need deterministic timing.
 */
export async function withFakeTimers<T>(
  testFn: (clock: InstalledClock) => Promise<T>
): Promise<T> {
  const clock = install();
  try {
    const p = testFn(clock);
    await clock.runAllAsync();
    const resolved = await isResolved(p);
    if (!resolved) {
      throw new CrntError(DEADLOCK_ERROR);
    }
    return await p;
  } finally {
    clock.uninstall();
  }
}
