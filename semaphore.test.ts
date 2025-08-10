import { test, expect } from 'bun:test';
import { DefaultSemaphore } from './semaphore';
import { CrntError } from './common';

test('Semaphore allows immediate acquisition when permits are available', async () => {
  const semaphore = new DefaultSemaphore(2);

  // Should acquire immediately without waiting
  await semaphore.acquire();
  await semaphore.acquire();
});

test('Semaphore blocks when no permits are available', async () => {
  const semaphore = new DefaultSemaphore(1);
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
  const semaphore = new DefaultSemaphore(1);
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
  const semaphore = new DefaultSemaphore(3);
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
  const semaphore = new DefaultSemaphore(0);
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
  const semaphore = new DefaultSemaphore(1);
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
  const semaphore = new DefaultSemaphore(5);
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

test('Semaphore throws CrntError when releasing more permits than initial count', () => {
  const semaphore = new DefaultSemaphore(2);

  // Release without acquiring should throw
  expect(() => semaphore.release()).toThrow(CrntError);
  expect(() => semaphore.release()).toThrow(
    'Cannot release permit: would exceed initial permit count of 2'
  );
});

test('Semaphore throws CrntError when releasing after acquiring all permits', async () => {
  const semaphore = new DefaultSemaphore(1);

  // Acquire the permit
  await semaphore.acquire();

  // Release it back
  semaphore.release();

  // Try to release again should throw
  expect(() => semaphore.release()).toThrow(CrntError);
  expect(() => semaphore.release()).toThrow(
    'Cannot release permit: would exceed initial permit count of 1'
  );
});

test('Semaphore allows normal operation without exceeding initial permits', async () => {
  const semaphore = new DefaultSemaphore(3);

  // Acquire all permits
  await semaphore.acquire();
  await semaphore.acquire();
  await semaphore.acquire();

  // Release them back
  semaphore.release();
  semaphore.release();
  semaphore.release();

  // Trying to release one more should throw
  expect(() => semaphore.release()).toThrow(CrntError);
});

test('Semaphore with zero initial permits throws on any release without waiters', () => {
  const semaphore = new DefaultSemaphore(0);

  // Any release without waiters should throw
  expect(() => semaphore.release()).toThrow(CrntError);
  expect(() => semaphore.release()).toThrow(
    'Cannot release permit: would exceed initial permit count of 0'
  );
});

test('Semaphore acquire with already aborted AbortSignal throws immediately', async () => {
  const semaphore = new DefaultSemaphore(1);
  const controller = new AbortController();
  controller.abort();

  await expect(
    semaphore.acquire({ signal: controller.signal })
  ).rejects.toThrow('The operation was aborted');
});

test('Semaphore acquire can be aborted while waiting', async () => {
  const semaphore = new DefaultSemaphore(1);
  const controller = new AbortController();

  // Acquire the only permit
  await semaphore.acquire();

  // Start waiting for a permit
  const acquirePromise = semaphore.acquire({ signal: controller.signal });

  // Give it a moment to start waiting
  await new Promise(resolve => setTimeout(resolve, 1));

  // Abort the operation
  controller.abort();

  // Should reject with abort error
  await expect(acquirePromise).rejects.toThrow('The operation was aborted');
});

test('Semaphore cleans up aborted operations from waiting queue', async () => {
  const semaphore = new DefaultSemaphore(1);
  const controller1 = new AbortController();
  const controller2 = new AbortController();

  // Acquire the only permit
  await semaphore.acquire();

  // Start two waiting operations
  const acquire1 = semaphore.acquire({ signal: controller1.signal });
  const acquire2 = semaphore.acquire({ signal: controller2.signal });

  // Give them a moment to start waiting
  await new Promise(resolve => setTimeout(resolve, 1));

  // Abort the first one
  controller1.abort();

  // First should be rejected
  await expect(acquire1).rejects.toThrow('The operation was aborted');

  // Release the permit - should go to the second waiter
  semaphore.release();

  // Second should resolve
  await expect(acquire2).resolves.toBeUndefined();
});

test('Semaphore removes abort listener when operation completes normally', async () => {
  const semaphore = new DefaultSemaphore(1);
  const controller = new AbortController();

  // Should acquire immediately without waiting
  await semaphore.acquire({ signal: controller.signal });

  // Release the permit
  semaphore.release();

  // Aborting after completion should not affect anything
  controller.abort();

  // Should be able to acquire again normally
  await semaphore.acquire();
});

test('Semaphore works normally without AbortSignal', async () => {
  const semaphore = new DefaultSemaphore(1);

  // Should work exactly as before
  await semaphore.acquire();
  semaphore.release();
  await semaphore.acquire();
});

test('maybeAcquire returns true when permits are available', () => {
  const semaphore = new DefaultSemaphore(2);

  // Should acquire successfully
  expect(semaphore.maybeAcquire()).toBe(true);
  expect(semaphore.maybeAcquire()).toBe(true);
});

test('maybeAcquire returns false when no permits are available', () => {
  const semaphore = new DefaultSemaphore(1);

  // Acquire the only permit
  expect(semaphore.maybeAcquire()).toBe(true);

  // Second attempt should fail
  expect(semaphore.maybeAcquire()).toBe(false);
});

test('maybeAcquire works with release cycle', () => {
  const semaphore = new DefaultSemaphore(1);

  // Acquire permit
  expect(semaphore.maybeAcquire()).toBe(true);

  // Should fail now
  expect(semaphore.maybeAcquire()).toBe(false);

  // Release permit
  semaphore.release();

  // Should succeed again
  expect(semaphore.maybeAcquire()).toBe(true);
});

test('maybeAcquire does not interfere with async acquire', async () => {
  const semaphore = new DefaultSemaphore(2);

  // Mix sync and async acquisition
  expect(semaphore.maybeAcquire()).toBe(true);
  await semaphore.acquire();

  // No more permits available
  expect(semaphore.maybeAcquire()).toBe(false);

  // Release one permit
  semaphore.release();

  // Should be able to acquire again
  expect(semaphore.maybeAcquire()).toBe(true);
});

test('maybeAcquire with zero initial permits always returns false', () => {
  const semaphore = new DefaultSemaphore(0);

  expect(semaphore.maybeAcquire()).toBe(false);
  expect(semaphore.maybeAcquire()).toBe(false);
});
