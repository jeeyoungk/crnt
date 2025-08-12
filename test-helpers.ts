import { install, type InstalledClock } from '@sinonjs/fake-timers';

// Helper for tests that need deterministic timing
export async function withFakeTimers<T>(
  testFn: (clock: InstalledClock) => T | Promise<T>
): Promise<T> {
  const clock = install();
  try {
    return await testFn(clock);
  } finally {
    clock.uninstall();
  }
}
