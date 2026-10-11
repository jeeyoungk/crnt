import { test, expect } from 'vitest';
import { install, type Clock } from '@sinonjs/fake-timers';
import { parallelMap } from './util';
import { newSemaphore } from './semaphore';
import { isResolved } from './common';
import {
  expectAbortError,
  withFakeTimers,
  withResolvers,
} from './test-helpers';

/**
 * Fake timers that only advance when the test ticks the clock. Unlike
 * {@link withFakeTimers}, pending timers are not run eagerly, so the test can
 * observe state right before and after a timeout fires.
 */
async function withManualClock(
  testFn: (clock: Clock) => Promise<void>
): Promise<void> {
  const clock = install();
  try {
    await testFn(clock);
  } finally {
    clock.uninstall();
  }
}

/** Let pending microtasks (acquire / release chains) settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

/**
 * Creates a mapping function whose calls are controlled by the test: each call
 * blocks until `resolve(item, value)` or `reject(item, error)` is called.
 * Tracks the number of calls in flight and the peak.
 */
function controlledTasks<T, U>() {
  const pending = new Map<T, ReturnType<typeof withResolvers<U>>>();
  const state = {
    inFlight: 0,
    maxInFlight: 0,
    started: [] as T[],
    running: new Set<T>(),
  };
  const fn = async (item: T): Promise<U> => {
    const deferred = withResolvers<U>();
    pending.set(item, deferred);
    state.started.push(item);
    state.running.add(item);
    state.inFlight++;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    try {
      return await deferred.promise;
    } finally {
      state.inFlight--;
      state.running.delete(item);
    }
  };
  return {
    fn,
    state,
    resolve(item: T, value: U) {
      pending.get(item)!.resolve(value);
    },
    reject(item: T, error: unknown) {
      pending.get(item)!.reject(error);
    },
  };
}

test('parallelMap returns an empty array for empty input', async () => {
  expect(await parallelMap([], async x => x, 2)).toEqual([]);
});

test('parallelMap preserves input order regardless of completion order', async () => {
  const tasks = controlledTasks<number, string>();
  const input = [0, 1, 2, 3, 4];
  const result = parallelMap(input, tasks.fn, input.length);
  await flush();
  for (const item of [...input].reverse()) {
    tasks.resolve(item, `v${item}`);
    await flush();
  }
  expect(await result).toEqual(['v0', 'v1', 'v2', 'v3', 'v4']);
});

test('parallelMap never exceeds the concurrency limit', async () => {
  const tasks = controlledTasks<number, number>();
  const input = Array.from({ length: 10 }, (_, i) => i);
  const result = parallelMap(input, tasks.fn, 3);

  await flush();
  const initial = {
    inFlight: tasks.state.inFlight,
    started: [...tasks.state.started],
  };

  // Complete tasks one at a time, always the most recently started one, so
  // completion order differs from start order.
  const snapshots: number[] = [];
  while (tasks.state.running.size > 0) {
    const target = [...tasks.state.running].at(-1)!;
    tasks.resolve(target, target * 10);
    await flush();
    snapshots.push(tasks.state.inFlight);
  }

  expect({
    initial,
    maxInFlight: tasks.state.maxInFlight,
    allStarted: [...tasks.state.started].sort((a, b) => a - b),
    snapshotsWithinLimit: snapshots.every(n => n <= 3),
    result: await result,
  }).toMatchObject({
    initial: { inFlight: 3, started: [0, 1, 2] },
    maxInFlight: 3,
    allStarted: input,
    snapshotsWithinLimit: true,
    result: input.map(i => i * 10),
  });
});

test('parallelMap with limit 1 runs sequentially in input order', async () => {
  const order: string[] = [];
  const result = await parallelMap(
    ['a', 'b', 'c'],
    async item => {
      order.push(`start:${item}`);
      await flush();
      order.push(`end:${item}`);
      return item.toUpperCase();
    },
    1
  );
  expect({ order, result }).toMatchObject({
    order: ['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c'],
    result: ['A', 'B', 'C'],
  });
});

