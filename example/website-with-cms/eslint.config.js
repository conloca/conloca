import eslintPluginAstro from 'eslint-plugin-astro';

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
    rules: {
      // Add basic rules as needed
    },
  },
  // Astro files
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
];
