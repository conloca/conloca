// @ts-check
/**
 * A93 Stryker mutation pilot config (spec 14 §Conformance tests, §Why these
 * decisions: "Pilot on content-api before rollout"). Run manually via
 * `nx run content-api:mutation` — deliberately OUTSIDE the default
 * build/lint/test pipelines (spec 14 §What runs when: "Nightly: Stryker on
 * scoped modules; ... off the loop").
 *
 * Scope: `src/vxjson.ts` only, per spec 14's own example of the mutation
 * scope ("VxJSON/content-write path"). content-api/src is ~11k lines; a
 * full-package run would plausibly exceed the ~20min budget this task set,
 * so the pilot narrows to one meaningful, already-well-tested module rather
 * than running (and timing out) across the whole package.
 *
 * Test runner: @stryker-mutator/vitest-runner, pointed at a DEDICATED
 * vitest config (vitest.mutation-pilot.config.ts) that runs only the new
 * vxjson.mutation-pilot.vitest.ts spec — NOT the package's real `bun test`
 * suite, which Stryker's vitest-runner cannot execute (bun:test is not
 * Vitest). This keeps the pilot honest: mutants are killed by real
 * assertions against real shipped code, not a thinner reimplementation.
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
  mutate: ['src/vxjson.ts'],
  reporters: ['clear-text', 'progress'],
  coverageAnalysis: 'perTest',
  tempDirName: '.stryker-tmp',
};
