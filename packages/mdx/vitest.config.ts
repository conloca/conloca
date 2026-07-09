import { defineProject } from 'vitest/config';

/**
 * Vitest for mdx (spec 14 single-runner policy).
 *
 * `resolve.conditions: ['production']` mirrors the old bun target's
 * `--conditions=production`: it is load-bearing, not cosmetic. The suite
 * asserts on @mdxeditor/editor's *production* export surface (e.g.
 * MDXEditorModal is undefined there) — resolving under the development
 * condition would surface different exports and break those assertions.
 *
 * esbuild `jsx: 'automatic'` matches this package's `"jsx": "react-jsx"`;
 * `environment: 'happy-dom'` replaces the old bunfig preload of
 * @happy-dom/global-registrator (happydom.ts).
 */
export default defineProject({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  resolve: {
    conditions: ['production'],
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'happy-dom',
  },
});
