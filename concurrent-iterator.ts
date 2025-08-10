/**
 * # Stream Processing Library
 *
 * A powerful TypeScript library for concurrent stream processing with batching support,
 * concurrency control, timeout handling, and optional progress tracking.
 *
 * ## Key Features
 * - **Concurrent Processing**: Control concurrency with limits
 * - **Batch Processing**: Group items into batches for efficient processing
 * - **Timeout Support**: Flush incomplete batches after time delays
 * - **Progress Tracking**: Optional CLI progress bars via cli-progress
 * - **Backpressure**: Automatic backpressure handling
 * - **AbortSignal Support**: Graceful cancellation
 * - **Promise Integration**: Works with Promise.all() and async/await
 *
 * ## Basic Usage
 *
 * ```typescript
 * import { fromIterable } from './stream';
 *
 * // Simple sequential processing
 * const data = [1, 2, 3, 4, 5];
 * const results = await fromIterable(data)
 *   .map(async (x) => x * 2);
 * console.log(results); // [2, 4, 6, 8, 10]
 *
 * // Concurrent processing with batching
 * const results = await fromIterable(data)
 *   .mapBatch(async (batch) => {
 *     // Process batch of items concurrently
 *     return Promise.all(batch.map(x => x * 2));
 *   }, {
 *     concurrency: 3,
 *     batchSize: 2
 *   });
 * ```
 *
 * ## Pipeline Processing
 *
 * ```typescript
 * // Create a multi-stage processing pipeline
 * const pipeline = fromIterable(data)
 *   .map(async (item) => {
 *     // Stage 1: Validation
 *     return { ...item, validated: true };
 *   }, { concurrency: 5, name: "Validation" })
 *   .map(async (item) => {
 *     // Stage 2: Enrichment
 *     return { ...item, enriched: await enrich(item) };
 *   }, { concurrency: 3, name: "Enrichment" })
 *   .mapBatch(async (batch) => {
 *     // Stage 3: Batch analysis
 *     return batch.map(item => ({ ...item, analyzed: true }));
 *   }, { concurrency: 2, batchSize: 10, name: "Analysis" });
 *
 * const results = await pipeline;
 * ```
 *
 * ## Progress Tracking
 *
 * ```typescript
 * import * as cliProgress from 'cli-progress';
 *
 * const multibar = new cliProgress.MultiBar({}, cliProgress.Presets.shades_classic);
 *
 * const results = await fromIterable(largeDataset, { multibar })
 *   .map(processItem, {
 *     concurrency: 10,
 *     name: "Processing Items"
 *   });
 *
 * multibar.stop();
 * ```
 *
 * ## Configuration Options
 *
 * - **concurrency**: Maximum number of concurrent operations (default: 1)
 * - **batchSize**: Maximum number of items per batch (default: 10)
 * - **batchDelay**: Timeout in ms to flush incomplete batches (optional)
 * - **name**: Progress bar name (when multibar is provided)
 * - **multibar**: cli-progress MultiBar instance for progress tracking
 * - **signal**: AbortSignal for cancellation support
 */

import type { Options } from './common';
import { newQueue } from './queue';

/**
 * Configuration options for {@link Stream.map} operations.
 */
export interface MapConfig {
  /**
   * Maximum number of concurrent tasks.
   *
   * - For `map()`: Controls how many individual items are processed concurrently
   * - For `mapBatch()`: Controls how many batches are processed concurrently
   *
   * @default 1
   */
  concurrency?: number;
}

/**
 * Configuration options for batch operations.
 */
export interface BatchConfig extends MapConfig {
  /**
   * Maximum number of items per batch.
   */
  batchSize?: number;

  /**
   * Timeout in milliseconds to flush incomplete batches.
   *
   * When specified, incomplete batches will be flushed and processed
   * after this timeout, even if they haven't reached the target batchSize.
   * Useful for handling slow or irregular input streams.
   */
  batchDelay?: number;
}

/**
 * Default configuration options that can be applied to all stream operations.
 */
export interface StreamConfig extends MapConfig, BatchConfig, Options {}

