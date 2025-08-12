import { Queue } from './queue';

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
      const q = Queue<'DONE' | ['ITEM', T] | ['ERROR', unknown]>(bufferSize);
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
              await q.enqueue('DONE');
              break;
            }

            // Enqueue item - this will wait if buffer is full
            await q.enqueue(['ITEM', result.value]);
          }
        } catch (error) {
          await q.enqueue(['ERROR', error]);
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
          const message = await q.dequeue();

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
