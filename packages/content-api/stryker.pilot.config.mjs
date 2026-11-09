// @ts-check
/**
 * Stryker mutation pilot config.
 * Piloted on content-api before any wider rollout. Run manually via
 * `nx run content-api:mutation` — deliberately OUTSIDE the default
 * build/lint/test pipelines: mutation testing runs nightly on scoped modules,
 * off the normal development loop.
 *
 * Scope: `src/vxjson.ts` and `src/merge/**` — the VxJSON/content-write path
 * and the merge engine every writer calls. content-api/src is ~11k lines; a
 * full-package run would plausibly exceed the ~20min budget this task set,
 * so the pilot narrows to a few meaningful, well-tested modules rather
 * than running (and timing out) across the whole package.
 *
 * Test runner: @stryker-mutator/vitest-runner, pointed at a DEDICATED
 * vitest config (vitest.mutation-pilot.config.ts) that runs only
 * vxjson.mutation-pilot.vitest.ts and the merge engine's `bun:test` files
 * (test/merge/*.test.ts, with `bun:test` aliased to `vitest`) — not the
 * whole package suite, and the package's `test` target stays on Bun. This
 * keeps the pilot honest: mutants are killed by real assertions against
 * real shipped code, not a thinner reimplementation.
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  // Explicit bare specifiers, NOT the "@stryker-mutator/*" glob default:
  // Stryker's plugin loader resolves the glob relative to its OWN install
  // directory (core/dist/src/di/plugin-loader.js's globPluginModules walks
  // "../../../../../" from itself, then lists that directory's
  // @stryker-mutator/* siblings). Under Bun's isolated/hoisted install
  // layout, @stryker-mutator/core lives in its own store directory whose
  // only @stryker-mutator/* siblings are api/instrumenter/util — vitest-runner
  // is installed under this package's own node_modules instead, so the glob
  // silently resolves to zero plugins ("Cannot find TestRunner plugin
  // 'vitest'"). Naming the plugin explicitly takes the bare-import-specifier
  // path instead, which resolves normally from this package's node_modules.
  plugins: ['@stryker-mutator/vitest-runner'],
  packageManager: 'npm',
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.mutation-pilot.config.ts',
  },
  mutate: ['src/vxjson.ts', 'src/merge/**/*.ts'],
  reporters: ['clear-text', 'progress'],
  coverageAnalysis: 'perTest',
  tempDirName: '.stryker-tmp',
};
