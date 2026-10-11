/**
 * Polyfill for TC39 Explicit Resource Management
 * https://github.com/tc39/proposal-explicit-resource-management
 *
 * This provides Symbol.dispose and Symbol.asyncDispose constants for Node 20
 * where these symbols may not be available natively.
 */

/**
 * Symbol for synchronous disposal - use this instead of Symbol.dispose
 */
export const disposeSymbol: typeof Symbol.dispose =
  typeof Symbol.dispose !== 'undefined'
    ? Symbol.dispose
    : (Symbol.for('Symbol.dispose') as typeof Symbol.dispose);

/**
 * Symbol for asynchronous disposal - use this instead of Symbol.asyncDispose
 */
export const asyncDisposeSymbol: typeof Symbol.asyncDispose =
  typeof Symbol.asyncDispose !== 'undefined'
    ? Symbol.asyncDispose
    : (Symbol.for('Symbol.asyncDispose') as typeof Symbol.asyncDispose);

/**
 * Interface for objects that can be disposed synchronously using our module symbols
 */
export interface Disposable {
  [disposeSymbol](): void;
}

/**
 * Interface for objects that can be disposed asynchronously using our module symbols
 */
export interface AsyncDisposable {
  [asyncDisposeSymbol](): PromiseLike<void>;
}
