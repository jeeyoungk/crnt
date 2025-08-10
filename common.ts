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
}
