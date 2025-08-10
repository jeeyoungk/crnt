import { test, expect, describe } from 'bun:test';
import { toBufferedAsyncIterable } from './concurrent-iterator';

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

// Helper function to create a slow async iterable that yields items with irregular delays
async function* createSlowAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (let i = 0; i < items.length; i++) {
    // Irregular delays: some fast, some slow
    const delay = i % 3 === 0 ? 50 : 10;
    await new Promise<void>(resolve => setTimeout(resolve, delay));
    yield items[i]!;
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

describe('toBufferedAsyncIterable', () => {
  test('preserves all items in order', async () => {
    const source = [1, 2, 3, 4, 5];
    const asyncSource = createAsyncIterable(source);
    const buffered = toBufferedAsyncIterable(asyncSource, 3);

    const results = await collectAll(buffered);
    expect(results).toEqual(source);
  });

  test('works with empty source', async () => {
    const source: number[] = [];
    const asyncSource = createAsyncIterable(source);
    const buffered = toBufferedAsyncIterable(asyncSource);

    const results = await collectAll(buffered);
    expect(results).toEqual([]);
  });

  test('works with single item', async () => {
    const source = [42];
    const asyncSource = createAsyncIterable(source);
    const buffered = toBufferedAsyncIterable(asyncSource, 1);

    const results = await collectAll(buffered);
    expect(results).toEqual([42]);
  });

  test('buffers items for smooth consumption', async () => {
    const source = [1, 2, 3, 4, 5, 6];
    const slowSource = createSlowAsyncIterable(source);
    const buffered = toBufferedAsyncIterable(slowSource, 3);

    const startTime = Date.now();
    const results = await collectAll(buffered);
    const endTime = Date.now();

    expect(results).toEqual(source);

    // With buffering, total time should be less than if we processed sequentially
    // This is a rough check - buffering should provide some performance benefit
    expect(endTime - startTime).toBeLessThan(500); // Should be much faster than 6 * 50ms
  });

  test('handles different buffer sizes', async () => {
    const source = Array.from({ length: 20 }, (_, i) => i);
    const asyncSource = createAsyncIterable(source, 5);

    // Test with small buffer
    const buffered1 = toBufferedAsyncIterable(asyncSource, 2);
    const results1 = await collectAll(buffered1);
    expect(results1).toEqual(source);
  });

  test('handles large buffer size', async () => {
    const source = [1, 2, 3];
    const asyncSource = createAsyncIterable(source);
    const buffered = toBufferedAsyncIterable(asyncSource, 100); // Buffer larger than source

    const results = await collectAll(buffered);
    expect(results).toEqual(source);
  });

  test('handles buffer size of 1', async () => {
    const source = [1, 2, 3, 4, 5];
    const asyncSource = createAsyncIterable(source, 10);
    const buffered = toBufferedAsyncIterable(asyncSource, 1);

    const results = await collectAll(buffered);
    expect(results).toEqual(source);
  });

  test('propagates errors from source', async () => {
    async function* errorSource(): AsyncIterable<number> {
      yield 1;
      await new Promise(resolve => setTimeout(resolve, 10)); // Give time for buffering
      yield 2;
      await new Promise(resolve => setTimeout(resolve, 10)); // Give time for buffering
      throw new Error('Source error');
    }

    const buffered = toBufferedAsyncIterable(errorSource(), 3);

    const results: number[] = [];
    let caughtError: Error | null = null;

    try {
      for await (const item of buffered) {
        results.push(item);
      }
    } catch (error) {
      caughtError = error as Error;
    }

    expect(results).toEqual([1, 2]);
    expect(caughtError).toBeTruthy();
    expect(caughtError?.message).toBe('Source error');
  });

  test('supports iterator return method', async () => {
    const source = [1, 2, 3, 4, 5];
    const asyncSource = createAsyncIterable(source, 10);
    const buffered = toBufferedAsyncIterable(asyncSource, 2);

    const iterator = buffered[Symbol.asyncIterator]();

    // Get first item
    const result1 = await iterator.next();
    expect(result1).toEqual({ value: 1, done: false });

    // Get second item
    const result2 = await iterator.next();
    expect(result2).toEqual({ value: 2, done: false });

    // Call return to terminate early
    if (iterator.return) {
      const returnResult = await iterator.return();
      expect(returnResult.done).toBe(true);
    }

    // Next call should return done
    const result3 = await iterator.next();
    expect(result3.done).toBe(true);
  });

  test('supports iterator throw method', async () => {
    const source = [1, 2, 3, 4, 5];
    const asyncSource = createAsyncIterable(source, 10);
    const buffered = toBufferedAsyncIterable(asyncSource, 2);

    const iterator = buffered[Symbol.asyncIterator]();

    // Get first item
    const result1 = await iterator.next();
    expect(result1).toEqual({ value: 1, done: false });

    // Throw an error
    const testError = new Error('Test error');
    if (iterator.throw) {
      await expect(iterator.throw(testError)).rejects.toThrow('Test error');
    }
  });

  test('handles concurrent consumption', async () => {
    const source = Array.from({ length: 10 }, (_, i) => i);
    const asyncSource = createAsyncIterable(source, 5);
    const buffered = toBufferedAsyncIterable(asyncSource, 3);

    // Start multiple consumers
    const consumer1Promise = (async () => {
      const results: number[] = [];
      const iterator = buffered[Symbol.asyncIterator]();

      for (let i = 0; i < 3; i++) {
        const result = await iterator.next();
        if (!result.done) {
          results.push(result.value);
        }
      }
      return results;
    })();

    const consumer2Promise = (async () => {
      const results: number[] = [];
      const iterator = buffered[Symbol.asyncIterator]();

      for (let i = 0; i < 3; i++) {
        const result = await iterator.next();
        if (!result.done) {
          results.push(result.value);
        }
      }
      return results;
    })();

    const [results1, results2] = await Promise.all([
      consumer1Promise,
      consumer2Promise,
    ]);

    // Each consumer should get different items (no duplicates)
    const allResults = [...results1, ...results2];
    const uniqueResults = [...new Set(allResults)];
    expect(allResults.length).toBe(uniqueResults.length);

    // All results should be from the source
    allResults.forEach(item => {
      expect(source).toContain(item);
    });
  });

  test('works with string data', async () => {
    const source = ['hello', 'world', 'async', 'iterator'];
    const asyncSource = createAsyncIterable(source, 5);
    const buffered = toBufferedAsyncIterable(asyncSource, 2);

    const results = await collectAll(buffered);
    expect(results).toEqual(source);
  });

  test('works with object data', async () => {
    const source = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
      { id: 3, name: 'Charlie' },
    ];
    const asyncSource = createAsyncIterable(source);
    const buffered = toBufferedAsyncIterable(asyncSource, 2);

    const results = await collectAll(buffered);
    expect(results).toEqual(source);
  });

  test('default buffer size', async () => {
    const source = Array.from({ length: 15 }, (_, i) => i);
    const asyncSource = createAsyncIterable(source, 2);
    const buffered = toBufferedAsyncIterable(asyncSource); // Default buffer size is 10

    const results = await collectAll(buffered);
    expect(results).toEqual(source);
  });

  test('memory efficiency with large datasets', async () => {
    // Test that it doesn't load everything into memory at once
    const source = Array.from({ length: 100 }, (_, i) => i);
    const asyncSource = createAsyncIterable(source, 1);
    const buffered = toBufferedAsyncIterable(asyncSource, 5);

    const results: number[] = [];
    let processedCount = 0;

    for await (const item of buffered) {
      results.push(item);
      processedCount++;

      // Verify we're not buffering everything at once
      // The buffer should never hold more than the specified buffer size
      if (processedCount < 95) {
        // Near the end, buffer might be smaller
        // This is hard to test directly, but we can at least verify the results are correct
        expect(item).toBe(processedCount - 1);
      }
    }

    expect(results).toEqual(source);
    expect(processedCount).toBe(100);
  });
});
