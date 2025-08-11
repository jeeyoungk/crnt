/**
 *
 */

import { _makeAbortSignal, type Options, CrntError } from './common';

export interface Clock {
  sleep(ms: number, options: Options): Promise<void>;
  now(): number;
}

export function newDefaultClock(): DefaultClock {
  return new DefaultClock();
}

export function newFakeClock(initialTime = 0): FakeClock {
  const clock = new FakeClock();
  clock.setTime(initialTime);
  return clock;
}

export class DefaultClock implements Clock {
  now(): number {
    return Date.now();
  }

  async sleep(ms: number, options: Options = {}): Promise<void> {
    const signal = _makeAbortSignal(options);

    if (signal?.aborted) {
      throw new CrntError('Operation was aborted', { cause: signal.reason });
    }

    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        resolve();
      }, ms);

      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timeoutId);
          reject(
            new CrntError('Operation was aborted', { cause: signal.reason })
          );
        },
        { once: true }
      );
    });
  }
}

export class FakeClock implements Clock {
  private currentTime = 0;
  private sleepPromises: Map<number, SleepPromiseMetadata> = new Map();
  private nextPromiseId = 0;
  private advancing = false;

  now(): number {
    return this.currentTime;
  }

  async sleep(ms: number, options: Options = {}): Promise<void> {
    const signal = _makeAbortSignal(options);

    if (signal?.aborted) {
      throw new CrntError('Operation was aborted', { cause: signal.reason });
    }

    const promiseId = this.nextPromiseId++;
    const wakeupTime = this.currentTime + ms;

    return new Promise<void>((resolve, reject) => {
      const metadata: SleepPromiseMetadata = {
        resolve,
        reject,
        wakeupTime,
      };

      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            this.sleepPromises.delete(promiseId);
            reject(
              new CrntError('Operation was aborted', { cause: signal.reason })
            );
          },
          { once: true }
        );
      }

      this.sleepPromises.set(promiseId, metadata);
      
      // Schedule auto-advancement to happen after all synchronous sleep() calls are done
      if (!this.advancing) {
        process.nextTick(() => this.autoAdvanceTime());
      }
    });
  }

  private autoAdvanceTime(): void {
    if (this.advancing || this.sleepPromises.size === 0) {
      return;
    }

    this.advancing = true;

    try {
      while (this.sleepPromises.size > 0) {
        const nextWakeupTime = Math.min(
          ...Array.from(this.sleepPromises.values()).map(p => p.wakeupTime)
        );

        if (nextWakeupTime > this.currentTime) {
          this.currentTime = nextWakeupTime;
        }

        const toWakeup: [number, SleepPromiseMetadata][] = [];
        for (const [id, metadata] of this.sleepPromises.entries()) {
          if (metadata.wakeupTime <= this.currentTime) {
            toWakeup.push([id, metadata]);
          }
        }

        if (toWakeup.length === 0) {
          break;
        }

        for (const [id, metadata] of toWakeup) {
          this.sleepPromises.delete(id);
          process.nextTick(() => metadata.resolve());
        }
      }
    } finally {
      this.advancing = false;
    }
  }

  private processNextWakeup(): void {
    const toWakeup: [number, SleepPromiseMetadata][] = [];
    
    for (const [id, metadata] of this.sleepPromises.entries()) {
      if (metadata.wakeupTime <= this.currentTime) {
        toWakeup.push([id, metadata]);
      }
    }

    for (const [id, metadata] of toWakeup) {
      this.sleepPromises.delete(id);
      process.nextTick(() => metadata.resolve());
    }
  }

  advance(ms: number): void {
    this.currentTime += ms;
    this.processNextWakeup();
  }

  setTime(time: number): void {
    this.currentTime = time;
    this.processNextWakeup();
  }

  hasPendingPromises(): boolean {
    return this.sleepPromises.size > 0;
  }

  getPendingPromiseCount(): number {
    return this.sleepPromises.size;
  }
}
interface SleepPromiseMetadata {
  resolve: () => void;
  reject: (reason?: unknown) => void;
  wakeupTime: number;
  abortController?: AbortController;
}
