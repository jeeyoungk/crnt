import { type AbortOptions } from './common';

export interface Queue<T> {
  /** asynchronously enqueue an item, waiting until space becomes available, or throw if aborted */
  enqueue(item: T, options?: AbortOptions): Promise<void>;
  /** asynchronously dequeue an item, waiting until an item becomes available, or throw if aborted */
  dequeue(options?: AbortOptions): Promise<T>;
  /** synchronously enqueue an item if there is space, or return false */
  maybeEnqueue(item: T): boolean;
  /** synchronously dequeue an item if there is one, or return false */
  maybeDequeue(): [T, true] | [undefined, false];
  /** the number of items in the queue */
  readonly size: number;
  /** the maximum number of items the queue can hold */
  readonly capacity: number;
}

export function newQueue<T>(capacity: number = Infinity): Queue<T> {
  return new DefaultQueue<T>(capacity);
}

export class DefaultQueue<T> implements Queue<T> {
  private readonly items: T[] = [];
  readonly capacity: number;
  private readonly waitingEnqueue: Set<EnqueueWaitingEntry<T>> = new Set();
  private readonly waitingDequeue: Set<DequeueWaitingEntry<T>> = new Set();

  /**
   * Creates a new Queue with the specified capacity.
   * @param capacity - Maximum number of items the queue can hold.
   *                   Use 0 for a zero-capacity queue (rendezvous point)
   */
  constructor(capacity: number = Infinity) {
    this.capacity = capacity;
  }

  /**
   * Attempts to enqueue an item without waiting.
   * @param item - The item to enqueue
   * @returns true if the item was successfully enqueued, false if the queue is full
   */
  maybeEnqueue(item: T): boolean {
    // Zero-capacity queue: only succeed if there's a waiting dequeuer
    if (this.capacity === 0) {
      if (this.waitingDequeue.size > 0) {
        const next = this.waitingDequeue.values().next().value;
        next!.resolve(item);
        this.waitingDequeue.delete(next!);
        return true;
      }
      return false;
    }

    // Regular capacity queue
    if (this.items.length >= this.capacity) {
      return false;
    }

    this.items.push(item);

    // If there are waiters for dequeue, wake one up
    while (this.waitingDequeue.size > 0 && this.items.length > 0) {
      const next = this.waitingDequeue.values().next().value;
      const dequeuedItem = this.items.shift()!;
      next!.resolve(dequeuedItem);
      this.waitingDequeue.delete(next!);
    }

    return true;
  }

  /**
   * Attempts to dequeue an item without waiting.
   * @returns Tuple of [item, true] if successful, [undefined, false] if queue is empty
   */
  maybeDequeue(): [T, true] | [undefined, false] {
    // Zero-capacity queue: only succeed if there's a waiting enqueuer
    if (this.capacity === 0) {
      if (this.waitingEnqueue.size > 0) {
        const next = this.waitingEnqueue.values().next().value;
        const item = next!.item;
        next!.resolve();
        this.waitingEnqueue.delete(next!);
        return [item, true];
      }
      return [undefined, false];
    }

    // Regular capacity queue
    if (this.items.length === 0) {
      return [undefined, false];
    }

    const item = this.items.shift()!;

    // If there are waiters for enqueue, wake one up and enqueue their item
    while (this.waitingEnqueue.size > 0 && this.items.length < this.capacity) {
      const next = this.waitingEnqueue.values().next().value;
      this.items.push(next!.item);
      next!.resolve();
      this.waitingEnqueue.delete(next!);
    }

    return [item, true];
  }

  /**
   * Enqueues an item. If the queue is full, waits until space becomes available.
   * For zero-capacity queues, waits until a dequeuer becomes available.
   * @param item - The item to enqueue
   * @param options - Optional configuration including AbortSignal
   * @throws {DOMException} If the operation is aborted via AbortSignal
   */
  async enqueue(item: T, options?: AbortOptions): Promise<void> {
    const signal = options?.signal;
    signal?.throwIfAborted();

    // Try immediate handoff first (works for both zero-capacity and regular queues)
    if (this.maybeEnqueue(item)) {
      return;
    }

    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const waitingEntry: EnqueueWaitingEntry<T> = { resolve, item };
    this.waitingEnqueue.add(waitingEntry);

    if (signal) {
      const onAbort = () => {
        this.waitingEnqueue.delete(waitingEntry);
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
   * Dequeues an item. If the queue is empty, waits until an item becomes available.
   * For zero-capacity queues, waits until an enqueuer becomes available.
   * @param options - Optional configuration including AbortSignal
   * @returns Promise that resolves to the dequeued item
   * @throws {DOMException} If the operation is aborted via AbortSignal
   */
  async dequeue(options?: AbortOptions): Promise<T> {
    const signal = options?.signal;
    signal?.throwIfAborted();

    // Try immediate handoff first (works for both zero-capacity and regular queues)
    const maybeResult = this.maybeDequeue();
    if (maybeResult[1]) {
      return maybeResult[0];
    }

    const { promise, resolve, reject } = Promise.withResolvers<T>();
    const waitingEntry: DequeueWaitingEntry<T> = { resolve };
    this.waitingDequeue.add(waitingEntry);

    if (signal) {
      const onAbort = () => {
        this.waitingDequeue.delete(waitingEntry);
        reject(signal.reason);
      };

      signal.addEventListener('abort', onAbort, { once: true });

      // Clean up the abort listener if we resolve normally
      const originalResolve = waitingEntry.resolve;
      waitingEntry.resolve = (item: T) => {
        signal.removeEventListener('abort', onAbort);
        originalResolve(item);
      };
    }

    return promise;
  }

  /**
   * Returns the current number of items in the queue.
   * For zero-capacity queues, always returns 0.
   * @returns The number of items currently in the queue
   */
  get size(): number {
    return this.capacity === 0 ? 0 : this.items.length;
  }
}

interface EnqueueWaitingEntry<T> {
  resolve: () => void;
  item: T;
}

interface DequeueWaitingEntry<T> {
  resolve: (value: T) => void;
}
