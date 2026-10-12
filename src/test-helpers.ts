import { install, type Clock } from '@sinonjs/fake-timers';
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
  testFn: (clock: Clock) => Promise<T>
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

/**
 * Fake timers that only advance when the test ticks the clock. Unlike
 * {@link withFakeTimers}, pending timers are not run eagerly, so the test can
 * observe state right before and after a timeout fires.
 */
export async function withManualClock(
  testFn: (clock: Clock) => Promise<void>
): Promise<void> {
  const clock = install();
  try {
    await testFn(clock);
  } finally {
    clock.uninstall();
  }
}

/**
 * Wraps `signal` so the test can see how many abort listeners are currently
 * registered on it.
 */
export function trackListeners(signal: AbortSignal): () => number {
  const listeners = new Set<unknown>();
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (
    ...args: Parameters<AbortSignal['addEventListener']>
  ) => {
    listeners.add(args[1]);
    add(...args);
  };
  signal.removeEventListener = (
    ...args: Parameters<AbortSignal['removeEventListener']>
  ) => {
    listeners.delete(args[1]);
    remove(...args);
  };
  return () => listeners.size;
}
