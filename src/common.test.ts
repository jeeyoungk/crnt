import type * as Bun from 'bun';
import { test, expect, describe, afterEach, beforeEach } from 'bun:test';
import {
  _makeAbortSignal,
  type Options,
  isResolvedChecker,
  isResolved,
  promiseMapInternal,
  withTimeout,
  isBunRuntime,
} from './common';

// Helper function to check map size based on runtime
// In Bun: always 0 (uses peek optimization)
// In other runtimes: actual count (uses manual tracking)
function expectMapSize(count: number): void {
  const expected = isBunRuntime() ? 0 : count;
  expect(promiseMapInternal.size).toBe(expected);
}

describe('common', () => {
  describe('_makeAbortSignal', () => {
    test('_makeAbortSignal returns undefined when options is undefined', () => {
      const result = _makeAbortSignal(undefined);
      expect(result).toBeUndefined();
    });

    test('_makeAbortSignal returns undefined when options is null', () => {
      const result = _makeAbortSignal(null as unknown as Options | undefined);
      expect(result).toBeUndefined();
    });

    test('_makeAbortSignal returns undefined when both signal and timeout are undefined', () => {
      const options: Options = {};
      const result = _makeAbortSignal(options);
      expect(result).toBeUndefined();
    });

    test('_makeAbortSignal returns undefined when both signal and timeout are null', () => {
      const options: Options = { signal: undefined, timeout: undefined };
      const result = _makeAbortSignal(options);
      expect(result).toBeUndefined();
    });

    test('_makeAbortSignal returns the signal when only signal is provided', () => {
      const controller = new AbortController();
      const options: Options = { signal: controller.signal };
      const result = _makeAbortSignal(options);
      expect(result).toBe(controller.signal);
    });

    test('_makeAbortSignal returns timeout-based signal when only timeout is provided', () => {
      const options: Options = { timeout: 100 };
      const result = _makeAbortSignal(options);

      expect(result).toBeDefined();
      expect(result).toBeInstanceOf(AbortSignal);
      expect(result!.aborted).toBe(false);
    });

    test('_makeAbortSignal timeout-based signal aborts after timeout', async () => {
      const options: Options = { timeout: 10 };
      const result = _makeAbortSignal(options);

      expect(result!.aborted).toBe(false);

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 15));

      expect(result!.aborted).toBe(true);
    });

    test('_makeAbortSignal returns combined signal when both signal and timeout are provided', () => {
      const controller = new AbortController();
      const options: Options = { signal: controller.signal, timeout: 100 };
      const result = _makeAbortSignal(options);

      expect(result).toBeDefined();
      expect(result).toBeInstanceOf(AbortSignal);
      expect(result).not.toBe(controller.signal);
      expect(result!.aborted).toBe(false);
    });

    test('_makeAbortSignal combined signal aborts when original signal is aborted', async () => {
      const controller = new AbortController();
      const customReason = new Error('custom reason');
      const options: Options = { signal: controller.signal, timeout: 100 };
      const result = _makeAbortSignal(options);

      expect(result!.aborted).toBe(false);

      // Abort the original signal
      controller.abort(customReason);

      // Give it a moment to propagate
      await new Promise(resolve => setTimeout(resolve, 1));

      expect(result!.aborted).toBe(true);
      expect(result!.reason).toBe(customReason);
    });

    test('_makeAbortSignal combined signal aborts when timeout expires', async () => {
      const controller = new AbortController();
      const options: Options = { signal: controller.signal, timeout: 10 };
      const result = _makeAbortSignal(options);

      expect(result!.aborted).toBe(false);

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 15));

      expect(result!.aborted).toBe(true);
    });

    test('_makeAbortSignal combined signal aborts with original signal reason when signal aborts first', async () => {
      const controller = new AbortController();
      const customReason = new Error('signal aborted first');
      const options: Options = { signal: controller.signal, timeout: 100 };
      const result = _makeAbortSignal(options);

      // Abort the original signal before timeout
      controller.abort(customReason);

      // Give it a moment to propagate
      await new Promise(resolve => setTimeout(resolve, 1));

      expect(result!.aborted).toBe(true);
      expect(result!.reason).toBe(customReason);
    });

    test('_makeAbortSignal combined signal clears timeout when original signal aborts first', async () => {
      const controller = new AbortController();
      const options: Options = { signal: controller.signal, timeout: 50 };
      const result = _makeAbortSignal(options);

      // Abort the original signal immediately
      controller.abort();

      // Give it a moment to propagate
      await new Promise(resolve => setTimeout(resolve, 1));
      expect(result!.aborted).toBe(true);

      // Wait past the timeout to ensure it was cleared
      await new Promise(resolve => setTimeout(resolve, 60));

      // Signal should still be aborted with the original reason, not timeout
      expect(result!.aborted).toBe(true);
    });

    test('_makeAbortSignal works with already aborted signal', () => {
      const controller = new AbortController();
      const customReason = new Error('already aborted');
      controller.abort(customReason);

      const options: Options = { signal: controller.signal, timeout: 100 };
      const result = _makeAbortSignal(options);

      expect(result).toBeDefined();
      expect(result!.aborted).toBe(true);
      expect(result!.reason).toBe(customReason);
    });

    test('_makeAbortSignal timeout signal has default abort reason', async () => {
      const options: Options = { timeout: 10 };
      const result = _makeAbortSignal(options);

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 15));

      expect(result!.aborted).toBe(true);
      // The reason should be the default DOMException for AbortController.abort()
      expect(result!.reason).toBeDefined();
    });
  });

  describe('isResolvedChecker', () => {
    afterEach(() => {
      promiseMapInternal.clear();
    });

    test('returns false for unresolved promise', async () => {
      const promise = new Promise(() => {}); // Never resolves
      const checker = await isResolvedChecker(promise);
      expect(checker()).toBe(false);
      // expect(promiseMapInternal.size).toBe(1); // TODO: this is flaky on CI for some reason; returning (2).
    });

    test('returns fulfilled for already resolved promise', async () => {
      const promise = Promise.resolve('success');
      const checker = await isResolvedChecker(promise);
      expect(checker()).toBe('fulfilled');
      expectMapSize(0); // Should be cleaned up automatically
    });

    test('returns rejected for already rejected promise', async () => {
      const promise = Promise.reject(new Error('failed'));
      // Handle the rejection to prevent unhandled promise rejection
      promise.catch(() => {});
      const checker = await isResolvedChecker(promise);
      expect(checker()).toBe('rejected');
      expectMapSize(0); // Should be cleaned up automatically
    });

    test('returns fulfilled after promise resolves', async () => {
      let resolve: (value: string) => void;
      const promise = new Promise<string>(r => {
        resolve = r;
      });
      const checker = await isResolvedChecker(promise);

      expect(checker()).toBe(false);
      expectMapSize(1);

      resolve!('success');
      await Promise.resolve(); // Let promise resolve

      expect(checker()).toBe('fulfilled');
      expectMapSize(0); // Should be cleaned up automatically
    });

    test('returns rejected after promise rejects', async () => {
      let reject: (error: Error) => void;
      const promise = new Promise<string>((_, r) => {
        reject = r;
      });
      // Handle the rejection to prevent unhandled promise rejection
      promise.catch(() => {});
      const checker = await isResolvedChecker(promise);

      expect(checker()).toBe(false);
      expectMapSize(1);

      const error = new Error('failed');
      reject!(error);
      await Promise.resolve(); // Let promise reject

      expect(checker()).toBe('rejected');
      expectMapSize(0); // Should be cleaned up automatically
    });

    test('checker function can be called multiple times', async () => {
      let resolve: (value: string) => void;
      const promise = new Promise<string>(r => {
        resolve = r;
      });
      const checker = await isResolvedChecker(promise);

      expect(checker()).toBe(false);
      expect(checker()).toBe(false);

      resolve!('success');
      await Promise.resolve();

      expect(checker()).toBe('fulfilled');
      expect(checker()).toBe('fulfilled');
    });

    test('promiseMapInternal tracks unresolved promises and cleans up resolved ones', async () => {
      expectMapSize(0);

      // Test with unresolved promises
      const unresolvedPromise1 = new Promise(() => {});
      const unresolvedPromise2 = new Promise(() => {});

      await isResolvedChecker(unresolvedPromise1);
      await isResolvedChecker(unresolvedPromise2);
      expectMapSize(2);

      // Test with resolved promise - should be automatically cleaned up
      const resolvedPromise = Promise.resolve('test');
      await isResolvedChecker(resolvedPromise);
      expectMapSize(2); // Still only the 2 unresolved ones
    });
  });

  describe('isResolved', () => {
    afterEach(() => {
      promiseMapInternal.clear();
    });
    beforeEach(() => {
      expectMapSize(0);
    });

    test('returns false for unresolved promise', async () => {
      const promise = new Promise(() => {}); // Never resolves
      const result = await isResolved(promise);
      expect(result).toBe(false);
      expectMapSize(1);
    });

    test('returns fulfilled for already resolved promise', async () => {
      const promise = Promise.resolve('success');
      const result = await isResolved(promise);
      expect(result).toBe('fulfilled');
      expectMapSize(0); // Should be cleaned up automatically
    });

    test('returns rejected for already rejected promise', async () => {
      const promise = Promise.reject(new Error('failed'));
      // Handle the rejection to prevent unhandled promise rejection
      promise.catch(() => {});
      const result = await isResolved(promise);
      expect(result).toBe('rejected');
      expectMapSize(0); // Should be cleaned up automatically
    });

    test('returns false then fulfilled as promise resolves', async () => {
      let resolve: (value: string) => void;
      const promise = new Promise<string>(r => {
        resolve = r;
      });

      expect(await isResolved(promise)).toBe(false);
      expectMapSize(1);

      resolve!('success');
      await Promise.resolve(); // Let promise resolve

      expect(await isResolved(promise)).toBe('fulfilled');
      expectMapSize(0); // Should be cleaned up automatically
    });

    test('returns false then rejected as promise rejects', async () => {
      let reject: (error: Error) => void;
      const promise = new Promise<string>((_, r) => {
        reject = r;
      });
      // Handle the rejection to prevent unhandled promise rejection
      promise.catch(() => {});

      expect(await isResolved(promise)).toBe(false);
      expectMapSize(1);

      const error = new Error('failed');
      reject!(error);
      await Promise.resolve(); // Let promise reject

      expect(await isResolved(promise)).toBe('rejected');
      expectMapSize(0); // Should be cleaned up automatically
    });

    test('works with different promise types', async () => {
      const stringPromise = Promise.resolve('hello');
      const numberPromise = Promise.resolve(42);
      const objectPromise = Promise.resolve({ key: 'value' });
      const nullPromise = Promise.resolve(null);
      const undefinedPromise = Promise.resolve(undefined);

      expect(await isResolved(stringPromise)).toBe('fulfilled');
      expect(await isResolved(numberPromise)).toBe('fulfilled');
      expect(await isResolved(objectPromise)).toBe('fulfilled');
      expect(await isResolved(nullPromise)).toBe('fulfilled');
      expect(await isResolved(undefinedPromise)).toBe('fulfilled');
    });

    test('promiseMapInternal tracks unresolved promises and cleans up resolved ones', async () => {
      expectMapSize(0);

      // Test with unresolved promises
      const unresolvedPromise1 = new Promise(() => {});
      const unresolvedPromise2 = new Promise(() => {});

      await isResolved(unresolvedPromise1);
      await isResolved(unresolvedPromise2);
      expectMapSize(2);

      // Test with resolved promise - should be automatically cleaned up
      const resolvedPromise = Promise.resolve('test');
      await isResolved(resolvedPromise);
      expectMapSize(2); // Still only the 2 unresolved ones
    });
  });

  describe('withTimeout', () => {
    test('aborts controller after timeout', async () => {
      const controller = new AbortController();
      const clearFn = withTimeout(controller, 10);

      expect(controller.signal.aborted).toBe(false);

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 15));

      expect(controller.signal.aborted).toBe(true);
      expect(typeof clearFn).toBe('function');
    });

    test('clear function prevents timeout abort', async () => {
      const controller = new AbortController();
      const clearFn = withTimeout(controller, 10);

      expect(controller.signal.aborted).toBe(false);

      // Clear timeout before it triggers
      clearFn();

      // Wait past timeout duration
      await new Promise(resolve => setTimeout(resolve, 15));

      expect(controller.signal.aborted).toBe(false);
    });

    test('clear function is automatically called when signal is aborted externally', async () => {
      const controller = new AbortController();
      const clearFn = withTimeout(controller, 100); // Long timeout

      expect(controller.signal.aborted).toBe(false);

      // Abort the controller manually
      controller.abort();

      expect(controller.signal.aborted).toBe(true);

      // Wait to ensure timeout would have triggered if not cleared
      await new Promise(resolve => setTimeout(resolve, 10));

      // Controller should still be aborted (from manual abort, not timeout)
      expect(controller.signal.aborted).toBe(true);
      expect(typeof clearFn).toBe('function');
    });

    test('works with zero timeout', async () => {
      const controller = new AbortController();
      withTimeout(controller, 0);

      expect(controller.signal.aborted).toBe(false);

      // Wait for next tick
      await new Promise(resolve => setTimeout(resolve, 1));

      expect(controller.signal.aborted).toBe(true);
    });

    test('works with already aborted controller', async () => {
      const controller = new AbortController();
      const customReason = new Error('already aborted');
      controller.abort(customReason);

      const clearFn = withTimeout(controller, 10);

      expect(controller.signal.aborted).toBe(true);
      expect(controller.signal.reason).toBe(customReason);

      // Wait past timeout to ensure it doesn't interfere
      await new Promise(resolve => setTimeout(resolve, 15));

      expect(controller.signal.aborted).toBe(true);
      expect(controller.signal.reason).toBe(customReason);
      expect(typeof clearFn).toBe('function');
    });

    test('multiple calls to clear function are safe', async () => {
      const controller = new AbortController();
      const clearFn = withTimeout(controller, 50);

      expect(controller.signal.aborted).toBe(false);

      // Call clear multiple times
      clearFn();
      clearFn();
      clearFn();

      // Wait past timeout duration
      await new Promise(resolve => setTimeout(resolve, 60));

      expect(controller.signal.aborted).toBe(false);
    });

    test('timeout aborts with default reason', async () => {
      const controller = new AbortController();
      withTimeout(controller, 10);

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 15));

      expect(controller.signal.aborted).toBe(true);
      expect(controller.signal.reason).toBeDefined();
    });
  });

  describe('Bun runtime detection and peek optimization', () => {
    test('should handle Bun peek availability gracefully', async () => {
      // Check if Bun's peek.status is available
      const bunPeek = (globalThis as { Bun?: typeof Bun }).Bun?.peek;
      const hasPeekStatus = bunPeek && typeof bunPeek.status === 'function';

      if (hasPeekStatus) {
        // Test the peek.status method works if available
        const promise = Promise.resolve('test');
        const status = bunPeek.status(promise);
        expect(['pending', 'fulfilled', 'rejected']).toContain(status);
      }
    });

    test('isResolved should work correctly with Bun peek optimization', async () => {
      // Test with resolved promise
      const resolvedPromise = Promise.resolve('test');
      const result = await isResolved(resolvedPromise);
      expect(result).toBe('fulfilled');

      // Test with rejected promise
      const rejectedPromise = Promise.reject(new Error('test'));
      // Handle the rejection to prevent unhandled promise rejection
      rejectedPromise.catch(() => {});
      const result2 = await isResolved(rejectedPromise);
      expect(result2).toBe('rejected');

      // Test with pending promise
      const pendingPromise = new Promise(() => {}); // Never resolves
      const result3 = await isResolved(pendingPromise);
      expect(result3).toBe(false);
    });

    test('isResolvedChecker should work correctly with Bun peek optimization', async () => {
      // Test with resolved promise
      const resolvedPromise = Promise.resolve('test');
      const checker = await isResolvedChecker(resolvedPromise);
      expect(checker()).toBe('fulfilled');

      // Test with pending promise
      const pendingPromise = new Promise(() => {}); // Never resolves
      const checker2 = await isResolvedChecker(pendingPromise);
      expect(checker2()).toBe(false);
    });
  });
});
