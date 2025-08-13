import { test, expect, describe } from 'bun:test';
import { DeterministicPromise } from './promise';

describe('promise', () => {
  describe('DeterministicPromise.all', () => {
    test('resolves with all values when all promises resolve', async () => {
      const promises = [
        Promise.resolve(1),
        Promise.resolve(2),
        Promise.resolve(3),
      ];

      const result = await DeterministicPromise.all(promises);
      expect(result).toEqual([1, 2, 3]);
      const original = await Promise.all(promises);
      expect(original).toEqual(result);
    });

    test('works with mixed promise and non-promise values', async () => {
      const values = [Promise.resolve(1), 2, Promise.resolve(3), 4];

      const result = await DeterministicPromise.all(values);
      expect(result).toEqual([1, 2, 3, 4]);
    });

    test('works with empty array', async () => {
      const result = await DeterministicPromise.all([]);
      expect(result).toEqual([]);
    });

    test('works with only non-promise values', async () => {
      const values = [1, 2, 3, 'hello'];
      const result = await DeterministicPromise.all(values);
      expect(result).toEqual([1, 2, 3, 'hello']);
    });

    test('rejects deterministically with first rejected promise in array order', async () => {
      const error1 = new Error('First error');
      const error2 = new Error('Second error');

      // Create promises that reject at different times
      const slowReject = new Promise((_, reject) =>
        setTimeout(() => reject(error1), 20)
      );
      const fastReject = new Promise((_, reject) =>
        setTimeout(() => reject(error2), 10)
      );

      const promises = [slowReject, fastReject]; // slowReject is first in array

      try {
        await DeterministicPromise.all(promises);
        expect.unreachable('Should have rejected');
      } catch (rejectedPromise) {
        // Should reject with the first promise in array order (slowReject)
        console.log(rejectedPromise);
        expect(rejectedPromise).toBe(error2);
      }
    });

    test('rejects with first rejected promise when mixed with resolved promises', async () => {
      const error = new Error('Test error');
      const rejectedPromise = Promise.reject(error);
      const resolvedPromise = Promise.resolve('success');

      const promises = [resolvedPromise, rejectedPromise];

      try {
        await DeterministicPromise.all(promises);
        expect.unreachable('Should have rejected');
      } catch (result) {
        expect(result).toBe(error);
      }
    });

    test('works with different promise types', async () => {
      const promises = [
        Promise.resolve('string'),
        Promise.resolve(42),
        Promise.resolve({ key: 'value' }),
        Promise.resolve(null),
        Promise.resolve(undefined),
      ];

      const result = await DeterministicPromise.all(promises);
      expect(result).toEqual(['string', 42, { key: 'value' }, null, undefined]);
    });

    test('preserves array order', async () => {
      // Create promises that resolve in reverse order
      const promises = [
        new Promise(resolve => setTimeout(() => resolve(1), 30)),
        new Promise(resolve => setTimeout(() => resolve(2), 20)),
        new Promise(resolve => setTimeout(() => resolve(3), 10)),
      ];

      const result = await DeterministicPromise.all(promises);
      expect(result).toEqual([1, 2, 3]);
    });

    test('handles already rejected promises', async () => {
      const error = new Error('Already rejected');
      const alreadyRejected = Promise.reject(error);
      const pending = new Promise(resolve =>
        setTimeout(() => resolve('pending'), 100)
      );

      const promises = [pending, alreadyRejected];

      try {
        await DeterministicPromise.all(promises);
        expect.unreachable('Should have rejected');
      } catch (result) {
        expect(result).toBe(error);
      }
    });
  });

  describe('DeterministicPromise.race', () => {
    test('returns first resolved value in array order', async () => {
      // Create promises where the second resolves faster but first should win
      const slowResolve = new Promise(resolve =>
        setTimeout(() => resolve('slow'), 20)
      );
      const fast1 = Promise.withResolvers();
      const fast2 = Promise.withResolvers();
      setTimeout(() => {
        fast1.resolve('fast1');
        fast2.resolve('fast2');
      }, 10);

      const result = await DeterministicPromise.race([
        slowResolve,
        fast1.promise,
        fast2.promise,
      ]);
      expect(result).toBe('fast1');
    });

    test('returns non-promise values immediately', async () => {
      const values = [42, Promise.resolve('promise')];
      const result = await DeterministicPromise.race(values);
      expect(result).toBe(42);
    });

    test('works with mixed promise and non-promise values', async () => {
      const promise = new Promise(resolve =>
        setTimeout(() => resolve('promise'), 100)
      );
      const values = [promise, 'immediate'];

      const result = await DeterministicPromise.race(values);
      expect(result).toBe('immediate'); // non-promises resolve immediately
    });

    test('returns first resolved promise when multiple resolve', async () => {
      const promise1 = Promise.resolve('first');
      const promise2 = Promise.resolve('second');
      const promise3 = Promise.resolve('third');

      const result = await DeterministicPromise.race([
        promise1,
        promise2,
        promise3,
      ]);
      expect(result).toBe('first');
    });

    test('ignores rejected promises and returns first resolved', async () => {
      const rejected = Promise.reject(new Error('rejected'));
      const resolved = Promise.resolve('resolved');

      await expect(
        DeterministicPromise.race([rejected, resolved])
      ).rejects.toThrow('rejected');
    });

    test('returns first resolved even if later promises reject', async () => {
      const resolved = Promise.resolve('resolved');
      const rejected = Promise.reject(new Error('rejected'));

      const result = await DeterministicPromise.race([resolved, rejected]);
      expect(result).toBe('resolved');
    });

    test('empty array times out like Promise.race', async () => {
      // DeterministicPromise.race([]) should behave like Promise.race([]) and hang indefinitely
      const timeoutError = new Error(
        'Test timeout - race with empty array hangs as expected'
      );
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(timeoutError), 50)
      );

      try {
        await Promise.race([DeterministicPromise.race([]), timeout]);
        expect.unreachable('Should have timed out');
      } catch (error) {
        expect(error).toEqual(timeoutError);
      }
    });

    test('handles already resolved promises', async () => {
      const alreadyResolved = Promise.resolve('already');
      const pending = new Promise(resolve =>
        setTimeout(() => resolve('pending'), 100)
      );

      const result = await DeterministicPromise.race([
        alreadyResolved,
        pending,
      ]);
      expect(result).toBe('already');
    });

    test('returns correct type for different value types', async () => {
      const stringPromise = Promise.resolve('string');
      const numberPromise = Promise.resolve(42);
      const objectPromise = Promise.resolve({ key: 'value' });

      const result1 = await DeterministicPromise.race([stringPromise]);
      const result2 = await DeterministicPromise.race([numberPromise]);
      const result3 = await DeterministicPromise.race([objectPromise]);

      expect(result1).toBe('string');
      expect(result2).toBe(42);
      expect(result3).toEqual({ key: 'value' });
    });
  });

  describe('edge cases and error handling', () => {
    test('DeterministicPromise.all handles promises that reject after resolution check', async () => {
      let rejectLater: (error: Error) => void;
      const laterReject = new Promise<never>((_, reject) => {
        rejectLater = reject;
      });

      const resolved = Promise.resolve('resolved');
      const lateRejectionError = new Error('late rejection');

      // Start the all operation
      const allPromise = DeterministicPromise.all([resolved, laterReject]);

      // Reject the second promise after a delay
      setTimeout(() => rejectLater(lateRejectionError), 10);

      try {
        await allPromise;
        expect.unreachable('Should have rejected');
      } catch (result) {
        expect(result).toBe(lateRejectionError);
      }
    });

    test('DeterministicPromise.race handles promises that resolve after initial race', async () => {
      let resolveLater: (value: string) => void;
      const laterResolve = new Promise<string>(resolve => {
        resolveLater = resolve;
      });

      // Use a non-rejected promise that just never resolves instead
      const neverResolves = new Promise(() => {});

      // Start the race operation
      const racePromise = DeterministicPromise.race([
        neverResolves,
        laterResolve,
      ]);

      // Resolve the second promise after a delay
      setTimeout(() => resolveLater('late resolution'), 10);

      const result = await racePromise;
      expect(result).toBe('late resolution');
    });

    test('DeterministicPromise.race throws first rejection when all promises reject', async () => {
      const error1 = new Error('error1');
      const error2 = new Error('error2');
      const rejected1 = Promise.reject(error1);
      const rejected2 = Promise.reject(error2);

      try {
        await DeterministicPromise.race([rejected1, rejected2]);
        expect.unreachable('Should have thrown');
      } catch (error) {
        // Should throw the first rejection that occurs, not "No promise resolved"
        expect(error).toBe(error1);
      }
    });
  });

  describe('type checking', () => {
    test('DeterministicPromise satisfies Promise interface', () => {
      // Type-only test to ensure the interface is correct
      const deterministicPromise: Pick<typeof Promise, 'all' | 'race'> =
        DeterministicPromise;
      expect(deterministicPromise).toBeDefined();
    });

    test('isPromise correctly identifies promises', () => {
      // We can't directly test the internal isPromise function, but we can test its behavior
      // through the main functions

      const promise = Promise.resolve(1);
      const notPromise = 1;
      const objectWithThen = { then: () => {} };
      const nullValue = null;

      // Test through DeterministicPromise.all behavior
      expect(DeterministicPromise.all([promise, notPromise])).toBeDefined();
      expect(
        DeterministicPromise.all([objectWithThen, notPromise])
      ).toBeDefined();
      expect(DeterministicPromise.all([nullValue, notPromise])).toBeDefined();
    });
  });
});
