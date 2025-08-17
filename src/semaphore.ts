import { _makeAbortSignal, CrntError, type Options } from './common';
import { disposeSymbol } from './polyfill-explicit-resource-management';
import { withResolvers } from './test-helpers';

/**
 * @category Data Structure
 * @summary A permit that can be released when no longer needed, supporting TC39 resource management.
 */
export interface SemaphorePermit extends Disposable {
  /**
   * release the permit, making it available for other operations.
   *
   * This operaiton is idempotent.
   */
  release(): void;
}

/**
 * @category Data Structure
 * @summary Semaphore to protect critical sections and control concurrency.
 */
export interface Semaphore {
  /** asynchronously acquire a permit, waiting until one becomes available, or throw if aborted */
  acquire(options?: Options): Promise<SemaphorePermit>;
  /** synchronously acquire a permit if one is available, otherwise return undefined */
  maybeAcquire(): SemaphorePermit | undefined;
  /** release a permit, making it available for other operations */
  release(): void;
  /** run a function with a semaphore, acquiring a permit before running and releasing it after */
  run<T>(fn: () => Promise<T>, options?: Options): Promise<T>;
}

/**
 * Creates a new {@link Semaphore} with the given number of permits.
 *
 * @param permits - The number of permits the semaphore has.
 * @returns A new {@link Semaphore} instance.
 * @category Data Structure
 *
 * @example
 * ```typescript
 * const semaphore = newSemaphore(2);
 *
 * // Acquire a permit manually
 * const permit = await semaphore.acquire();
 * try {
 *   // Critical section - permit is automatically managed
 *   await fetch('/api/data');
 * } finally {
 *   permit.release();
 * }
 *
 * // Or use with automatic resource management
 * await using permit = await semaphore.acquire();
 * // Critical section - permit automatically released at end of scope
 * await fetch('/api/data');
 *
 * // Or use the run helper
 * await semaphore.run(async () => {
 *   // Critical section - permit automatically managed
 *   return await fetch('/api/data');
 * });
 * ```
 */
export function newSemaphore(permits: number): Semaphore {
  return new DefaultSemaphore(permits);
}

class DefaultSemaphorePermit implements SemaphorePermit {
  private semaphore: DefaultSemaphore;
  private released = false;

  constructor(semaphore: DefaultSemaphore) {
    this.semaphore = semaphore;
  }

  [disposeSymbol](): void {
    this.release();
  }

  release(): void {
    if (this.released) {
      return;
    }
    this.released = true;
    this.semaphore.release();
  }
}

export class DefaultSemaphore implements Semaphore {
  /** current number of active permits */
  private permits: number;
  /** maximum number of permits */
  private readonly maxPermits: number;
  private readonly waiting: Set<WaitingEntry> = new Set();

  constructor(permits: number) {
    this.permits = permits;
    this.maxPermits = permits;
  }

  async acquire(options?: Options): Promise<SemaphorePermit> {
    const signal = _makeAbortSignal(options);

    signal?.throwIfAborted();

    if (this.permits > 0) {
      this.permits--;
      return new DefaultSemaphorePermit(this);
    }

    const { promise, resolve, reject } = withResolvers<void>();
    const waitingEntry: WaitingEntry = { resolve };
    this.waiting.add(waitingEntry);

    if (signal) {
      const onAbort = () => {
        this.waiting.delete(waitingEntry);
        reject(signal.reason);
      };

      signal.addEventListener('abort', onAbort, { once: true });

      // Clean up the abort listener if we resolve normally
      const originalResolve = waitingEntry.resolve;
      waitingEntry.resolve = () => {
        signal.removeEventListener('abort', onAbort);
        originalResolve();
      };
    }

    await promise;
    return new DefaultSemaphorePermit(this);
  }

  maybeAcquire(): SemaphorePermit | undefined {
    if (this.permits > 0) {
      this.permits--;
      return new DefaultSemaphorePermit(this);
    }
    return undefined;
  }

  release(): void {
    if (this.waiting.size > 0) {
      const next = this.waiting.values().next().value;
      next!.resolve();
      this.waiting.delete(next!);
    } else {
      if (this.permits >= this.maxPermits) {
        throw new CrntError(
          `Cannot release permit: would exceed initial permit count of ${this.maxPermits}`
        );
      }
      this.permits++;
    }
  }

  async run<T>(fn: () => Promise<T>, options?: Options): Promise<T> {
    const permit = await this.acquire(options);
    try {
      return await fn();
    } finally {
      permit.release();
    }
  }
}

interface WaitingEntry {
  resolve: () => void;
}