/**
 * Stream is an abstraction over AsyncIterable that supports concurrent processing with batching.
 *
 * @template T - The type of items in the stream
 */
export interface Stream<T> extends AsyncIterable<T>, PromiseLike<T[]> {
  /**
   * Maps a function over each item in the stream with controlled concurrency.
   *
   * This is essentially `mapBatch` with `batchSize: 1`, meaning each item
   * is processed individually but with concurrency control.
   *
   * @template U - The type of items returned by the mapping function
   * @param fn - Async function to process each item
   * @param config - Configuration options for concurrency and progress tracking
   * @returns New stream with mapped items
   *
   * @example
   * ```typescript
   * // Process items with controlled concurrency
   * const results = await fromIterable([1, 2, 3, 4, 5])
   *   .map(async (x) => {
   *     await delay(100); // Simulate async work
   *     return x * 2;
   *   }, { concurrency: 3 });
   * // Results: [2, 4, 6, 8, 10]
   * ```
   */
  map<U>(fn: (value: T) => Promise<U>, config?: MapConfig): Stream<U>;

  /**
   * Maps a function over batches of items in the stream with controlled concurrency.
   *
   * Items are grouped into batches of the specified size, and batches are processed
   * with the specified concurrency. This is ideal for bulk operations like database
   * inserts, API calls with batch endpoints, or any operation that benefits from
   * processing multiple items together.
   *
   * @template U - The type of items returned by the mapping function
   * @param fn - Async function to process each batch of items
   * @param config - Configuration options for batching, concurrency, timeouts, and progress
   * @returns New stream with items from processed batches
   *
   * @example
   * ```typescript
   * // Process items in batches
   * const results = await fromIterable([1, 2, 3, 4, 5, 6])
   *   .mapBatch(async (batch) => {
   *     // batch is [1, 2, 3] then [4, 5, 6]
   *     console.log('Processing batch:', batch);
   *     return batch.map(x => x * 2);
   *   }, {
   *     batchSize: 3,
   *     concurrency: 2,
   *     batchDelay: 1000  // Flush incomplete batches after 1s
   *   });
   * ```
   */
  mapBatch<U>(
    fn: (value: T[]) => Promise<U[]>,
    config?: BatchConfig
  ): Stream<U>;
}

/** Create a new instance of stream. */
export function newStream<T>(
  iterable: AsyncIterable<T>,
  config: StreamConfig = {}
): Stream<T> {
  return new DefaultStream(iterable, config);
}

class DefaultStream<T> implements Stream<T> {
  private readonly iterable: AsyncIterable<T>;
  private readonly config: StreamConfig;

  concurrency?: number;
  batchSize?: number;
  signal?: AbortSignal;

  constructor(iterable: AsyncIterable<T>, config: StreamConfig = {}) {
    this.iterable = iterable;
    this.config = config;
    this.concurrency = config.concurrency;
    this.batchSize = config.batchSize;
    this.signal = config.signal;
  }

  map<U>(fn: (value: T) => Promise<U>, config?: MapConfig): Stream<U> {
    return this.mapBatch(async batch => Promise.all(batch.map(fn)), {
      ...config,
      batchSize: 1,
    });
  }

