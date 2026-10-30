import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ttsc from '@ttsc/unplugin/vite';
import type { Plugin } from 'vite';

const project = fileURLToPath(new URL('../tsconfig.native-test.json', import.meta.url));
const fixtureModules = /[\\/]test[\\/]fixtures[\\/]typia[\\/]/;
const typiaRoot = dirname(createRequire(import.meta.url).resolve('typia/package.json'));

/**
 * Native Typia transform for the host-schema fixtures stories render forms
 * from — the same modules and program `test-native-preload.ts` compiles for
 * the Bun tests. Scoped to `test/fixtures/typia/`: ttsc type-checks the
 * program it is handed, and the rest of the catalog is plain TSX.
 */
export function typiaFixtures(): Plugin[] {
  const created = ttsc({ project });
  const plugins: Plugin[] = Array.isArray(created) ? created : [created];
  const scoped = plugins.map((plugin) => {
    const transform = plugin.transform;
    if (!transform) return plugin;
    if (typeof transform === 'function') {
      return { ...plugin, transform: { handler: transform, filter: { id: fixtureModules } } };
    }
    return { ...plugin, transform: { ...transform, filter: { ...transform.filter, id: fixtureModules } } };
  });
  // ttsc 0.34.1 adds dependency-scan hooks that ignore the filter above and stall Vite's cold scan for ~60s.
  const dropScan: Plugin = {
    name: 'typia-fixtures:no-ttsc-dependency-scan',
    configResolved(config) {
      type ScanBackend = { plugins?: ({ name?: string } | null)[] };
      // Vitest's Vite 8 scans through `rolldownOptions`, which these (Storybook's Vite 7) types lack.
      const all = [config.optimizeDeps, ...Object.values(config.environments ?? {}).map((env) => env.optimizeDeps)] as {
        esbuildOptions?: ScanBackend;
        rolldownOptions?: ScanBackend;
      }[];
      for (const backend of all.flatMap((deps) => [deps?.esbuildOptions, deps?.rolldownOptions])) {
        if (!Array.isArray(backend?.plugins)) continue;
        backend.plugins = backend.plugins.filter((p) => !p?.name?.startsWith('ttsc-dependency-'));
      }
    },
  };
  return [...scoped, dropScan];
}

/**
 * The transform emits deep imports of Typia's runtime helpers, which Vite's
 * dependency scan cannot see in the untransformed fixtures. A helper found
 * mid-run makes Vite re-optimize and reload the browser, failing every story
 * in flight, so the catalog pre-bundles all of them up front.
 */
export const typiaRuntimeHelpers = readdirSync(join(typiaRoot, 'lib', 'internal'))
  .filter((file) => file.endsWith('.mjs'))
  .map((file) => `typia/lib/internal/${file.slice(0, -'.mjs'.length)}`);
