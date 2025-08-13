/**
 * TODO (this doc is not rendering correctly).
 * Promise related utilities.
 *
 * Related docs
 *  - [microtask](https://developer.mozilla.org/en-US/docs/Web/API/HTML_DOM_API/Microtask_guide)
 * @categoryDescription Promise
 * @module
 */
import { CrntError, isResolved } from './common';

/** deterministic version of Promise.all */
async function all<T extends readonly unknown[] | []>(
  values: T
): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }> {
  try {
    return await Promise.all(values);
  } catch {
    // exception occurred, find the rejected promise.
    for (let i = 0; i < values.length; i++) {
      const value = values[i]!;
      if (!isPromise(value)) {
        continue;
      } else if ((await isResolved(value)) === 'rejected') {
        return Promise.reject(await value);
      }
    }
  }
  throw new CrntError('ASSERTION ERROR: Should not reach here.');
}

/** deterministic version of Promise.race */
async function race<T extends readonly unknown[] | []>(values: T) {
  try {
    await Promise.race(values);
  } catch {
    // suppress the exception.
  }
  // race finished, which means there is at least one resolved promise. find it in the array order.
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!;
    if (!isPromise(value)) {
      return value;
    } else if (await isResolved(value)) {
      return await value;
    }
  }
  throw new CrntError('ASSERTION ERROR: Should not reach here.');
}

function isPromise(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as Promise<unknown>).then === 'function'
  );
}

/**
 * Deterministic versions of Promise.all and Promise.race. Namely;
 *
 * - if there are multiple promises that it can resolved to (`all()` rejecting, or `race()` with multiple promises),
 *   then it would return the first element that it is resolved or rejected with.
 * - Note: this is as deterministic as possible. if there are promise resolutions that happen in a microtask boundary,
 *   then there may be some nondetermnism.
 * @category Promise
 */
export const DeterministicPromise = {
  all: all,
  race: race,
} satisfies Pick<typeof Promise, 'all' | 'race'>;