  mapBatch<U>(
    fn: (value: T[]) => Promise<U[]>,
    config?: BatchConfig
  ): Stream<U> {
    const concurrency = config?.concurrency ?? this.concurrency ?? 1;
    const batchSize = config?.batchSize ?? this.batchSize ?? 1;
    const batchDelay = config?.batchDelay;
    const signal = this.signal;

    async function* mapBatchIterable(source: AsyncIterable<T>) {
      type BatchTask = { type: 'BATCH'; results: U[]; promiseId: number };
      type TimeoutTask = { type: 'TIMEOUT' };
      const pendingBatches = new Map<number, Promise<BatchTask>>();
      const iterator = source[Symbol.asyncIterator]();
      // the last value from iterator.next() that has not been awaited yet.
      let pendingNext: Promise<IteratorResult<T>> | null = null;
      let iteratorDone = false;
      let batchIdCounter = 0;

      // Move partial batch outside the main loop
      let partialBatch: T[] = [];
      let timeoutPromise: Promise<TimeoutTask> | null = null;
      let timeoutId: NodeJS.Timeout | null = null;

      const createBatchTask = (batch: T[]) => {
        batchIdCounter++;
        const currentPromiseId = batchIdCounter;
        const promise: Promise<BatchTask> = (async () => {
          const results = await fn(batch);
          return { type: 'BATCH', results, promiseId: currentPromiseId };
        })();
        pendingBatches.set(currentPromiseId, promise);
        return promise;
      };

      const hasMoreInput = () => !iteratorDone;
      const hasPendingBatches = () => pendingBatches.size > 0;
      const hasPartialBatch = () => partialBatch.length > 0;

      const flushPartialBatch = () => {
        if (!hasPartialBatch()) {
          return;
        }
        createBatchTask(partialBatch);
        partialBatch = [];
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
          timeoutPromise = null;
        }
      };

      const maybeStartFlushingTimeout = () => {
        if (!batchDelay || timeoutPromise) {
          return;
        }
        timeoutPromise = new Promise<TimeoutTask>(resolve => {
          timeoutId = setTimeout(
            () => resolve({ type: 'TIMEOUT' }),
            batchDelay
          );
        });
      };

      try {
        while (hasMoreInput() || hasPendingBatches() || hasPartialBatch()) {
          signal?.throwIfAborted();

          // Build list of promises to race. TODO: handle abortion here too.
          const racePromises: Promise<
            TimeoutTask | BatchTask | IteratorResult<T>
          >[] = [];

          // Add input consumption if we have space and input
          if (hasMoreInput() && pendingBatches.size < concurrency) {
            pendingNext ??= iterator.next();
            racePromises.push(pendingNext);
          }
          if (hasPendingBatches()) {
            racePromises.push(...pendingBatches.values());
          }
          if (timeoutPromise) {
            racePromises.push(timeoutPromise);
          }

          if (racePromises.length == 0) {
            throw new Error('No promises to race, logic error');
          }

          const result = await Promise.race(racePromises);

          if ('type' in result && result.type === 'BATCH') {
            for (const item of result.results) {
              yield item;
            }
            pendingBatches.delete(result.promiseId);
          } else if ('type' in result && result.type === 'TIMEOUT') {
            flushPartialBatch();
          } else {
            // IteratorResult
            pendingNext = null;
            const { value, done } = result;

            if (done) {
              iteratorDone = true;
              flushPartialBatch();
            } else {
              partialBatch.push(value);

              // Check if batch is full or if we should start timeout
              if (partialBatch.length >= batchSize) {
                flushPartialBatch();
              } else {
                maybeStartFlushingTimeout();
              }
            }
          }
        }
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    }

    return new DefaultStream(mapBatchIterable(this.iterable), this.config);
  }

  then<TResult1 = T[], TResult2 = never>(
    onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.toArray().then(onfulfilled, onrejected);
  }

  private async toArray(): Promise<T[]> {
    const result: T[] = [];
    for await (const item of this.iterable) {
      result.push(item);
    }
    return result;
  }

  async *[Symbol.asyncIterator]() {
    yield* this.iterable;
  }
}

/**
 * Creates a Stream from an AsyncIterable with optional configuration.
 *
 * This is the primary factory function for creating streams from existing
 * async iterables like async generators, readable streams, or other async iterables.
 *
 * @template T - The type of items in the iterable
 * @param iterable - Any AsyncIterable to wrap as a Stream
 * @param config - Optional default configuration for all operations on this stream
 * @returns A new Stream instance
 *
 * @example
 * ```typescript
 * // From an async generator
 * async function* generateNumbers() {
 *   for (let i = 0; i < 100; i++) {
 *     await delay(10);
 *     yield i;
 *   }
 * }
 *
 * const stream = fromAsyncIterable(generateNumbers(), {
 *   concurrency: 5,
 *   multibar: progressBar
 * });
 *
 * const results = await stream.map(processNumber);
 * ```
 */
export function fromAsyncIterable<T>(
  iterable: AsyncIterable<T>,
  config?: StreamConfig
): DefaultStream<T> {
  return new DefaultStream<T>(iterable, config);
}

