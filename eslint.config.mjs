// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/dist/', 'packages/specs/src/generated/'] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // `const { seq: _seq, ...rest } = row` is how a field is dropped.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true },
      ],
    },
  },
  // client-core's portable entry also runs in a browser worker (design,
  // Q13): Node stays in node-sqlite.ts, and in specs and their fixture.
  {
    files: ['packages/client-core/src/**/*.ts'],
    ignores: [
      'packages/client-core/src/node-sqlite.ts',
      'packages/client-core/src/test-store.ts',
      '**/*.spec.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*'],
              message: 'Node-only code belongs in node-sqlite.ts.',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', 'Buffer', 'process'],
    },
  },
  // Config files outside every tsconfig: syntax rules only.
  { files: ['**/*.{js,mjs}'], extends: [tseslint.configs.disableTypeChecked] },
);
