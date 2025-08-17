/**
 * @categoryDescription Data Structure
 * Concurrent data structures and primitives.
 * @module
 */
export {
  newSemaphore,
  type Semaphore,
  type SemaphorePermit,
} from './semaphore';
export {
  disposeSymbol,
  asyncDisposeSymbol,
  type Disposable,
  type AsyncDisposable,
} from './polyfill-explicit-resource-management';
export { newQueue, type Queue } from './queue';
export {
  type Options,
  CrntError,
  isResolvedChecker,
  isResolved,
} from './common';
export {
  newStream,
  type Stream,
  type StreamConfig,
  type MapOption,
  type BatchOption,
} from './stream';
export { toBufferedAsyncIterable } from './concurrent-iterator';
export { abortPromise, abortRace, sleep } from './abort';
export { parallelMap } from './util';

export { DeterministicPromise } from './promise';
