import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'media/webview.js', 'node_modules/**', 'coverage/**', '.vscode-test/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'error',
    },
  },
  {
    // PRD §10 / Plan 01: the pure modules must stay runnable under plain Node so the anchoring
    // core can be tested without a VS Code host. This rule is the mechanical enforcement of that
    // constraint — it matters most from Phase 2 on, when `vscode` is a legitimate import one
    // directory over.
    files: ['src/anchor/**/*.ts', 'src/render/**/*.ts', 'src/prompt/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'vscode',
              message:
                'Pure modules (anchor/, render/, prompt/) must not import vscode — see PRD §10 Phase 1.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/test/**/*.ts'],
    rules: {
      // Perf tests report their measurements; that is the whole point of running them.
      'no-console': 'off',
    },
  },
);
