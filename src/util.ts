import type { Options } from './common';
import { newSemaphore, type Semaphore } from './semaphore';

/** Convenient function to perform a concurrent map operation. */
export function parallelMap<T, U>(
  array: T[],
  fn: (item: T) => Promise<U>,
  semaphore: Semaphore | number,
  options?: Options
): Promise<U[]> {
  const s = typeof semaphore === 'number' ? newSemaphore(semaphore) : semaphore;
  return Promise.all(
    array.map(async item => {
      if (!s.maybeAcquire()) {
        await s.acquire(options);
      }
      try {
        return await fn(item);
      } finally {
        s.release();
      }
    })
  );
}
