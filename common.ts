/**
 * Base error class for all CRNT (Current) library errors
 */
export class CrntError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CrntError';
  }
}
