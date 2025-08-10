import { CrntError } from './common';

interface WaitingEntry {
  resolve: () => void;
}

export class Semaphore {
  /** current number of active permits */
  private permits: number;
  /** maximum number of permits */
  private readonly maxPermits: number;
  private readonly waiting: Set<WaitingEntry> = new Set();

  /**
   * Creates a new Semaphore with the specified number of permits.
   * @param permits - Maximum number of concurrent operations allowed
   */
  constructor(permits: number) {
    this.permits = permits;
    this.maxPermits = permits;
  }

  /**
   * Acquires a permit. If no permits are available, waits until one becomes available.
   * @param option - Optional configuration including AbortSignal
   * @returns Promise that resolves when a permit is acquired
   * @throws {DOMException} If the operation is aborted via AbortSignal
   */
  async acquire(option?: { signal?: AbortSignal }): Promise<void> {
    const signal = option?.signal;

    signal?.throwIfAborted();

    if (this.permits > 0) {
      this.permits--;
      return;
    }

    const { promise, resolve, reject } = Promise.withResolvers<void>();
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

  /**
   * Attempts to acquire a permit without waiting.
   * @returns true if a permit was successfully acquired, false otherwise
   */
  maybeAcquire(): boolean {
    if (this.permits > 0) {
      this.permits--;
      return true;
    }
    return false;
  }

  /**
   * Releases a permit, making it available for other operations.
   * If there are waiting operations, immediately gives the permit to the next waiter.
   * @throws {CrntError} If releasing would exceed the initial number of permits
   */
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
}
