import eslintPluginAstro from 'eslint-plugin-astro';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['node_modules/**', 'dist/**', '.astro/**'],
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
      },
    },
  },
  ...eslintPluginAstro.configs.recommended,
  {
    files: ['**/*.astro'],
    languageOptions: {
      parser: eslintPluginAstro.parser,
      parserOptions: {
        parser: '@typescript-eslint/parser',
        extraFileExtensions: ['.astro'],
      },
    },
  },
  // Type-aware rules for every target's sources. `no-misused-promises` on
  // conditionals is the one that matters: a check that became async
  // (`if (!isAllowed(request))`) is a Promise, which is always truthy, and
  // TypeScript accepts it, so the check silently passes everything. A type
  // error at the call site is the only durable guard against a dependency's
  // sync→async change.
  {
    files: ['targets/*/src/**/*.ts', 'targets/*/src/**/*.tsx'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-misused-promises': ['error', { checksConditionals: true, checksVoidReturn: false }],
      '@typescript-eslint/await-thenable': 'error',
    },
  },
  // WHY: each target's tests (and stories) live in tsconfig.test.json, which
  // the solution tsconfig.json does not reference. The project service's
  // tsserver-style walk only finds tsconfig.json, so `*.test.ts(x)` under
  // src/ report "not found by the project service". Point them at the test
  // projects explicitly rather than widening the build tsconfig includes.
  {
    files: [
      'targets/*/src/**/*.test.ts',
      'targets/*/src/**/*.test.tsx',
      'targets/*/src/**/*.spec.ts',
      'targets/*/src/**/*.spec.tsx',
      'targets/*/src/**/*.stories.tsx',
    ],
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: false,
        project: ['targets/*/tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-misused-promises': ['error', { checksConditionals: true, checksVoidReturn: false }],
      '@typescript-eslint/await-thenable': 'error',
    },
  },
];
