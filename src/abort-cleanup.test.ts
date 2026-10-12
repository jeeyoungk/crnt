import { describe, expect, test } from 'vitest';
import { abortRace, sleep } from './abort';
import { newSemaphore } from './semaphore';
import { DefaultQueue } from './queue';
import {
  expectAbortError,
  trackListeners,
  withManualClock,
} from './test-helpers';

/** Let pending microtasks (cleanup after settle) run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe('timeout timers and signal listeners are released once an operation settles', () => {
  test('semaphore.acquire: immediate and after waiting', async () => {
    await withManualClock(async clock => {
      const controller = new AbortController();
      const listenerCount = trackListeners(controller.signal);
      const options = { signal: controller.signal, timeout: 1000 };
      const semaphore = newSemaphore(1);

      const first = await semaphore.acquire(options);
      const afterImmediate = {
        timers: clock.countTimers(),
        listeners: listenerCount(),
      };

      const second = semaphore.acquire(options);
      await flush();
      const whileWaiting = {
        timers: clock.countTimers(),
        listeners: listenerCount(),
      };
      first.release();
      (await second).release();

      expect({
        afterImmediate,
        whileWaiting,
        afterWaiting: {
          timers: clock.countTimers(),
          listeners: listenerCount(),
        },
      }).toMatchObject({
        afterImmediate: { timers: 0, listeners: 0 },
        whileWaiting: { timers: 1, listeners: 1 },
        afterWaiting: { timers: 0, listeners: 0 },
      });
    });
  });

  test('semaphore.acquire: cleaned up when the timeout fires', async () => {
    await withManualClock(async clock => {
      const controller = new AbortController();
      const listenerCount = trackListeners(controller.signal);
      const semaphore = newSemaphore(0);

      const pending = semaphore.acquire({
        signal: controller.signal,
        timeout: 50,
      });
      clock.tick(50);
      await expectAbortError(pending);

      expect({
        timers: clock.countTimers(),
        listeners: listenerCount(),
      }).toMatchObject({
        timers: 0,
        listeners: 0,
      });
    });
  });

  test('queue.enqueue / dequeue: immediate, after waiting, and on synchronous throw', async () => {
    await withManualClock(async clock => {
      const controller = new AbortController();
      const listenerCount = trackListeners(controller.signal);
      const options = { signal: controller.signal, timeout: 1000 };
      const queue = new DefaultQueue<number>(1);

      await queue.enqueue(1, options);
      expect(await queue.dequeue(options)).toBe(1);
      await flush();
      const afterImmediate = {
        timers: clock.countTimers(),
        listeners: listenerCount(),
      };

      const waitingDequeue = queue.dequeue(options);
      await queue.enqueue(2, options);
      const dequeued = await waitingDequeue;
      await flush();
      const afterWaiting = {
        timers: clock.countTimers(),
        listeners: listenerCount(),
      };

      queue.close();
      expect(() => queue.enqueue(3, options)).toThrow();
      const afterThrow = {
        timers: clock.countTimers(),
        listeners: listenerCount(),
      };

      expect({
        dequeued,
        afterImmediate,
        afterWaiting,
        afterThrow,
      }).toMatchObject({
        dequeued: 2,
        afterImmediate: { timers: 0, listeners: 0 },
        afterWaiting: { timers: 0, listeners: 0 },
        afterThrow: { timers: 0, listeners: 0 },
      });
    });
  });

  test('abortRace and sleep remove their listener once settled', async () => {
    await withManualClock(async clock => {
      const controller = new AbortController();
      const listenerCount = trackListeners(controller.signal);

      const raced = await abortRace(Promise.resolve('done'), controller.signal);
      const afterRace = listenerCount();

      const slept = sleep(10, controller.signal);
      const whileSleeping = listenerCount();
      clock.tick(10);
      await slept;

      expect({
        raced,
        afterRace,
        whileSleeping,
        afterSleep: listenerCount(),
      }).toMatchObject({
        raced: 'done',
        afterRace: 0,
        whileSleeping: 1,
        afterSleep: 0,
      });
    });
  });
});
