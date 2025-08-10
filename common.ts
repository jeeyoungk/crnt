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
