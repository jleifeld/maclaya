import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'coverage/', 'web/src/components/ui/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
    },
  },
  { files: ['src/**/*.ts', 'tests/**/*.ts', '*.{js,mjs,ts}'], languageOptions: { globals: { ...globals.node, ...globals.jest } } },
  // jest.resetModules() tests load fresh module instances with require()
  { files: ['jest.config.js', 'tests/**/*.ts'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  {
    files: ['web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
