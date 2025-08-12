import { _makeAbortSignal, type Options, QueueClosedError } from './common';
import { CrntError } from './dist';

/**
 * An asynchronous queue. This is modelled after:
 *
 * - Go's channels.
 * - Java's `ConcurrentLinkedQueue`
 *
 * Supported operations:
 * - Promise-based `enqueue` and `dequeue` operations
 * - synchronous `maybeEnqueue` and `maybeDequeue` operations
 * - `AsyncIterable` to drain the queue.
 * - closing the queue, preventing further enqueue operations but allowing dequeue until exhausted.
 * - the queue is unbounded by default but it can be initialized with a finite capacity, including 0. in this case, it behaves like Java's SynchronousQueue / Unbuffered Go Channel.
 *
 * @example
 * ```typescript
 * import { newQueue } from 'crnt';
 *
 * // Create a bounded queue
 * const queue = newQueue<string>(2);
 *
 * // Producer
 * await queue.enqueue('hello');
 * await queue.enqueue('world');
 *
 * // Consumer using async iteration
 * for await (const item of queue) {
 *   console.log(item); // 'hello', 'world'
 *   if (item === 'world') break;
 * }
 * ```
 *
 * @category Data Structure
 * @summary Concurrent queue data structure.
 */
export interface Queue<T> extends AsyncIterable<T> {
  /** asynchronously enqueue an item, waiting until space becomes available, or throw if aborted */
  enqueue(item: T, options?: Options): Promise<void>;
  /** asynchronously dequeue an item, waiting until an item becomes available, or throw if aborted */
  dequeue(options?: Options): Promise<T>;
  /** synchronously enqueue an item if there is space, or return false */
  maybeEnqueue(item: T): boolean;
  /** synchronously dequeue an item if there is one, or return false */
  maybeDequeue(): [T, true] | [undefined, false];
  /** Returns the copy of the current items in the queue, in the first-in-first-out (FIFO) order. This is mostly useful for debugging. */
  toArray(): T[];
  /** close the queue, preventing further enqueue operations but allowing dequeue until exhausted */
  close(): void;
  /** the number of items in the queue */
  readonly size: number;
  /** the maximum number of items the queue can hold, infinity if unbounded. */
  readonly capacity: number;
  /** whether the queue is closed */
  readonly closed: boolean;
}

/**
 * Creates a new {@link Queue} with the given capacity.
 *
 * @param capacity - The maximum number of items the queue can hold. Defaults to Infinity.
 * @returns A new {@link Queue} instance.
 * @category Data Structure
 */
export function newQueue<T>(capacity: number = Infinity): Queue<T> {
  if (capacity < 0) {
    throw new CrntError('Capacity must be non-negative');
  }
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
  #closed: boolean = false;

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
    if (this.#closed) {
      return false;
    }

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

  /**
   * note: this method (and {@link dequeue}) is implemented without "async" to ensure that task scheduling does not occur.
   */
  enqueue(item: T, options?: Options): Promise<void> {
    const signal = _makeAbortSignal(options);
    signal?.throwIfAborted();

    if (this.#closed) {
      throw new QueueClosedError();
    }

    // Try immediate handoff first (works for both zero-capacity and regular queues)
    if (this.maybeEnqueue(item)) {
      return Promise.resolve();
    }

    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const waitingEntry: EnqueueWaitingEntry<T> = { resolve, reject, item };
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

  dequeue(options?: Options): Promise<T> {
    const signal = _makeAbortSignal(options);
    signal?.throwIfAborted();

    // Try immediate handoff first (works for both zero-capacity and regular queues)
    const maybeResult = this.maybeDequeue();
    if (maybeResult[1]) {
      return Promise.resolve(maybeResult[0]!);
    }

    // If queue is closed and empty, throw QueueClosedError
    if (this.#closed && this.#size === 0 && this.#waitingEnqueue.size === 0) {
      throw new QueueClosedError('Queue is closed and empty');
    }

    const { promise, resolve, reject } = Promise.withResolvers<T>();
    const waitingEntry: DequeueWaitingEntry<T> = { resolve, reject };
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

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;

    // Reject all waiting enqueue operations
    for (const entry of this.#waitingEnqueue) {
      entry.reject(new QueueClosedError());
    }
    this.#waitingEnqueue.clear();

    // If queue is empty, reject all waiting dequeue operations
    if (this.#size === 0) {
      for (const entry of this.#waitingDequeue) {
        entry.reject(new QueueClosedError('Queue is closed and empty'));
      }
      this.#waitingDequeue.clear();
    }
  }

  get closed(): boolean {
    return this.#closed;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    const ctrl = new AbortController();
    try {
      while (true) {
        yield await this.dequeue({ signal: ctrl.signal });
      }
    } catch (error) {
      if (error instanceof QueueClosedError) {
        return;
      }
      throw error;
    } finally {
      ctrl.abort();
    }
  }
}

interface EnqueueWaitingEntry<T> {
  resolve: () => void;
  reject: (reason?: unknown) => void;
  item: T;
}

interface DequeueWaitingEntry<T> {
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
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
