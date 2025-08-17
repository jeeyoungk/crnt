import { _makeAbortSignal, CrntError, type Options } from './common';
import { withResolvers } from './test-helpers';
import {
  disposeSymbol,
  asyncDisposeSymbol,
} from './resource-management-polyfill';

/**
 * @category Data Structure
 * @summary A permit that can be released when no longer needed, supporting TC39 resource management.
 */
export interface SemaphorePermit {
  /** release the permit synchronously */
  [disposeSymbol](): void;
  /** release the permit asynchronously */
  [asyncDisposeSymbol](): Promise<void>;
  /** release the permit, making it available for other operations */
  release(): void;
}

/**
 * @category Data Structure
 * @summary Semaphore to protect critical sections and control concurrency.
 */
export interface Semaphore {
  /** asynchronously acquire a permit, waiting until one becomes available, or throw if aborted */
  acquire(options?: Options): Promise<void>;
  /** asynchronously acquire a permit that supports resource management, waiting until one becomes available, or throw if aborted */
  acquirePermit(options?: Options): Promise<SemaphorePermit>;
  /** synchronously acquire a permit if one is available, otherwise return false */
  maybeAcquire(): boolean;
  /** synchronously acquire a permit that supports resource management if one is available, otherwise return undefined */
  maybeAcquirePermit(): SemaphorePermit | undefined;
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
 * // Limit concurrent operations to 2
 * await semaphore.run(async () => {
 *   // Critical section - only 2 operations can run simultaneously
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

  [Symbol.dispose](): void {
    this.release();
  }

  async [Symbol.asyncDispose](): Promise<void> {
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

  async acquire(options?: Options): Promise<void> {
    const signal = _makeAbortSignal(options);

    signal?.throwIfAborted();

    if (this.permits > 0) {
      this.permits--;
      return;
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

    return promise;
  }

  async acquirePermit(options?: Options): Promise<SemaphorePermit> {
    await this.acquire(options);
    return new DefaultSemaphorePermit(this);
  }

  maybeAcquire(): boolean {
    if (this.permits > 0) {
      this.permits--;
      return true;
    }
    return false;
  }

  maybeAcquirePermit(): SemaphorePermit | undefined {
    if (this.maybeAcquire()) {
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
    await this.acquire(options);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

interface WaitingEntry {
  resolve: () => void;
}
