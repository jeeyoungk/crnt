import { install, type InstalledClock } from '@sinonjs/fake-timers';
import { CrntError, isResolved } from './common';

export const DEADLOCK_ERROR =
  'Test function is not resolved. This may mean a deadlock.';
/**
 * Helper for tests that need deterministic timing.
 */
export async function withFakeTimers<T>(
  testFn: (clock: InstalledClock) => Promise<T>
): Promise<T> {
  const clock = install();
  try {
    const p = testFn(clock);
    await clock.runAllAsync();
    const resolved = await isResolved(p);
    if (!resolved) {
      throw new CrntError(DEADLOCK_ERROR);
    }
    return await p;
  } finally {
    clock.uninstall();
  }
}