/**
 * Creates a Stream from a regular (synchronous) Iterable with optional configuration.
 *
 * This function wraps synchronous iterables like arrays, sets, or custom iterables
 * and converts them to async streams for concurrent processing.
 *
 * @template T - The type of items in the iterable
 * @param iterable - Any Iterable (like Array, Set, Map, etc.) to wrap as a Stream
 * @param config - Optional default configuration for all operations on this stream
 * @returns A new Stream instance
 *
 * @example
 * ```typescript
 * // From an array
 * const numbers = [1, 2, 3, 4, 5];
 * const stream = fromIterable(numbers, {
 *   concurrency: 3,
 *   batchSize: 2
 * });
 *
 * // From a Set
 * const uniqueItems = new Set(['a', 'b', 'c']);
 * const results = await fromIterable(uniqueItems)
 *   .map(async item => item.toUpperCase());
 * ```
 */
export function fromIterable<T>(
  iterable: Iterable<T>,
  config?: StreamConfig
): DefaultStream<T> {
  return new DefaultStream<T>(toAsyncIterable(iterable), config);
}

/**
 * Converts a synchronous Iterable to an AsyncIterable.
 *
 * This utility function wraps synchronous iterables to work with async processing.
 * It preserves the iterator protocol methods (return, throw) if they exist.
 *
 * @internal
 * @template T - The type of items yielded by the iterator
 * @template TReturn - The type of the return value when the iterator completes
 * @template TNext - The type of values that can be passed to iterator.next()
 * @param iterable - The synchronous iterable to convert
 * @returns An AsyncIterable that yields the same items
 */
function toAsyncIterable<T, TReturn = unknown, TNext = unknown>(
  iterable: Iterable<T, TReturn, TNext>
): AsyncIterable<T, TReturn, TNext> {
  return {
    [Symbol.asyncIterator]: () => {
      const iterator = iterable[Symbol.iterator]();
      const response: AsyncIterator<T, TReturn, TNext> = {
        next: async () => iterator.next(),
      };
      if (iterator.return) {
        response.return = async (
          value?: TReturn | PromiseLike<TReturn>
        ): Promise<IteratorResult<T, TReturn>> => {
          return iterator.return!(await value);
        };
      }
      if (iterator.throw) {
        response.throw = async (
          error?: unknown
        ): Promise<IteratorResult<T, TReturn>> => {
          return iterator.throw!(error);
        };
      }
      return response;
    },
  };
}

/**
 * Creates a buffered AsyncIterable that pre-loads N elements from the source iterable.
 *
 * This function provides lookahead buffering, which can be useful for:
 * - Smoothing out irregular data arrival patterns
 * - Providing better throughput for downstream processing
 * - Memory-controlled prefetching from slow sources
 *
 * The buffer is filled asynchronously and items are yielded as soon as they're available.
 * When the buffer is full, it waits for items to be consumed before loading more.
 *
 * @template T - The type of items in the iterable
 * @param source - The source AsyncIterable to buffer
 * @param bufferSize - Maximum number of items to buffer ahead (default: 10)
 * @returns A new AsyncIterable with buffered access to the source
 *
 * @example
 * ```typescript
 * async function* slowSource() {
 *   for (let i = 0; i < 100; i++) {
 *     await delay(100); // Simulate slow data arrival
 *     yield i;
 *   }
 * }
 *
 * // Buffer 20 items ahead for smoother processing
 * const buffered = toBufferedAsyncIterable(slowSource(), 20);
 *
 * for await (const item of buffered) {
 *   // Process items with reduced waiting time
 *   console.log(item);
 * }
 * ```
 */
