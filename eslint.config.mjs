// ESLint 10 flat config — replaces the legacy .eslintrc.cjs.
//
// Why flat config: ESLint 10 removes legacy config support entirely, and
// even on ESLint 9 the flat API is the only one that picks up new plugins'
// rules without `eslintrc`-style overrides. The same rule set we used in the
// .eslintrc.cjs is reproduced below so behavior is identical:
//
//   * @typescript-eslint/no-unused-vars  → error, `_`-prefixed args ignored
//   * @typescript-eslint/explicit-function-return-type → off
//   * no-console → warn (allow `warn`/`error`)
//
// `eslint .` is run by the `lint` script (package.json). Vitest globals
// (describe/it/expect/beforeAll/etc.) are declared via `tsconfig.json`'s
// `"types": ["vitest/globals"]`, so they're available in spec files at
// lint time without an explicit import.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default [
  {
    ignores: [
      'dist/**',

      'release/**',
      'node_modules/**',
      'eslint.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'specs/**/*.ts'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
]