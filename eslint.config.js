import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist', 'src-tauri/target', '.edge-cdp', '.edge-preview', '.npm-cache', 'e2e/node_modules', 'e2e/results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.{ts,tsx}'], languageOptions: { globals: globals.browser }, plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh }, rules: { ...reactHooks.configs.recommended.rules, 'react-refresh/only-export-components': ['warn', { allowConstantExport: true }] } },
  { files: ['e2e/**/*.mjs', 'scripts/**/*.mjs'], languageOptions: { globals: { ...globals.node, ...globals.browser, ...globals.mocha, browser: 'readonly', $: 'readonly', $$: 'readonly', expect: 'readonly' } } },
);
