/**
 * Utility functions for working with AbortSignal and AbortController
 */

/**
 * Converts an {@link AbortSignal} into a Promise that rejects when the signal is aborted
 * @param signal - The {@link AbortSignal} to convert
 * @returns Promise that never resolves but rejects when the signal is aborted
 * @category Promise
 */
export function abortPromise(signal: AbortSignal): Promise<never> {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }

  return new Promise<never>((_, reject) => {
    const abortHandler = () => {
      reject(signal.reason);
    };
    signal.addEventListener('abort', abortHandler, { once: true });
  });
}

/**
 * Creates a race condition between a promise and an abort signal.
 * @param promise - The promise to race
 * @param signal - The abort signal
 * @returns Promise that resolves with the original promise or rejects if aborted
 * @category Promise
 */
export async function abortRace<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  signal.throwIfAborted();
  return Promise.race([promise, abortPromise(signal)]);
}

/**
 * Sleeps for the specified duration or until aborted
 * @param ms - Duration to sleep in milliseconds
 * @param signal - Optional abort signal
 * @returns Promise that resolves after the duration or rejects if aborted
 * @category Promise
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted();

    const timeoutId = setTimeout(resolve, ms);

    if (signal) {
      const abortHandler = () => {
        clearTimeout(timeoutId);
        reject(signal.reason);
      };

      signal.addEventListener('abort', abortHandler, { once: true });
    }
  });
}
