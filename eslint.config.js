import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist'] },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.node },
    rules: js.configs.recommended.rules,
  },
  {
    // page.evaluate() callbacks run in the browser.
    files: ['scripts/e2e-*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
