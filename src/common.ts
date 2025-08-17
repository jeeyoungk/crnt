import type * as Bun from 'bun';

/**
 * @categoryDescription Common
 * Common functions and types.
 * @module
 */

/**
 * Base error class for all CRNT (Current) library errors
 */
export class CrntError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CrntError';
  }
}

/**
 * Error thrown when attempting to enqueue to a closed queue
 */
export class QueueClosedError extends CrntError {
  constructor(message: string = 'Queue is closed', options?: ErrorOptions) {
    super(message, options);
    this.name = 'QueueClosedError';
  }
}

/**
 * Common options for crnt operations. This controls the timeout and cancellation behavior of a given function.
 *
 * @category Common
 */
export interface Options {
  /** same signature as fetch(), but for aborting operations. If provided, the operation will be aborted when the signal is aborted. */
  signal?: AbortSignal;
  /** timeout in milliseconds. This works in tandem with the {@link signal} option, whichever triggers first (signal or timeout) will abort the operation. */
  timeout?: number;
}

export function _makeAbortSignal(
  options: Options | undefined
): AbortSignal | undefined {
  if (options == null) {
    return undefined;
  }
  const { signal, timeout } = options;
  if (timeout == null) {
    return signal;
  }
  const controller = new AbortController();
  const clear = withTimeout(controller, timeout);
  if (signal == null) {
    return controller.signal;
  }
  signal.addEventListener(
    'abort',
    () => {
      clear();
      controller.abort(signal.reason);
    },
    { once: true }
  );
  return AbortSignal.any([controller.signal, signal]);
}

/**
 * Detect if we're running in Bun runtime
 */
export function isBunRuntime(): boolean {
  return typeof (globalThis as { Bun?: typeof Bun }).Bun !== 'undefined';
}

/**
 * Get Bun's peek function if available
 */
function getBunPeek(): {
  status(promise: Promise<unknown>): 'pending' | 'fulfilled' | 'rejected';
} | null {
  if (!isBunRuntime()) {
    return null;
  }

  try {
    // Try to access Bun's peek from the global Bun object
    const peek = (globalThis as { Bun?: typeof Bun }).Bun?.peek;
    if (peek && typeof peek.status === 'function') {
      return peek;
    }
  } catch {
    // Ignore errors and fall back to manual tracking
  }

  return null;
}

/**
 * Create a function that checks whether a given promise is resolved or not.
 *
 * Note: the returned function is synchronous, and within the same microtask boundary, it's guaranteed to return the same value.
 *
 * @category Promise
 */
export async function isResolvedChecker(
  promise: Promise<unknown>
): Promise<() => Resolved> {
  // Use Bun's peek.status() method if available for better performance
  const bunPeek = getBunPeek();
  if (bunPeek) {
    return () => {
      const status = bunPeek.status(promise);
      if (status === 'pending') {
        return false;
      }
      return status;
    };
  }

  // Fallback to manual tracking for other runtimes
  const existingState = promiseMapInternal.get(promise);
  if (existingState != null) {
    return existingState.isResolved;
  }
  const state: PromiseState = {
    resolved: false,
    isResolved: () => state.resolved,
  };
  promiseMapInternal.set(promise, state);
  const done = () => {
    state.resolved = 'fulfilled';
    promiseMapInternal.delete(promise);
  };
  const onrejected = () => {
    state.resolved = 'rejected';
    promiseMapInternal.delete(promise);
  };
  promise.then(done, onrejected);
  await Promise.resolve(); // microtask
  return state.isResolved;
}

/**
 * Check whether a promise is resolved or not.
 *
 * The returned promise should be resolved within a microtask boundary.
 *
 * @category Promise
 * @returns
 * - `false` If the promise is not resolved yet
 * - `'fulfilled'` If the promise is resolved
 * - `'rejected'` If the promise is rejected.
 */
export async function isResolved(
  promise: Promise<unknown>
): Promise<false | 'fulfilled' | 'rejected'> {
  // Use Bun's peek.status() method directly if available for synchronous checking
  const bunPeek = getBunPeek();
  if (bunPeek) {
    const status = bunPeek.status(promise);
    if (status === 'pending') {
      return false;
    }
    return status;
  }

  // Fallback to async checking for other runtimes
  return (await isResolvedChecker(promise))();
}

type PromiseState = {
  resolved: Resolved;
  isResolved: () => Resolved;
};

/** track the resolved state of the promises. is used to make isResolvedChecker more efficient. */
export const promiseMapInternal = new Map<Promise<unknown>, PromiseState>();

export type Resolved = Awaited<ReturnType<typeof isResolved>>;

/**
 * Configure a given abort controller to abort after a given timeout.
 *
 * @returns Triggers the timeout.
 */
export function withTimeout(
  ctrl: AbortController,
  timeout: number
): () => void {
  const timeoutId = setTimeout(() => ctrl.abort(), timeout);
  const clear = () => clearTimeout(timeoutId);
  ctrl.signal.addEventListener('abort', clear, { once: true });
  return clear;
}
