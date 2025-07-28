// @ts-check
import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // TypeScript rules
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
      
      // Completely disable all formatting/prettier rules
      'prettier/prettier': 'off',
      '@typescript-eslint/indent': 'off',
      'indent': 'off',
      'quotes': 'off',
      'semi': 'off',
      'comma-dangle': 'off',
      'max-len': 'off',
      'object-curly-spacing': 'off',
      'array-bracket-spacing': 'off',
      'space-before-function-paren': 'off',
      'no-trailing-spaces': 'off',
      'no-multiple-empty-lines': 'off',
      'eol-last': 'off',
      'linebreak-style': 'off',
      'no-tabs': 'off',
      'space-in-parens': 'off',
      'comma-spacing': 'off',
      'key-spacing': 'off',
      'keyword-spacing': 'off',
      'space-infix-ops': 'off',
      'space-unary-ops': 'off',
      'space-before-blocks': 'off',
      'brace-style': 'off',
      'block-spacing': 'off',
      'object-curly-newline': 'off',
      'function-paren-newline': 'off',
      'newline-per-chained-call': 'off',
      'padded-blocks': 'off',
      'lines-between-class-members': 'off',
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);