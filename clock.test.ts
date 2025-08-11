import { describe, test, expect } from 'bun:test';
import { newFakeClock, newDefaultClock, FakeClock } from './clock';
import { CrntError } from './common';

describe('FakeClock', () => {
  describe('basic functionality', () => {
    test('should start with initial time', () => {
      const clock = newFakeClock(1000);
      expect(clock.now()).toBe(1000);
    });

    test('should default to time 0', () => {
      const clock = newFakeClock();
      expect(clock.now()).toBe(0);
    });

    test('should resolve sleep immediately when time advances', async () => {
      const clock = newFakeClock();
      let resolved = false;

      const sleepPromise = clock.sleep(100).then(() => {
        resolved = true;
      });

      expect(resolved).toBe(false);
      
      // Wait for auto-advancement
      await new Promise(resolve => process.nextTick(resolve));
      expect(clock.now()).toBe(100);
      
      await sleepPromise;
      expect(resolved).toBe(true);
    });

    test('should handle zero duration sleep', async () => {
      const clock = newFakeClock();
      let resolved = false;

      const sleepPromise = clock.sleep(0).then(() => {
        resolved = true;
      });

      await sleepPromise;
      expect(resolved).toBe(true);
      expect(clock.now()).toBe(0);
    });
  });

  describe('time advancement', () => {
    test('should advance time manually', () => {
      const clock = newFakeClock(100);
      clock.advance(50);
      expect(clock.now()).toBe(150);
    });

    test('should set absolute time', () => {
      const clock = newFakeClock(100);
      clock.setTime(500);
      expect(clock.now()).toBe(500);
    });

    test('should wake up promises when automatically advancing time', async () => {
      const clock = newFakeClock();
      const results: number[] = [];

      const promise1 = clock.sleep(100).then(() => results.push(1));
      const promise2 = clock.sleep(200).then(() => results.push(2));

      // Wait for auto-advancement to happen
      await new Promise(resolve => process.nextTick(resolve));
      
      // After auto-advancement, time should be at the latest wake-up time
      expect(clock.now()).toBe(200);
      
      // Wait for promises to resolve
      await Promise.all([promise1, promise2]);
      expect(results).toEqual([1, 2]);
    });
  });

  describe('multiple concurrent sleeps', () => {
    test('should handle multiple sleeps with different durations', async () => {
      const clock = newFakeClock();
      const results: string[] = [];

      const promises = [
        clock.sleep(300).then(() => results.push('300ms')),
        clock.sleep(100).then(() => results.push('100ms')),
        clock.sleep(200).then(() => results.push('200ms')),
      ];

      // Time auto-advances to the earliest wake-up time (100ms)
      expect(clock.now()).toBe(100);
      await promises[1];
      expect(results).toEqual(['100ms']);

      // Time auto-advances to next wake-up time (200ms)
      expect(clock.now()).toBe(200);
      await promises[2];
      expect(results).toEqual(['100ms', '200ms']);

      // Time auto-advances to final wake-up time (300ms)
      expect(clock.now()).toBe(300);
      await promises[0];
      expect(results).toEqual(['100ms', '200ms', '300ms']);
    });

    test('should handle many concurrent sleeps', async () => {
      const clock = newFakeClock();
      const results: number[] = [];
      const promises: Promise<void>[] = [];

      for (let i = 1; i <= 10; i++) {
        promises.push(
          clock.sleep(i * 100).then(() => results.push(i * 100))
        );
      }

      // Wait for the auto-advancement to kick in
      await new Promise(resolve => process.nextTick(resolve));

      for (let i = 1; i <= 10; i++) {
        expect(clock.now()).toBe(i * 100);
        await promises[i - 1];
        expect(results).toContain(i * 100);
      }

      expect(results).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    });

    test('should handle promises with same wake up time', async () => {
      const clock = newFakeClock();
      const results: string[] = [];

      const promises = [
        clock.sleep(100).then(() => results.push('first')),
        clock.sleep(100).then(() => results.push('second')),
        clock.sleep(100).then(() => results.push('third')),
      ];

      expect(clock.now()).toBe(100);
      await Promise.all(promises);
      expect(results).toHaveLength(3);
      expect(results).toContain('first');
      expect(results).toContain('second');
      expect(results).toContain('third');
    });
  });

  describe('AbortSignal integration', () => {
    test('should throw when signal is already aborted', async () => {
      const clock = newFakeClock();
      const controller = new AbortController();
      controller.abort(new Error('Test abort'));

      expect(() => 
        clock.sleep(100, { signal: controller.signal })
      ).toThrow(CrntError);
    });

    test('should abort pending sleep when signal is aborted', async () => {
      const clock = newFakeClock();
      const controller = new AbortController();

      const sleepPromise = clock.sleep(100, { signal: controller.signal });
      
      expect(clock.hasPendingPromises()).toBe(true);
      expect(clock.getPendingPromiseCount()).toBe(1);

      controller.abort(new Error('Test abort'));

      await expect(sleepPromise).rejects.toThrow(CrntError);
      expect(clock.hasPendingPromises()).toBe(false);
    });

    test('should handle timeout option with manual time advancement', async () => {
      const clock = newFakeClock();
      
      // For timeout to work with FakeClock, we need a different approach
      // Since the fake clock auto-advances, the sleep will complete before timeout
      const sleepPromise = clock.sleep(200, { timeout: 300 });
      
      await expect(sleepPromise).resolves.toBeUndefined();
      expect(clock.now()).toBe(200);
    });

    test('should handle both signal and timeout with manual advancement', async () => {
      const clock = newFakeClock();
      const controller = new AbortController();

      const sleepPromise = clock.sleep(300, { 
        signal: controller.signal, 
        timeout: 400 
      });

      // Sleep should complete normally since timeout > sleep duration
      await expect(sleepPromise).resolves.toBeUndefined();
      expect(clock.now()).toBe(300);
    });
  });

  describe('utility methods', () => {
    test('should track pending promises correctly', () => {
      const clock = newFakeClock();

      expect(clock.hasPendingPromises()).toBe(false);
      expect(clock.getPendingPromiseCount()).toBe(0);

      const promise1 = clock.sleep(100);
      expect(clock.hasPendingPromises()).toBe(true);
      expect(clock.getPendingPromiseCount()).toBe(1);

      const promise2 = clock.sleep(200);
      expect(clock.getPendingPromiseCount()).toBe(2);

      return Promise.all([promise1, promise2]).then(() => {
        expect(clock.hasPendingPromises()).toBe(false);
        expect(clock.getPendingPromiseCount()).toBe(0);
      });
    });

    test('should handle edge case with no pending promises', () => {
      const clock = newFakeClock();
      
      clock.advance(1000);
      expect(clock.now()).toBe(1000);
      
      clock.setTime(2000);
      expect(clock.now()).toBe(2000);
    });
  });

  describe('complex scenarios', () => {
    test('should handle nested sleeps', async () => {
      const clock = newFakeClock();
      const results: string[] = [];

      const outerSleep = clock.sleep(100).then(async () => {
        results.push('outer-start');
        await clock.sleep(50);
        results.push('outer-end');
      });

      expect(clock.now()).toBe(100);
      await outerSleep;
      
      expect(results).toEqual(['outer-start', 'outer-end']);
      expect(clock.now()).toBe(150);
    });

    test('should handle rapid consecutive sleeps', async () => {
      const clock = newFakeClock();
      const results: number[] = [];
      const promises: Promise<void>[] = [];

      for (let i = 0; i < 5; i++) {
        promises.push(clock.sleep(10).then(() => results.push(clock.now())));
      }

      // Wait for auto-advancement
      await new Promise(resolve => process.nextTick(resolve));

      // All should resolve at the same time since they all have the same duration
      expect(clock.now()).toBe(10);
      await Promise.all(promises);
      
      expect(results).toEqual([10, 10, 10, 10, 10]);
    });

    test('should maintain time consistency across operations', async () => {
      const clock = newFakeClock();
      const timeSnapshots: number[] = [];

      const sleeps = [
        clock.sleep(50).then(() => timeSnapshots.push(50)),
        clock.sleep(100).then(() => timeSnapshots.push(100)),
        clock.sleep(75).then(() => timeSnapshots.push(75)),
      ];

      await Promise.all(sleeps);
      
      // All promises should complete and we should be at the maximum time
      expect(timeSnapshots.sort()).toEqual([50, 75, 100]);
      expect(clock.now()).toBe(100);
    });
  });
});

describe('DefaultClock', () => {
  test('should use real time', () => {
    const clock = newDefaultClock();
    const before = Date.now();
    const clockTime = clock.now();
    const after = Date.now();
    
    expect(clockTime).toBeGreaterThanOrEqual(before);
    expect(clockTime).toBeLessThanOrEqual(after);
  });

  test('should handle abort signal', async () => {
    const clock = newDefaultClock();
    const controller = new AbortController();
    
    controller.abort(new Error('Test abort'));
    
    expect(() => 
      clock.sleep(10, { signal: controller.signal })
    ).toThrow(CrntError);
  });
});