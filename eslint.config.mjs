import js from '@eslint/js';
import react from 'eslint-plugin-react';

export default [
  { ignores: ['.next/**', 'node_modules/**', '.venv/**', 'data/**'] },
  {
    ...js.configs.recommended,
    files: ['lib/**/*.mjs', 'tests/**/*.mjs', 'eval/**/*.mjs', 'app/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        process: 'readonly', console: 'readonly', Buffer: 'readonly',
        fetch: 'readonly', AbortSignal: 'readonly', TextDecoder: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', URL: 'readonly',
        window: 'readonly', document: 'readonly',
      },
    },
    plugins: { react },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react/jsx-uses-vars': 'error',
    },
  },
];
