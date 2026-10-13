import { defineConfig } from 'vitest/config';

/**
 * Vitest config for the Stryker mutation pilot ONLY. Not used by the
 * package's normal `content-api:test` Nx target (that stays `bun test`, per the
 * single-runner policy carve-out for this pre-existing bun:test suite —
 * this file does not add a second permanent runner for the package's real
 * tests, it exists solely because Stryker's official vitest-runner cannot
 * drive `bun:test`).
 *
 * Scope matches `stryker.pilot.config.mjs`'s `mutate` list: only
 * `src/vxjson.ts` is mutated, so only its dedicated pilot spec needs to run
 * here — not the whole package's test/ directory.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/vxjson.mutation-pilot.vitest.ts'],
  },
});
