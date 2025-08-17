import { test, expect } from 'bun:test';
import { DefaultSemaphore, newSemaphore } from './semaphore';
import { CrntError } from './common';
import { withFakeTimers, expectAbortError } from './test-helpers';
import {
  disposeSymbol,
  asyncDisposeSymbol,
} from './resource-management-polyfill';
import './test-helpers'; // Import withResolvers utility

test('Semaphore allows immediate acquisition when permits are available', async () => {
  const semaphore = new DefaultSemaphore(2);

  // Should acquire immediately without waiting
  const permit1 = await semaphore.acquire();
  const permit2 = await semaphore.acquire();

  // Clean up
  permit1.release();
  permit2.release();
});

test('Semaphore blocks when no permits are available', async () => {
  await withFakeTimers(async clock => {
    const semaphore = new DefaultSemaphore(1);
    let acquired = false;

    // First acquisition should succeed immediately
    const permit1 = await semaphore.acquire();

    // Second acquisition should block
    const acquirePromise = semaphore.acquire().then(permit => {
      acquired = true;
      permit.release(); // Clean up the second permit
    });

    // Give a small delay to ensure the acquire() would have completed if it wasn't blocked
    clock.tick(10);
    expect(acquired).toBe(false);

    // Release permit and verify the waiting acquisition completes
    permit1.release();
    await acquirePromise;
    expect(acquired).toBe(true);
  });
});

test('Semaphore maintains FIFO order for waiting operations', async () => {
  await withFakeTimers(async () => {
    const semaphore = new DefaultSemaphore(1);
    const results: number[] = [];

    // Acquire the only permit
    const initialPermit = await semaphore.acquire();

    // Queue multiple operations
    const promises = [
      semaphore.acquire().then(permit => {
        results.push(1);
        permit.release();
      }),
      semaphore.acquire().then(permit => {
        results.push(2);
        permit.release();
      }),
      semaphore.acquire().then(permit => {
        results.push(3);
        permit.release();
      }),
    ];

    // Release the initial permit to start the queue
    initialPermit.release();
    await Promise.all(promises);

    expect(results).toEqual([1, 2, 3]);
  });
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
  await withFakeTimers(async clock => {
    const semaphore = new DefaultSemaphore(0);
    let acquired = false;

    // Should block immediately
    const acquirePromise = semaphore.acquire().then(() => {
      acquired = true;
    });

    clock.tick(10);
    expect(acquired).toBe(false);

    // Release a permit
    semaphore.release();
    await acquirePromise;
    expect(acquired).toBe(true);
  });
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
  await withFakeTimers(async () => {
    const semaphore = new DefaultSemaphore(5);
    let activeOperations = 0;
    let maxConcurrent = 0;

    const operations = Array.from({ length: 20 }, async () => {
      await semaphore.acquire();
      activeOperations++;
      maxConcurrent = Math.max(maxConcurrent, activeOperations);

      // Simulate work with deterministic timing
      await new Promise(resolve => setTimeout(resolve, 5));

      activeOperations--;
      semaphore.release();
    });

    await Promise.all(operations);

    // Should never exceed the semaphore limit
    expect(maxConcurrent).toBeLessThanOrEqual(5);
    expect(activeOperations).toBe(0);
  });
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

  await expectAbortError(semaphore.acquire({ signal: controller.signal }));
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
  await expectAbortError(acquirePromise);
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
  await expectAbortError(acquire1);

  // Release the permit - should go to the second waiter
  semaphore.release();

  // Second should resolve to a permit
  const permit2 = await acquire2;
  expect(permit2).toBeDefined();
  permit2.release();
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
  expect(semaphore.maybeAcquire()).toBeDefined();
  expect(semaphore.maybeAcquire()).toBeDefined();
});

test('maybeAcquire returns false when no permits are available', () => {
  const semaphore = new DefaultSemaphore(1);

  // Acquire the only permit
  expect(semaphore.maybeAcquire()).toBeDefined();

  // Second attempt should fail
  expect(semaphore.maybeAcquire()).toBeUndefined();
});

test('maybeAcquire works with release cycle', () => {
  const semaphore = new DefaultSemaphore(1);

  // Acquire permit
  expect(semaphore.maybeAcquire()).toBeDefined();

  // Should fail now
  expect(semaphore.maybeAcquire()).toBeUndefined();

  // Release permit
  semaphore.release();

  // Should succeed again
  expect(semaphore.maybeAcquire()).toBeDefined();
});

