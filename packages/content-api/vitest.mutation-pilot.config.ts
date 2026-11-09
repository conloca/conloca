import { defineConfig } from 'vitest/config';

/**
 * Vitest config for the Stryker mutation pilot ONLY. Not used by the
 * package's normal `content-api:test` Nx target, which stays `bun test` per
 * the single-runner policy; this file exists solely because Stryker's
 * official vitest-runner cannot drive `bun:test`.
 *
 * The merge engine's own `bun:test` files run here unchanged: `bun:test` is
 * aliased to `vitest`, whose `describe`/`it`/`expect` they use the same way.
 * That lends the mutation lane the real suites without moving them off Bun.
 *
 * Scope matches `stryker.pilot.config.mjs`'s `mutate` list: only
 * `src/vxjson.ts` and `src/merge/**` are mutated, so only their specs run
 * here — not the whole package's test/ directory.
 */
export default defineConfig({
  resolve: { alias: { 'bun:test': 'vitest' } },
  test: {
    globals: false,
    environment: 'node',
    include: ['test/vxjson.mutation-pilot.vitest.ts', 'test/merge/*.test.ts'],
  },
});
