import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@apeiron/pack-*',
                '@apeiron/app',
                '**/pack-smartphone/**',
                '**/pack-archipelago/**',
                '**/apps/**',
              ],
              message: 'Core cannot import a pack or the app.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/pack-*/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@apeiron/core/*', '**/packages/core/src/**', '**/core/src/**'],
              message: 'Import @apeiron/core, not core internals.',
            },
          ],
        },
      ],
    },
  },
);
