import { abortRace } from './abort';
import { _makeScopedAbortSignal, type Options } from './common';
import { newSemaphore, type Semaphore } from './semaphore';

/**
 * Convenient function to perform a concurrent map operation.
 *
 * `options.signal` and `options.timeout` apply to the whole call: when either
 * triggers, the returned promise rejects immediately and items still waiting
 * for a permit are not started. Calls to `fn` that are already running are
 * not interrupted; they finish in the background and release their permits.
 */
export async function parallelMap<T, U>(
  array: T[],
  fn: (item: T) => Promise<U>,
  semaphore: Semaphore | number,
  options?: Options
): Promise<U[]> {
  const s = typeof semaphore === 'number' ? newSemaphore(semaphore) : semaphore;
  const { signal, cleanup } = _makeScopedAbortSignal(options);
  try {
    signal?.throwIfAborted();
    const results = Promise.all(
      array.map(async item => {
        if (!s.maybeAcquire()) {
          await s.acquire({ signal });
        }
        try {
          return await fn(item);
        } finally {
          s.release();
        }
      })
    );
    return await (signal ? abortRace(results, signal) : results);
  } finally {
    cleanup();
  }
}
