import { install, type InstalledClock } from '@sinonjs/fake-timers';
import { CrntError, isResolved } from './common';

/**
 * Utility function to create a deferred promise (uses Promise.withResolvers if available)
 */
export function withResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  if (Promise.withResolvers) {
    return Promise.withResolvers<T>();
  }

  let resolve: (value: T | PromiseLike<T>) => void;
  let reject: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve: resolve!, reject: reject! };
}

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
      error.message.includes('operation was aborted')
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
