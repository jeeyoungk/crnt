/**
 * Base error class for all CRNT (Current) library errors
 */
export class CrntError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CrntError';
  }
}

/** Common options for many crnt functions. */
export interface Options {
  /** same signature as fetch(), but for aborting operations */
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
  if (timeout == null && signal == null) {
    return undefined;
  } else if (timeout == null) {
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
  let resolved = false;
  promise.then(
    () => (resolved = true),
    () => (resolved = true)
  );
  await Promise.resolve();
  return () => resolved;
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
