import { test, expect, describe } from 'bun:test';
import {
  newStream,
  fromIterable,
  fromAsyncIterable,
  DefaultStream,
} from './stream';

// Helper function to create an async iterable from an array with optional delays
async function* createAsyncIterable<T>(
  items: T[],
  delayMs: number = 0
): AsyncIterable<T> {
  for (const item of items) {
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    yield item;
  }
}

// Helper function to collect all items from an async iterable
async function collectAll<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of iterable) {
    results.push(item);
  }
  return results;
}

describe('Stream', () => {
  describe('newStream', () => {
    test('creates a stream from async iterable', async () => {
      const source = createAsyncIterable([1, 2, 3]);
      const stream = newStream(source);
      expect(stream).toBeInstanceOf(DefaultStream);

      const results = await collectAll(stream);
      expect(results).toEqual([1, 2, 3]);
    });

    test('accepts configuration', async () => {
      const source = createAsyncIterable([1, 2, 3]);
      const stream = newStream(source, { concurrency: 5, batchSize: 2 });

      const results = await collectAll(stream);
      expect(results).toEqual([1, 2, 3]);
    });
  });

  describe('fromIterable', () => {
    test('creates stream from array', async () => {
      const stream = fromIterable([1, 2, 3, 4, 5]);
      const results = await collectAll(stream);
      expect(results).toEqual([1, 2, 3, 4, 5]);
    });

    test('creates stream from Set', async () => {
      const set = new Set(['a', 'b', 'c']);
      const stream = fromIterable(set);
      const results = await collectAll(stream);
      expect(results).toEqual(['a', 'b', 'c']);
    });

    test('works with empty array', async () => {
      const stream = fromIterable([]);
      const results = await collectAll(stream);
      expect(results).toEqual([]);
    });

    test('accepts configuration', async () => {
      const stream = fromIterable([1, 2, 3], { concurrency: 2, batchSize: 1 });
      const results = await collectAll(stream);
      expect(results).toEqual([1, 2, 3]);
    });
  });

  describe('fromAsyncIterable', () => {
    test('creates stream from async generator', async () => {
      async function* gen() {
        yield 1;
        yield 2;
        yield 3;
      }

      const stream = fromAsyncIterable(gen());
      const results = await collectAll(stream);
      expect(results).toEqual([1, 2, 3]);
    });

    test('preserves order with delays', async () => {
      const stream = fromAsyncIterable(
        createAsyncIterable([1, 2, 3, 4, 5], 10)
      );
      const results = await collectAll(stream);
      expect(results).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('map', () => {
    test('maps over items sequentially', async () => {
      const stream = fromIterable([1, 2, 3, 4, 5]);
      const results = await stream.map(async x => x * 2);
      expect(results).toEqual([2, 4, 6, 8, 10]);
    });

    test('maps with concurrency', async () => {
      const stream = fromIterable([1, 2, 3, 4, 5]);
      const results = await stream.map(
        async x => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return x * 2;
        },
        { concurrency: 3 }
      );
      expect(results).toEqual([2, 4, 6, 8, 10]);
    });

    test('processes items with concurrency', async () => {
      const stream = fromIterable([1, 2, 3, 4, 5]);
      const startTime = Date.now();
      const results = await stream.map(
        async x => {
          await new Promise(resolve => setTimeout(resolve, 20));
          return x * 2;
        },
        { concurrency: 5 }
      );
      const endTime = Date.now();

      // Results should contain all transformed items (order may vary due to concurrency)
      expect(results.sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10]);
      // With concurrency=5, all items should process in parallel, so total time should be ~20ms, not 100ms
      expect(endTime - startTime).toBeLessThan(50);
    });

    test('handles async errors', async () => {
      const stream = fromIterable([1, 2, 3]);
      const mappedStream = stream.map(async x => {
        if (x === 2) throw new Error('Test error');
        return x * 2;
      });
      await expect(mappedStream.toArray()).rejects.toThrow('Test error');
    });

    test('works with empty stream', async () => {
      const stream = fromIterable([]);
      const results = await stream.map(async x => x * 2);
      expect(results).toEqual([]);
    });
  });

  describe('mapBatch', () => {
    test('processes items in batches', async () => {
      const stream = fromIterable([1, 2, 3, 4, 5, 6]);
      const batches: number[][] = [];

      const results = await stream.mapBatch(
        async batch => {
          batches.push([...batch]);
          return batch.map(x => x * 2);
        },
        { batchSize: 2 }
      );

      expect(results).toEqual([2, 4, 6, 8, 10, 12]);
      expect(batches).toEqual([
        [1, 2],
        [3, 4],
        [5, 6],
      ]);
    });

    test('handles incomplete final batch', async () => {
      const stream = fromIterable([1, 2, 3, 4, 5]);
      const batches: number[][] = [];

      const results = await stream.mapBatch(
        async batch => {
          batches.push([...batch]);
          return batch.map(x => x * 2);
        },
        { batchSize: 2 }
      );

      expect(results).toEqual([2, 4, 6, 8, 10]);
      expect(batches).toEqual([[1, 2], [3, 4], [5]]);
    });

    test('processes batches concurrently', async () => {
      const stream = fromIterable([1, 2, 3, 4, 5, 6]);
      const processingTimes: number[] = [];

      const results = await stream.mapBatch(
        async batch => {
          const start = Date.now();
          await new Promise(resolve => setTimeout(resolve, 50));
          processingTimes.push(Date.now() - start);
          return batch.map(x => x * 2);
        },
        { batchSize: 2, concurrency: 2 }
      );

      expect(results).toEqual([2, 4, 6, 8, 10, 12]);
      expect(processingTimes.length).toBe(3); // 3 batches
    });

    test('handles batch processing errors', async () => {
      const stream = fromIterable([1, 2, 3, 4]);

      const batchedStream = stream.mapBatch(
        async batch => {
          if (batch.includes(3)) throw new Error('Batch error');
          return batch.map(x => x * 2);
        },
        { batchSize: 2 }
      );
      await expect(batchedStream.toArray()).rejects.toThrow('Batch error');
    });

    test('works with single item batches', async () => {
      const stream = fromIterable([1, 2, 3]);
      const results = await stream.mapBatch(
        async batch => batch.map(x => x * 2),
        { batchSize: 1 }
      );
      expect(results).toEqual([2, 4, 6]);
    });

    test('works with batch size larger than input', async () => {
      const stream = fromIterable([1, 2, 3]);
      const batches: number[][] = [];

      const results = await stream.mapBatch(
        async batch => {
          batches.push([...batch]);
          return batch.map(x => x * 2);
        },
        { batchSize: 10 }
      );

      expect(results).toEqual([2, 4, 6]);
      expect(batches).toEqual([[1, 2, 3]]);
    });

    test('handles empty batches gracefully', async () => {
      const stream = fromIterable([]);
      const results = await stream.mapBatch(
        async batch => batch.map(x => x * 2),
        { batchSize: 2 }
      );
      expect(results).toEqual([]);
    });
  });

  describe('chaining operations', () => {
    test('chains map operations', async () => {
      const stream = fromIterable([1, 2, 3, 4, 5]);
      const results = await stream.map(async x => x * 2).map(async x => x + 1);

      expect(results).toEqual([3, 5, 7, 9, 11]);
    });

    test('chains map and mapBatch', async () => {
      const stream = fromIterable([1, 2, 3, 4]);
      const results = await stream
        .map(async x => x * 2)
        .mapBatch(async batch => batch.map(x => x + 1), { batchSize: 2 });

      expect(results).toEqual([3, 5, 7, 9]);
    });

    test('preserves configuration through chains', async () => {
      const stream = fromIterable([1, 2, 3, 4, 5], { concurrency: 2 });
      const results = await stream
        .map(async x => x * 2, { concurrency: 3 }) // Override concurrency
        .map(async x => x + 1); // Should use stream's default concurrency

      expect(results).toEqual([3, 5, 7, 9, 11]);
    });
  });

  describe('Promise integration', () => {
    test('can be awaited directly', async () => {
      const stream = fromIterable([1, 2, 3]);
      const results = await stream;
      expect(results).toEqual([1, 2, 3]);
    });

    test('then method works', async () => {
      const stream = fromIterable([1, 2, 3]);
      const results = await stream.then(arr => arr.map(x => x * 2));
      expect(results).toEqual([2, 4, 6]);
    });

    test('catch method works', async () => {
      const stream = fromIterable([1, 2, 3]).map(async x => {
        if (x === 2) throw new Error('Test error');
        return x;
      });

      await expect(stream.then(x => x)).rejects.toThrow('Test error');
    });
  });

  describe('async iteration', () => {
    test('can be used with for-await-of', async () => {
      const stream = fromIterable([1, 2, 3, 4, 5]);
      const results: number[] = [];

      for await (const item of stream) {
        results.push(item);
      }

      expect(results).toEqual([1, 2, 3, 4, 5]);
    });

    test('async iteration works with transformed stream', async () => {
      const stream = fromIterable([1, 2, 3]).map(async x => x * 2);
      const results: number[] = [];

      for await (const item of stream) {
        results.push(item);
      }

      expect(results).toEqual([2, 4, 6]);
    });
  });

  describe('preserveOrder', () => {
    test('map preserves order when preserveOrder=true', async () => {
      const stream = fromIterable([1, 2, 3, 4, 5]);

      // Use variable delays to make items complete out of order naturally
      const results = await stream.map(
        async x => {
          // Item 1 takes longest, item 5 takes shortest
          const delay = (6 - x) * 10;
          await new Promise(resolve => setTimeout(resolve, delay));
          return x * 10;
        },
        { concurrency: 5, preserveOrder: true }
      );

      // Results should be in original order despite processing times
      expect(results).toEqual([10, 20, 30, 40, 50]);
    });

    test('map does not preserve order when preserveOrder=false', async () => {
      // Simple test with only 2 items and extreme delay difference
      const unorderedResults = await fromIterable([1, 2]).map(
        async x => {
          // First item takes much longer than second
          const delay = x === 1 ? 200 : 10;
          await new Promise(resolve => setTimeout(resolve, delay));
          return x;
        },
        { concurrency: 2, preserveOrder: false }
      );

      // With preserveOrder=false, second item should finish first
      expect(unorderedResults).toEqual([2, 1]);

      const orderedResults = await fromIterable([1, 2]).map(
        async x => {
          // Same delays
          const delay = x === 1 ? 200 : 10;
          await new Promise(resolve => setTimeout(resolve, delay));
          return x;
        },
        { concurrency: 2, preserveOrder: true }
      );

      // With preserveOrder=true, should maintain original order
      expect(orderedResults).toEqual([1, 2]);
    });

    test('mapBatch preserves order when preserveOrder=true', async () => {
      const stream = fromIterable([1, 2, 3, 4, 5, 6]);

      const results = await stream.mapBatch(
        async batch => {
          // First batch takes longer than second batch
          const delay = batch.includes(1) ? 50 : 10;
          await new Promise(resolve => setTimeout(resolve, delay));
          return batch.map(x => x * 10);
        },
        { batchSize: 3, concurrency: 2, preserveOrder: true }
      );

      // Results should be in original order despite processing times
      expect(results).toEqual([10, 20, 30, 40, 50, 60]);
    });

    test('mapBatch does not preserve order when preserveOrder=false', async () => {
      const unorderedResults = await fromIterable([1, 2, 3, 4]).mapBatch(
        async batch => {
          // First batch [1,2] takes longer, second batch [3,4] is faster
          const delay = batch.includes(1) ? 200 : 10;
          await new Promise(resolve => setTimeout(resolve, delay));
          return batch;
        },
        { batchSize: 2, concurrency: 2, preserveOrder: false }
      );

      // With preserveOrder=false, second batch should complete first
      expect(unorderedResults).toEqual([3, 4, 1, 2]);

      const orderedResults = await fromIterable([1, 2, 3, 4]).mapBatch(
        async batch => {
          // Same delays
          const delay = batch.includes(1) ? 200 : 10;
          await new Promise(resolve => setTimeout(resolve, delay));
          return batch;
        },
        { batchSize: 2, concurrency: 2, preserveOrder: true }
      );

      // With preserveOrder=true, should maintain original order
      expect(orderedResults).toEqual([1, 2, 3, 4]);
    });

    test('preserveOrder defaults to false', async () => {
      // Test with simple 2-item case
      const defaultResults = await fromIterable([1, 2]).map(
        async x => {
          const delay = x === 1 ? 200 : 10;
          await new Promise(resolve => setTimeout(resolve, delay));
          return x;
        },
        { concurrency: 2 } // No preserveOrder specified
      );

      // Default should behave like preserveOrder=false
      expect(defaultResults).toEqual([2, 1]);

      const explicitFalseResults = await fromIterable([1, 2]).map(
        async x => {
          const delay = x === 1 ? 200 : 10;
          await new Promise(resolve => setTimeout(resolve, delay));
          return x;
        },
        { concurrency: 2, preserveOrder: false }
      );

      // Both should behave the same way
      expect(defaultResults).toEqual(explicitFalseResults);
    });

    test('preserveOrder works with chained operations', async () => {
      const stream = fromIterable([1, 2, 3, 4]);

      const results = await stream
        .map(
          async x => {
            const delay = (5 - x) * 10;
            await new Promise(resolve => setTimeout(resolve, delay));
            return x * 2;
          },
          { concurrency: 4, preserveOrder: true }
        )
        .mapBatch(
          async batch => {
            return batch.map(x => x + 1);
          },
          { batchSize: 2, preserveOrder: true }
        );

      expect(results).toEqual([3, 5, 7, 9]);
    });

    test('preserveOrder with single item processes correctly', async () => {
      const stream = fromIterable([42]);

      const results = await stream.map(
        async x => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return x * 2;
        },
        { preserveOrder: true }
      );

      expect(results).toEqual([84]);
    });

    test('preserveOrder with empty stream', async () => {
      const stream = fromIterable([]);

      const results = await stream.map(async x => x * 2, {
        preserveOrder: true,
      });

      expect(results).toEqual([]);
    });
  });

  describe('edge cases', () => {
    test('handles very large concurrency', async () => {
      const stream = fromIterable([1, 2, 3]);
      const results = await stream.map(async x => x * 2, { concurrency: 1000 });
      expect(results).toEqual([2, 4, 6]);
    });

    test('handles zero batchSize gracefully', async () => {
      const stream = fromIterable([1, 2, 3]);
      // BatchSize of 0 should be treated as 1
      const results = await stream.mapBatch(
        async batch => batch.map(x => x * 2),
        { batchSize: 0 }
      );
      expect(results).toEqual([2, 4, 6]);
    });

    test('handles undefined configuration', async () => {
      const stream = fromIterable([1, 2, 3]);
      const results = await stream.map(async x => x * 2, undefined);
      expect(results).toEqual([2, 4, 6]);
    });
  });
});
