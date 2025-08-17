import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    typecheck: {
      tsconfig: './tsconfig.json',
    },
  },
  resolve: {
    alias: {
      // allows vitest to run, while the imports are bun:test.
      'bun:test': 'vitest',
    },
  },
});