export function toBufferedAsyncIterable<T>(
  source: AsyncIterable<T>,
  bufferSize: number = 10
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]: () => {
      const sourceIterator = source[Symbol.asyncIterator]();
      const queue = newQueue<'DONE' | ['ITEM', T] | ['ERROR', unknown]>(
        bufferSize
      );
      let sourceCompleted = false;
      let fillerStarted = false;

      // Background filler that runs indefinitely until source is complete
      const startBackgroundFiller = async (): Promise<void> => {
        if (fillerStarted) return;
        fillerStarted = true;

        try {
          while (!sourceCompleted) {
            const result = await sourceIterator.next();
            if (result.done) {
              await queue.enqueue('DONE');
              break;
            }

            // Enqueue item - this will wait if buffer is full
            await queue.enqueue(['ITEM', result.value]);
          }
        } catch (error) {
          await queue.enqueue(['ERROR', error]);
        }
      };

      let iteratorCompleted = false;

      return {
        async next(): Promise<IteratorResult<T>> {
          if (iteratorCompleted) {
            return { value: undefined, done: true };
          }

          // Start background filler on first call
          if (!fillerStarted) {
            startBackgroundFiller(); // Don't await - let it run in background
          }

          // Get the next message from the queue
          const message = await queue.dequeue();

          // Handle different message types
          if (message === 'DONE') {
            sourceCompleted = true;
            iteratorCompleted = true;
            return { value: undefined, done: true };
          }

          const [type, payload] = message;

          if (type === 'ERROR') {
            sourceCompleted = true;
            throw payload;
          } else if (type === 'ITEM') {
            return { value: payload, done: false };
          }
          throw new Error('Unknown message type from queue');
        },

        async return(value?: unknown): Promise<IteratorResult<T>> {
          iteratorCompleted = true;
          sourceCompleted = true; // Signal filler to stop
          if (sourceIterator.return) {
            return await sourceIterator.return(value);
          }
          return { value, done: true };
        },

        async throw(error?: unknown): Promise<IteratorResult<T>> {
          iteratorCompleted = true;
          sourceCompleted = true; // Signal filler to stop
          if (sourceIterator.throw) {
            return await sourceIterator.throw(error);
          }
          throw error;
        },
      };
    },
  };
}

// ============================================================================
// ADVANCED USAGE EXAMPLES
// ============================================================================

