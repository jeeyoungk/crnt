import { _makeAbortSignal, type Options } from './common';

/**
 * @category Data Structure
 * @summary Concurrent queue data structure.
 */
export interface Queue<T> {
  /** asynchronously enqueue an item, waiting until space becomes available, or throw if aborted */
  enqueue(item: T, options?: Options): Promise<void>;
  /** asynchronously dequeue an item, waiting until an item becomes available, or throw if aborted */
  dequeue(options?: Options): Promise<T>;
  /** synchronously enqueue an item if there is space, or return false */
  maybeEnqueue(item: T): boolean;
  /** synchronously dequeue an item if there is one, or return false */
  maybeDequeue(): [T, true] | [undefined, false];
  /** the number of items in the queue */
  readonly size: number;
  /** the maximum number of items the queue can hold */
  readonly capacity: number;
  /** Returns the copy of the current items in the queue, in the first-in-first-out (FIFO) order. */
  toArray(): T[];
}

/**
 * Creates a new {@link Queue} with the given capacity.
 *
 * @param capacity - The maximum number of items the queue can hold. Defaults to Infinity.
 * @returns A new {@link Queue} instance.
 * @category Data Structure
 */
export function newQueue<T>(capacity: number = Infinity): Queue<T> {
  return new DefaultQueue<T>(capacity);
}

export class DefaultQueue<T> implements Queue<T> {
  #buffer: (T | undefined)[];
  #head: number = 0;
  #tail: number = 0;
  #size: number = 0;
  #capacity: number;
  #waitingEnqueue: Set<EnqueueWaitingEntry<T>> = new Set();
  #waitingDequeue: Set<DequeueWaitingEntry<T>> = new Set();

  constructor(capacity: number = Infinity) {
    this.#capacity = capacity;
    // For infinite capacity, start with a reasonable buffer size that grows as needed
    const initialBufferSize = capacity === Infinity ? 16 : capacity;
    this.#buffer = new Array(initialBufferSize);
  }

  #expandBuffer(): void {
    if (this.#capacity !== Infinity) {
      throw new Error('Cannot expand buffer for finite capacity queue');
    }

    const oldBuffer = this.#buffer;
    const newSize = oldBuffer.length * 2;
    this.#buffer = new Array(newSize);

    // Copy items from old buffer to new buffer starting at index 0
    for (let i = 0; i < this.#size; i++) {
      this.#buffer[i] = oldBuffer[(this.#head + i) % oldBuffer.length];
    }

    this.#head = 0;
    this.#tail = this.#size;
  }

  #internalEnqueue(item: T): void {
    // Check if we need to expand (only for infinite capacity)
    if (this.#size === this.#buffer.length && this.#capacity === Infinity) {
      this.#expandBuffer();
    }

    this.#buffer[this.#tail] = item;
    this.#tail = (this.#tail + 1) % this.#buffer.length;
    this.#size++;
  }

  private internalDequeue(): T {
    const item = this.#buffer[this.#head]!;
    this.#buffer[this.#head] = undefined; // Help GC
    this.#head = (this.#head + 1) % this.#buffer.length;
    this.#size--;
    return item;
  }

  maybeEnqueue(item: T): boolean {
    // Zero-capacity queue: only succeed if there's a waiting dequeuer
    if (this.#capacity === 0) {
      if (this.#waitingDequeue.size > 0) {
        const next = this.#waitingDequeue.values().next().value;
        next!.resolve(item);
        this.#waitingDequeue.delete(next!);
        return true;
      }
      return false;
    }

    // Regular capacity queue
    if (this.#size >= this.#capacity) {
      return false;
    }

    this.#internalEnqueue(item);

    // If there are waiters for dequeue, wake one up
    while (this.#waitingDequeue.size > 0 && this.#size > 0) {
      const next = this.#waitingDequeue.values().next().value;
      const dequeuedItem = this.internalDequeue();
      next!.resolve(dequeuedItem);
      this.#waitingDequeue.delete(next!);
    }

    return true;
  }

  maybeDequeue(): [T, true] | [undefined, false] {
    // Zero-capacity queue: only succeed if there's a waiting enqueuer
    if (this.#capacity === 0) {
      if (this.#waitingEnqueue.size > 0) {
        const next = this.#waitingEnqueue.values().next().value;
        const item = next!.item;
        next!.resolve();
        this.#waitingEnqueue.delete(next!);
        return [item, true];
      }
      return [undefined, false];
    }

    // Regular capacity queue
    if (this.#size === 0) {
      return [undefined, false];
    }

    const item = this.internalDequeue();

    // If there are waiters for enqueue, wake one up and enqueue their item
    while (this.#waitingEnqueue.size > 0 && this.#size < this.#capacity) {
      const next = this.#waitingEnqueue.values().next().value;
      this.#internalEnqueue(next!.item);
      next!.resolve();
      this.#waitingEnqueue.delete(next!);
    }

    return [item, true];
  }

  async enqueue(item: T, options?: Options): Promise<void> {
    const signal = _makeAbortSignal(options);
    signal?.throwIfAborted();

    // Try immediate handoff first (works for both zero-capacity and regular queues)
    if (this.maybeEnqueue(item)) {
      return;
    }

    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const waitingEntry: EnqueueWaitingEntry<T> = { resolve, item };
    this.#waitingEnqueue.add(waitingEntry);

    if (signal) {
      const onAbort = () => {
        this.#waitingEnqueue.delete(waitingEntry);
        reject(signal.reason);
      };

      _addSignalListener(signal, onAbort, waitingEntry);
    }

    return promise;
  }

  async dequeue(options?: Options): Promise<T> {
    const signal = _makeAbortSignal(options);
    signal?.throwIfAborted();

    // Try immediate handoff first (works for both zero-capacity and regular queues)
    const maybeResult = this.maybeDequeue();
    if (maybeResult[1]) {
      return maybeResult[0];
    }

    const { promise, resolve, reject } = Promise.withResolvers<T>();
    const waitingEntry: DequeueWaitingEntry<T> = { resolve };
    this.#waitingDequeue.add(waitingEntry);

    if (signal) {
      const onAbort = () => {
        this.#waitingDequeue.delete(waitingEntry);
        reject(signal.reason);
      };
      _addSignalListener(signal, onAbort, waitingEntry);
    }

    return promise;
  }

  get size(): number {
    return this.#capacity === 0 ? 0 : this.#size;
  }

  get capacity(): number {
    return this.#capacity;
  }

  toArray(): T[] {
    if (this.#capacity === 0 || this.#size === 0) {
      return [];
    }

    const result: T[] = [];
    for (let i = 0; i < this.#size; i++) {
      const index = (this.#head + i) % this.#buffer.length;
      result.push(this.#buffer[index]!);
    }
    return result;
  }
}

interface EnqueueWaitingEntry<T> {
  resolve: () => void;
  item: T;
}

interface DequeueWaitingEntry<T> {
  resolve: (value: T) => void;
}

function _addSignalListener<T>(
  signal: AbortSignal,
  onAbort: () => void,
  entry: { resolve: (value: T) => void }
): void {
  signal.addEventListener('abort', onAbort, { once: true });

  // Clean up the abort listener if we resolve normally
  const originalResolve = entry.resolve;
  entry.resolve = (item: T) => {
    signal.removeEventListener('abort', onAbort);
    originalResolve(item);
  };
}
