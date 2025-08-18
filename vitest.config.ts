import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    typecheck: {
      tsconfig: './tsconfig.json',
    },
    // Browser mode configuration
    browser: {
      enabled: false, // by default, false; enable it via CLI.
      provider: 'playwright',
      instances: [
        {
          browser: 'chromium',
        },
      ],
    },
    // Browser-specific configuration for fake timers
    fakeTimers: {
      // Fake timers work better in Node.js environment for these tests
      // Browser tests will use real timers for better compatibility
      toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
    },
  },
  resolve: {
    alias: {
      // allows vitest to run, while the imports are bun:test.
      'bun:test': 'vitest',
    },
  },
});