test('parallelMap accepts a Semaphore and shares its permits', async () => {
  const semaphore = newSemaphore(3);
  // Hold one permit outside of parallelMap; only 2 remain for the map.
  const external = await semaphore.acquire();

  const tasks = controlledTasks<number, number>();
  const result = parallelMap([0, 1, 2, 3], tasks.fn, semaphore);
  await flush();
  const beforeRelease = tasks.state.inFlight;

  external.release();
  await flush();
  const afterRelease = tasks.state.inFlight;

  for (const item of [0, 1, 2, 3]) {
    tasks.resolve(item, item);
    await flush();
  }

  expect({
    beforeRelease,
    afterRelease,
    maxInFlight: tasks.state.maxInFlight,
    result: await result,
    // all 3 permits are back in the semaphore
    permits: [
      semaphore.maybeAcquire(),
      semaphore.maybeAcquire(),
      semaphore.maybeAcquire(),
      semaphore.maybeAcquire(),
    ].map(p => p !== undefined),
  }).toMatchObject({
    beforeRelease: 2,
    afterRelease: 3,
    maxInFlight: 3,
    result: [0, 1, 2, 3],
    permits: [true, true, true, false],
  });
});

test('parallelMap propagates the first rejection', async () => {
  const tasks = controlledTasks<number, number>();
  const result = parallelMap([0, 1, 2], tasks.fn, 3);
  await flush();

  const first = new Error('first');
  tasks.reject(1, first);
  await flush();
  tasks.reject(0, new Error('second'));
  tasks.resolve(2, 2);

  await expect(result).rejects.toBe(first);
});

test('parallelMap releases permits when the mapping function rejects', async () => {
  await withFakeTimers(async () => {
    const semaphore = newSemaphore(2);
    let calls = 0;
    const result = parallelMap(
      [0, 1, 2, 3, 4],
      async item => {
        calls++;
        await flush();
        throw new Error(`fail ${item}`);
      },
      semaphore
    );
    await expect(result).rejects.toThrow('fail 0');

    // Both permits must come back once every queued item has run and failed.
    const p1 = await semaphore.acquire();
    const p2 = await semaphore.acquire();
    expect({
      calls,
      extra: semaphore.maybeAcquire(),
    }).toMatchObject({ calls: 5, extra: undefined });
    p1.release();
    p2.release();
  });
});

test('parallelMap rejects queued items when the signal is aborted', async () => {
  const semaphore = newSemaphore(1);
  const tasks = controlledTasks<number, number>();
  const controller = new AbortController();
  const result = parallelMap([0, 1, 2], tasks.fn, semaphore, {
    signal: controller.signal,
  });
  // Avoid an unhandled rejection before we await it below.
  result.catch(() => {});
  await flush();

  controller.abort();
  await flush();
  const settledAfterAbort = await isResolved(result);

  // The in-flight item still owns its permit until it finishes.
  tasks.resolve(0, 0);
  await flush();

  expect({
    settledAfterAbort,
    started: tasks.state.started,
    permitReturned: semaphore.maybeAcquire() !== undefined,
  }).toMatchObject({
    settledAfterAbort: 'rejected',
    started: [0],
    permitReturned: true,
  });
  await expectAbortError(result);
});

test('parallelMap rejects with an abort error when the timeout elapses while waiting', async () => {
  await withManualClock(async clock => {
    const semaphore = newSemaphore(1);
    const tasks = controlledTasks<number, number>();
    const result = parallelMap([0, 1], tasks.fn, semaphore, { timeout: 100 });
    result.catch(() => {});
    await flush();

    await clock.tickAsync(99);
    const beforeTimeout = await isResolved(result);
    await clock.tickAsync(1);
    const afterTimeout = await isResolved(result);

    tasks.resolve(0, 0);
    await flush();

    expect({
      beforeTimeout,
      afterTimeout,
      started: tasks.state.started,
      permitReturned: semaphore.maybeAcquire() !== undefined,
    }).toMatchObject({
      beforeTimeout: false,
      afterTimeout: 'rejected',
      started: [0],
      permitReturned: true,
    });
    await expectAbortError(result);
  });
});

test('parallelMap completes when tasks finish before the timeout', async () => {
  await withManualClock(async clock => {
    const tasks = controlledTasks<number, number>();
    const result = parallelMap([0, 1, 2], tasks.fn, 1, { timeout: 100 });
    await flush();
    for (const item of [0, 1, 2]) {
      await clock.tickAsync(30);
      tasks.resolve(item, item * 2);
      await flush();
    }
    expect(await result).toEqual([0, 2, 4]);
  });
});