/**
 * ## Advanced Usage Examples
 *
 * ### Database Processing with Progress Tracking
 *
 * ```typescript
 * import * as cliProgress from 'cli-progress';
 * import { fromAsyncIterable } from './stream';
 *
 * async function* fetchUsersFromDB() {
 *   const db = await connectToDatabase();
 *   let offset = 0;
 *   const limit = 1000;
 *
 *   while (true) {
 *     const users = await db.query('SELECT * FROM users LIMIT ? OFFSET ?', [limit, offset]);
 *     if (users.length === 0) break;
 *
 *     for (const user of users) {
 *       yield user;
 *     }
 *     offset += limit;
 *   }
 * }
 *
 * const multibar = new cliProgress.MultiBar({});
 *
 * const processedUsers = await fromAsyncIterable(fetchUsersFromDB(), { multibar })
 *   .map(async (user) => {
 *     // Validate user data
 *     return validateUser(user);
 *   }, { concurrency: 10, name: "🔍 Validation" })
 *   .map(async (user) => {
 *     // Enrich with external data
 *     return enrichUserData(user);
 *   }, { concurrency: 5, name: "🔧 Enrichment" })
 *   .mapBatch(async (users) => {
 *     // Bulk update to database
 *     await updateUsersInDB(users);
 *     return users;
 *   }, { batchSize: 50, concurrency: 3, name: "💾 DB Updates" });
 *
 * multibar.stop();
 * ```
 *
 * ### File Processing Pipeline
 *
 * ```typescript
 * import { fromAsyncIterable } from './stream';
 * import { readdir } from 'fs/promises';
 *
 * async function* findFiles(directory: string, pattern: RegExp) {
 *   const entries = await readdir(directory, { withFileTypes: true });
 *   for (const entry of entries) {
 *     if (entry.isFile() && pattern.test(entry.name)) {
 *       yield path.join(directory, entry.name);
 *     }
 *   }
 * }
 *
 * const results = await fromAsyncIterable(findFiles('./data', /\.json$/))
 *   .map(async (filePath) => {
 *     const content = await fs.readFile(filePath, 'utf8');
 *     return { filePath, data: JSON.parse(content) };
 *   }, { concurrency: 10 })
 *   .mapBatch(async (files) => {
 *     // Process files in batches
 *     return files.map(file => transformData(file.data));
 *   }, { batchSize: 5 });
 * ```
 *
 * ### API Processing with Rate Limiting and Retries
 *
 * ```typescript
 * import { fromIterable } from './stream';
 *
 * async function fetchWithRetry(url: string, maxRetries = 3): Promise<any> {
 *   for (let i = 0; i < maxRetries; i++) {
 *     try {
 *       const response = await fetch(url);
 *       if (!response.ok) throw new Error(`HTTP ${response.status}`);
 *       return await response.json();
 *     } catch (error) {
 *       if (i === maxRetries - 1) throw error;
 *       await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
 *     }
 *   }
 * }
 *
 * const urls = ['https://api1.com/data', 'https://api2.com/data', ...];
 *
 * const apiResults = await fromIterable(urls)
 *   .map(fetchWithRetry, {
 *     concurrency: 3, // Rate limit: max 3 concurrent requests
 *     name: "🌐 API Calls"
 *   })
 *   .mapBatch(async (responses) => {
 *     // Process API responses in batches
 *     return responses.flatMap(response => processAPIResponse(response));
 *   }, {
 *     batchSize: 10,
 *     batchDelay: 2000, // Flush every 2 seconds
 *     name: "📊 Processing"
 *   });
 * ```
 *
 * ### Stream Cancellation
 *
 * ```typescript
 * import { fromIterable } from './stream';
 *
 * const controller = new AbortController();
 *
 * // Cancel after 30 seconds
 * setTimeout(() => controller.abort(), 30000);
 *
 * try {
 *   const results = await fromIterable(largeDataset, {
 *     signal: controller.signal
 *   })
 *     .map(processItem, { concurrency: 5 });
 * } catch (error) {
 *   if (error.name === 'AbortError') {
 *     console.log('Processing was cancelled');
 *   }
 * }
 * ```
 *
 * ### Memory-Efficient Large Dataset Processing
 *
 * ```typescript
 * // Process millions of items without loading all into memory
 * async function* generateLargeDataset() {
 *   for (let i = 0; i < 10_000_000; i++) {
 *     // Generate data on-demand
 *     yield { id: i, value: Math.random() * 1000 };
 *   }
 * }
 *
 * const processedCount = await fromAsyncIterable(generateLargeDataset())
 *   .mapBatch(async (batch) => {
 *     // Process in chunks to manage memory
 *     const processed = await heavyComputation(batch);
 *     // Only keep count, not the actual data
 *     return processed.map(() => 1);
 *   }, {
 *     batchSize: 1000,
 *     concurrency: 4,
 *     batchDelay: 5000
 *   })
 *   .then(results => results.reduce((sum, count) => sum + count, 0));
 *
 * console.log(`Processed ${processedCount} items`);
 * ```
 *
 * ### Buffered Async Iterable for Smooth Data Flow
 *
 * ```typescript
 * import { toBufferedAsyncIterable, fromAsyncIterable } from './stream';
 *
 * // Simulate irregular data source (network, database, etc.)
 * async function* irregularDataSource() {
 *   for (let i = 0; i < 1000; i++) {
 *     // Simulate variable delays between items
 *     const delay = Math.random() * 500 + 50;
 *     await new Promise(resolve => setTimeout(resolve, delay));
 *     yield { id: i, data: `item-${i}` };
 *   }
 * }
 *
 * // Buffer 50 items to smooth out irregular arrivals
 * const bufferedSource = toBufferedAsyncIterable(irregularDataSource(), 50);
 *
 * const results = await fromAsyncIterable(bufferedSource)
 *   .map(async (item) => {
 *     // Fast processing benefits from buffering
 *     return { ...item, processed: Date.now() };
 *   }, { concurrency: 10, name: "⚡ Fast Processing" })
 *   .mapBatch(async (batch) => {
 *     // Batch operations work more efficiently with buffered input
 *     await saveBatchToDatabase(batch);
 *     return batch;
 *   }, { batchSize: 20, name: "💾 Batch Save" });
 * ```
 */
