import { defineProject } from 'vitest/config';

/**
 * Vitest for astro-cms (spec 14 single-runner policy).
 *
 * `resolve.conditions: ['production']` mirrors the old bun target's
 * `--conditions=production` (dual-package exports must resolve the same way
 * they did under bun). `environment: 'happy-dom'` + the jest-dom setupFile
 * replace the bunfig preload, which registered @happy-dom/global-registrator
 * by hand. All test files are plain `.ts` (no JSX), so no esbuild jsx tweak.
 */
export default defineProject({
  resolve: {
    conditions: ['production'],
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'happy-dom',
    setupFiles: ['./test-setup.ts'],
  },
});
