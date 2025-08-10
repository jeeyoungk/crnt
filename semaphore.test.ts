import { test, expect } from 'bun:test';
import { Semaphore } from './semaphore';

test('Semaphore allows immediate acquisition when permits are available', async () => {
  const semaphore = new Semaphore(2);

  // Should acquire immediately without waiting
  await semaphore.acquire();
  await semaphore.acquire();
});

test('Semaphore blocks when no permits are available', async () => {
  const semaphore = new Semaphore(1);
  let acquired = false;

  // First acquisition should succeed immediately
  await semaphore.acquire();

  // Second acquisition should block
  const acquirePromise = semaphore.acquire().then(() => {
    acquired = true;
  });

  // Give a small delay to ensure the acquire() would have completed if it wasn't blocked
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(acquired).toBe(false);

  // Release permit and verify the waiting acquisition completes
  semaphore.release();
  await acquirePromise;
  expect(acquired).toBe(true);
});

test('Semaphore maintains FIFO order for waiting operations', async () => {
  const semaphore = new Semaphore(1);
  const results: number[] = [];

  // Acquire the only permit
  await semaphore.acquire();

  // Queue multiple operations
  const promises = [
    semaphore.acquire().then(() => results.push(1)),
    semaphore.acquire().then(() => results.push(2)),
    semaphore.acquire().then(() => results.push(3)),
  ];

  // Release permits one by one
  semaphore.release();
  await new Promise(resolve => setTimeout(resolve, 1));

  semaphore.release();
  await new Promise(resolve => setTimeout(resolve, 1));

  semaphore.release();
  await Promise.all(promises);

  expect(results).toEqual([1, 2, 3]);
});

test('Semaphore handles concurrent acquire and release operations', async () => {
  const semaphore = new Semaphore(3);
  const completedOperations: number[] = [];

  // Start multiple concurrent operations
  const operations = Array.from({ length: 10 }, async (_, i) => {
    await semaphore.acquire();
    // Simulate some work
    await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
    completedOperations.push(i);
    semaphore.release();
  });

  await Promise.all(operations);

  // All operations should complete
  expect(completedOperations).toHaveLength(10);
  expect(completedOperations.sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('Semaphore works correctly with zero initial permits', async () => {
  const semaphore = new Semaphore(0);
  let acquired = false;

  // Should block immediately
  const acquirePromise = semaphore.acquire().then(() => {
    acquired = true;
  });

  await new Promise(resolve => setTimeout(resolve, 10));
  expect(acquired).toBe(false);

  // Release a permit
  semaphore.release();
  await acquirePromise;
  expect(acquired).toBe(true);
});

test('Semaphore handles rapid acquire/release cycles', async () => {
  const semaphore = new Semaphore(1);
  let counter = 0;

  // Perform rapid acquire/release cycles
  for (let i = 0; i < 100; i++) {
    await semaphore.acquire();
    counter++;
    semaphore.release();
  }

  expect(counter).toBe(100);
});

test('Semaphore maintains correct permit count under stress', async () => {
  const semaphore = new Semaphore(5);
  let activeOperations = 0;
  let maxConcurrent = 0;

  const operations = Array.from({ length: 20 }, async () => {
    await semaphore.acquire();
    activeOperations++;
    maxConcurrent = Math.max(maxConcurrent, activeOperations);

    // Simulate work
    await new Promise(resolve => setTimeout(resolve, Math.random() * 5));

    activeOperations--;
    semaphore.release();
  });

  await Promise.all(operations);

  // Should never exceed the semaphore limit
  expect(maxConcurrent).toBeLessThanOrEqual(5);
  expect(activeOperations).toBe(0);
});