test('maybeAcquire does not interfere with async acquire', async () => {
  const semaphore = new DefaultSemaphore(2);

  // Mix sync and async acquisition
  expect(semaphore.maybeAcquire()).toBeDefined();
  await semaphore.acquire();

  // No more permits available
  expect(semaphore.maybeAcquire()).toBeUndefined();

  // Release one permit
  semaphore.release();

  // Should be able to acquire again
  expect(semaphore.maybeAcquire()).toBeDefined();
});

test('maybeAcquire with zero initial permits always returns false', () => {
  const semaphore = new DefaultSemaphore(0);

  expect(semaphore.maybeAcquire()).toBeUndefined();
  expect(semaphore.maybeAcquire()).toBeUndefined();
});

test('Semaphore.run executes function and returns result', async () => {
  const semaphore = new DefaultSemaphore(1);
  const result = await semaphore.run(async () => {
    return 'test result';
  });

  expect(result).toBe('test result');
});

test('Semaphore.run acquires and releases permit correctly', async () => {
  const semaphore = new DefaultSemaphore(1);
  let executionStarted = false;
  let permitAvailable = false;

  const runPromise = semaphore.run(async () => {
    executionStarted = true;
    // Check if another operation can acquire the permit (should fail)
    const extraPermit = semaphore.maybeAcquire();
    permitAvailable = extraPermit !== undefined;
    if (extraPermit) {
      extraPermit.release(); // Clean up if we accidentally acquired
    }
    return 'done';
  });

  const result = await runPromise;

  expect(executionStarted).toBe(true);
  expect(permitAvailable).toBe(false); // Permit should not have been available during execution
  expect(result).toBe('done');

  // Permit should be available after completion
  expect(semaphore.maybeAcquire()).toBeDefined();
});

test('Semaphore.run releases permit even when function throws', async () => {
  const semaphore = new DefaultSemaphore(1);
  const error = new Error('test error');

  await expect(
    semaphore.run(async () => {
      throw error;
    })
  ).rejects.toThrow('test error');

  // Permit should be available after error
  expect(semaphore.maybeAcquire()).toBeDefined();
});

test('Semaphore.run handles multiple concurrent operations', async () => {
  await withFakeTimers(async () => {
    const semaphore = new DefaultSemaphore(2);
    const results: number[] = [];
    let activeOperations = 0;
    let maxConcurrent = 0;
    const operations = Array.from({ length: 5 }, (_, i) =>
      semaphore.run(async () => {
        activeOperations++;
        maxConcurrent = Math.max(maxConcurrent, activeOperations);

        // Simulate work
        await new Promise(resolve => setTimeout(resolve, 10));

        results.push(i);
        activeOperations--;
        return i;
      })
    );
    const operationResults = await Promise.all(operations);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(operationResults).toEqual([0, 1, 2, 3, 4]);
    expect(results).toHaveLength(5);
  });
});

test('Semaphore.run can be aborted with AbortSignal', async () => {
  await withFakeTimers(async () => {
    const semaphore = new DefaultSemaphore(1);
    const controller = new AbortController();

    // Acquire the permit to block the run operation
    await semaphore.acquire();

    const runPromise = semaphore.run(
      async () => {
        return 'should not complete';
      },
      { signal: controller.signal }
    );

    // Give it a moment to start waiting
    await new Promise(resolve => setTimeout(resolve, 1));

    // Abort the operation
    controller.abort();

    await expectAbortError(runPromise);

    // Permit should still be held by the original acquire
    expect(semaphore.maybeAcquire()).toBeUndefined();

    // Release the original permit
    semaphore.release();
    expect(semaphore.maybeAcquire()).toBeDefined();
  });
});

test('Semaphore.run with already aborted signal throws immediately', async () => {
  const semaphore = new DefaultSemaphore(1);
  const controller = new AbortController();
  controller.abort();

  await expectAbortError(
    semaphore.run(
      async () => {
        return 'should not execute';
      },
      { signal: controller.signal }
    )
  );

  // Permit should still be available since function never ran
  expect(semaphore.maybeAcquire()).toBeDefined();
});

