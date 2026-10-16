import { fileURLToPath } from 'node:url';
import ttsc from '@ttsc/unplugin/bun';
import { type BunPlugin, plugin } from 'bun';

/**
 * Native Typia transform for this package's Bun test lane.
 *
 * `src/schemas/validators.ts` is the only module that authors
 * `typia.createValidate<T>()` call sites, and spec 12 §The test chain requires
 * the transform to run in the test pipeline exactly as it does in the tsdown
 * build — so the generated validators under test are the shipped ones, never a
 * double.
 *
 * Scoped to the schemas directory: ttsc compiles what it is handed with the
 * full TypeScript program, and handing it this package's whole (pre-existing,
 * separately type-checked) test tree makes an unrelated `lib`/`types` mismatch
 * in those files fail the run.
 */
const ownedModules = /[\\/]src[\\/]schemas[\\/]/;

function scopeToOwnedModules(base: BunPlugin): BunPlugin {
  return {
    name: base.name,
    setup(builder) {
      return base.setup({
        ...builder,
        onLoad: (constraints, callback) => builder.onLoad({ ...constraints, filter: ownedModules }, callback),
      });
    },
  };
}

plugin(scopeToOwnedModules(ttsc({ project: fileURLToPath(new URL('./tsconfig.native-test.json', import.meta.url)) })));
