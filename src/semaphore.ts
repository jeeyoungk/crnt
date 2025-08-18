import { _makeAbortSignal, CrntError, type Options } from './common';
import { disposeSymbol } from './polyfill-explicit-resource-management';
import { withResolvers } from './test-helpers';
import { BinaryHeap, type Heap } from './heap';

/**
 * Result of a {@link Semaphore.acquire} operation. This is a {@link Disposable} that can be released when no longer needed.
 *
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
  acquire(options?: AcquireOptions): Promise<SemaphorePermit>;
  /** synchronously acquire a permit if one is available, otherwise return undefined */
  maybeAcquire(): SemaphorePermit | undefined;
  /** release a permit, making it available for other operations */
  release(): void;
  /** run a function with a semaphore, acquiring a permit before running and releasing it after */
  run<T>(fn: () => Promise<T>, options?: AcquireOptions): Promise<T>;
}

/**
 * @inline
 */
interface AcquireOptions extends Options {
  /**
   * If provided, the acquire operation will be given priority over other operations.
   *
   * The default priority is 0.
   */
  priority?: number;
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
  #semaphore: DefaultSemaphore;
  #released = false;

  constructor(semaphore: DefaultSemaphore) {
    this.#semaphore = semaphore;
  }

  [disposeSymbol](): void {
    this.release();
  }

  release(): void {
    if (this.#released) {
      return;
    }
    this.#released = true;
    this.#semaphore.release();
  }
}

export class DefaultSemaphore implements Semaphore {
  /** current number of active permits */
  #permits: number;
  /** maximum number of permits */
  readonly #maxPermits: number;
  readonly #waiting: Heap<WaitingEntry> = new BinaryHeap(
    (a: WaitingEntry, b: WaitingEntry) => {
      // Compare priority first, then sequence for FIFO within same priority
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.sequence - b.sequence;
    }
  );
  #counter = 0;

  constructor(permits: number) {
    this.#permits = permits;
    this.#maxPermits = permits;
  }

  async acquire(options?: AcquireOptions): Promise<SemaphorePermit> {
    const signal = _makeAbortSignal(options);

    signal?.throwIfAborted();

    if (this.#permits > 0) {
      this.#permits--;
      return new DefaultSemaphorePermit(this);
    }

    const { promise, resolve, reject } = withResolvers<void>();
    const priority = options?.priority ?? 0;
    const sequence = this.#counter++;
    const waitingEntry: WaitingEntry = {
      resolve,
      priority,
      sequence,
      aborted: false,
    };
    this.#waiting.insert(waitingEntry);

    if (signal) {
      const onAbort = () => {
        waitingEntry.aborted = true;
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
    if (this.#permits > 0) {
      this.#permits--;
      return new DefaultSemaphorePermit(this);
    }
    return undefined;
  }

  release(): void {
    // Keep extracting until we find a non-aborted entry or the heap is empty
    while (this.#waiting.size > 0) {
      const next = this.#waiting.pop();
      if (next && !next.aborted) {
        next.resolve();
        return;
      }
    }

    // No waiting entries, increment permits
    if (this.#permits >= this.#maxPermits) {
      throw new CrntError(
        `Cannot release permit: would exceed initial permit count of ${this.#maxPermits}`
      );
    }
    this.#permits++;
  }

  async run<T>(fn: () => Promise<T>, options?: AcquireOptions): Promise<T> {
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
  priority: number;
  sequence: number;
  aborted: boolean;
}
