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
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  if (signal == null) {
    return controller.signal;
  }
  signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timeoutId);
      controller.abort(signal.reason);
    },
    { once: true }
  );
  return AbortSignal.any([controller.signal, signal]);
}

/**
 * Create a function that checks whether a given promise is resolved or not.
 *
 * Note: the returned function is synchronous, and within the same microtask boundary, it's guaranteed to return the same value.
 */
export async function isResolvedChecker(
  promise: Promise<unknown>
): Promise<() => boolean> {
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
    state.resolved = true;
    promiseMapInternal.delete(promise);
  };
  promise.then(done, done);
  await Promise.resolve(); // microtask
  return state.isResolved;
}

/**
 * Check whether a promise is resolved or not.
 *
 * Note: if this is repeatedly called over a long-running (or even potentially forever-running) promise,
 * it's recommended to use {@link isResolvedChecker} instead.
 */
export async function isResolved(promise: Promise<unknown>): Promise<boolean> {
  return (await isResolvedChecker(promise))();
}

type PromiseState = {
  resolved: boolean;
  isResolved: () => boolean;
};

/** track the resolved state of the promises. is used to make isResolvedChecker more efficient. */
export const promiseMapInternal = new Map<Promise<unknown>, PromiseState>();
