import { test, expect, describe } from 'bun:test';
import {
  _makeAbortSignal,
  type Options,
  isResolvedChecker,
  isResolved,
} from './common';

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
    test('returns false for unresolved promise', async () => {
      const promise = new Promise(() => {}); // Never resolves
      const checker = await isResolvedChecker(promise);
      expect(checker()).toBe(false);
    });

    test('returns true for already resolved promise', async () => {
      const promise = Promise.resolve('success');
      const checker = await isResolvedChecker(promise);
      expect(checker()).toBe(true);
    });

    test('returns true for already rejected promise', async () => {
      const promise = Promise.reject(new Error('failed'));
      const checker = await isResolvedChecker(promise);
      expect(checker()).toBe(true);
    });

    test('returns true after promise resolves', async () => {
      let resolve: (value: string) => void;
      const promise = new Promise<string>(r => {
        resolve = r;
      });
      const checker = await isResolvedChecker(promise);

      expect(checker()).toBe(false);

      resolve!('success');
      await Promise.resolve(); // Let promise resolve

      expect(checker()).toBe(true);
    });

    test('returns true after promise rejects', async () => {
      let reject: (error: Error) => void;
      const promise = new Promise<string>((_, r) => {
        reject = r;
      });
      const checker = await isResolvedChecker(promise);

      expect(checker()).toBe(false);

      reject!(new Error('failed'));
      await Promise.resolve(); // Let promise reject

      expect(checker()).toBe(true);
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

      expect(checker()).toBe(true);
      expect(checker()).toBe(true);
    });
  });

  describe('isResolved', () => {
    test('returns false for unresolved promise', async () => {
      const promise = new Promise(() => {}); // Never resolves
      const result = await isResolved(promise);
      expect(result).toBe(false);
    });

    test('returns true for already resolved promise', async () => {
      const promise = Promise.resolve('success');
      const result = await isResolved(promise);
      expect(result).toBe(true);
    });

    test('returns true for already rejected promise', async () => {
      const promise = Promise.reject(new Error('failed'));
      const result = await isResolved(promise);
      expect(result).toBe(true);
    });

    test('returns false then true as promise resolves', async () => {
      let resolve: (value: string) => void;
      const promise = new Promise<string>(r => {
        resolve = r;
      });

      expect(await isResolved(promise)).toBe(false);

      resolve!('success');
      await Promise.resolve(); // Let promise resolve

      expect(await isResolved(promise)).toBe(true);
    });

    test('returns false then true as promise rejects', async () => {
      let reject: (error: Error) => void;
      const promise = new Promise<string>((_, r) => {
        reject = r;
      });

      expect(await isResolved(promise)).toBe(false);

      reject!(new Error('failed'));
      await Promise.resolve(); // Let promise reject

      expect(await isResolved(promise)).toBe(true);
    });

    test('works with different promise types', async () => {
      const stringPromise = Promise.resolve('hello');
      const numberPromise = Promise.resolve(42);
      const objectPromise = Promise.resolve({ key: 'value' });
      const nullPromise = Promise.resolve(null);
      const undefinedPromise = Promise.resolve(undefined);

      expect(await isResolved(stringPromise)).toBe(true);
      expect(await isResolved(numberPromise)).toBe(true);
      expect(await isResolved(objectPromise)).toBe(true);
      expect(await isResolved(nullPromise)).toBe(true);
      expect(await isResolved(undefinedPromise)).toBe(true);
    });
  });
});
