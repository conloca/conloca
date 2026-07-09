import { defineProject } from 'vitest/config';

/**
 * Vitest for content-api-client (spec 14 single-runner policy).
 *
 * esbuild `jsx: 'automatic'` must match this package's TypeScript setting
 * (`tsconfig*.json` → `"jsx": "react-jsx"`). Vitest's default esbuild mode is
 * classic JSX (`React.createElement`), which needs a runtime `React` in scope.
 * Our .tsx tests only type-import React and use JSX (e.g. QueryClientProvider
 * wrappers) — without automatic JSX they fail with `React is not defined`.
 * That is a transform mismatch, not dual-React / home node_modules.
 *
 * `environment: 'happy-dom'` replaces the old bunfig preload of
 * @happy-dom/global-registrator. setupFiles loads jest-dom matchers.
 */
export default defineProject({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'happy-dom',
    setupFiles: ['./test-setup.ts'],
  },
});
