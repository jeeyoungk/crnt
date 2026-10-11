import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import jsonSchemaValidator from 'eslint-plugin-json-schema-validator';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['dist/**', 'docs/**', 'node_modules/**'],
  },
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        NodeJS: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      // Abort helpers reject with `signal.reason` (typed `any`) unchanged, the
      // same value `signal.throwIfAborted()` throws. Match only-throw-error's
      // defaults, which already allow throwing `any`/`unknown`.
      '@typescript-eslint/prefer-promise-reject-errors': [
        'error',
        { allowThrowingAny: true, allowThrowingUnknown: true },
      ],
      // Prevent imports from dist directory
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                './dist',
                './dist/*',
                '../dist',
                '../dist/*',
                '**/dist',
                '**/dist/*',
              ],
              message:
                'Imports from /dist directory are not allowed. Import from source files instead.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      // Tests pass many `async x => x * 2`-style callbacks to APIs that take
      // `(x) => Promise<U>`; the missing `await` is intentional there.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // Plain JS config files are not part of the TypeScript program.
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  ...jsonSchemaValidator.configs['flat/recommended'],
  prettier
);