// Resource Management Tests
test('SemaphorePermit supports Symbol.dispose (synchronous disposal)', async () => {
  const semaphore = newSemaphore(2);

  // Acquire permit
  const permit = await semaphore.acquire();

  // Verify permit was acquired
  expect(semaphore.maybeAcquire()).toBeDefined(); // 1 left
  expect(semaphore.maybeAcquire()).toBeUndefined(); // 0 left

  // Dispose using disposeSymbol
  permit[disposeSymbol]!();

  // Verify permit was released
  expect(semaphore.maybeAcquire()).toBeDefined(); // 1 available again
});

test('SemaphorePermit supports Symbol.asyncDispose (asynchronous disposal)', async () => {
  const semaphore = newSemaphore(2);

  // Acquire permit
  const permit = await semaphore.acquire();

  // Verify permit was acquired
  expect(semaphore.maybeAcquire()).toBeDefined(); // 1 left
  expect(semaphore.maybeAcquire()).toBeUndefined(); // 0 left

  // Dispose using asyncDisposeSymbol
  permit[disposeSymbol]();

  // Verify permit was released
  expect(semaphore.maybeAcquire()).toBeDefined(); // 1 available again
});

test('SemaphorePermit can be disposed multiple times safely', async () => {
  const semaphore = newSemaphore(1);
  const permit = await semaphore.acquire();

  // First disposal
  permit[disposeSymbol]!();
  expect(semaphore.maybeAcquire()).toBeDefined();
  semaphore.release(); // Put it back

  // Second disposal should be safe (no-op)
  permit[disposeSymbol]!();
  expect(semaphore.maybeAcquire()).toBeDefined();
});

test('SemaphorePermit works with using declaration syntax', async () => {
  const semaphore = newSemaphore(2);

  // Simulate using declaration behavior
  {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    using permit = await semaphore.acquire();

    // Verify permit was acquired - should have 1 left
    const extraPermit = semaphore.maybeAcquire(); // Take the other permit, now 0 left
    expect(extraPermit).toBeDefined();
    expect(semaphore.maybeAcquire()).toBeUndefined(); // Confirm 0 left

    // Release the manually acquired permit
    extraPermit!.release();
  }

  // After disposal, both permits should be available again
  expect(semaphore.maybeAcquire()).toBeDefined(); // 1 available
  expect(semaphore.maybeAcquire()).toBeDefined(); // 2nd available
});

test('SemaphorePermit works with await using declaration syntax', async () => {
  const semaphore = newSemaphore(2);

  // Simulate await using declaration behavior
  {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    await using permit = await semaphore.acquire();

    // Verify permit was acquired - should have 1 left
    const extraPermit = semaphore.maybeAcquire(); // Take the other permit, now 0 left
    expect(extraPermit).toBeDefined();
    expect(semaphore.maybeAcquire()).toBeUndefined(); // Confirm 0 left

    // Release the manually acquired permit
    extraPermit!.release();
  }

  // After disposal, both permits should be available again
  expect(semaphore.maybeAcquire()).toBeDefined(); // 1 available
  expect(semaphore.maybeAcquire()).toBeDefined(); // 2nd available
});

test('maybeAcquirePermit returns permit when available', () => {
  const semaphore = newSemaphore(1);

  const permit = semaphore.maybeAcquire();
  expect(permit).toBeDefined();

  // Should be none left
  expect(semaphore.maybeAcquire()).toBeUndefined();

  // Release and try again
  permit![disposeSymbol]!();
  expect(semaphore.maybeAcquire()).toBeDefined();
});

test('maybeAcquirePermit returns undefined when no permits available', () => {
  const semaphore = newSemaphore(0);

  const permit = semaphore.maybeAcquire();
  expect(permit).toBeUndefined();
});

test('Resource management with aborted signal', async () => {
  const semaphore = newSemaphore(1); // Start with 1 permit
  const controller = new AbortController();

  // Use up the permit first
  await semaphore.acquire();

  // Abort immediately
  controller.abort();

  // Should throw abort error when trying to acquire another permit
  await expectAbortError(semaphore.acquire({ signal: controller.signal }));

  // Original permit should still be used, so no permits available
  expect(semaphore.maybeAcquire()).toBeUndefined();

  // Release the original permit
  semaphore.release();
  expect(semaphore.maybeAcquire()).toBeDefined();
});

test('Polyfill symbols are available', () => {
  // Test that our polyfill correctly defines the symbols
  expect(typeof disposeSymbol).toBe('symbol');
  expect(typeof asyncDisposeSymbol).toBe('symbol');

  // Symbols should be unique
  expect(disposeSymbol).not.toBe(asyncDisposeSymbol);
});
