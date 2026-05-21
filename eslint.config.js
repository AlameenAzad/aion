// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const prettierConfig = require('eslint-config-prettier');

module.exports = tseslint.config(
  // Ignore generated and config files
  {
    ignores: ['dist/**', 'node_modules/**', 'jest.config.js', 'tsup.config.ts'],
  },

  // Base JS rules
  eslint.configs.recommended,

  // TypeScript rules
  ...tseslint.configs.recommended,

  // Project-specific overrides
  {
    rules: {
      // Warn rather than error on `any` — CLI tools sometimes need escape hatches
      '@typescript-eslint/no-explicit-any': 'warn',

      // Ignore unused vars prefixed with _
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // CJS project — require() is fine outside of src
      '@typescript-eslint/no-require-imports': 'off',

      // Allow empty catch blocks when the var is prefixed with _
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },

  // Test files get relaxed rules
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Disable all formatting rules (Prettier owns those)
  prettierConfig
);
