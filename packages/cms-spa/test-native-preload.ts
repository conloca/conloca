import { fileURLToPath } from 'node:url';
import ttsc from '@ttsc/unplugin/bun';
import { type BunPlugin, plugin } from 'bun';

/**
 * Native Typia transform for the host-schema fixtures this package's tests
 * render forms from.
 *
 * `@conloca/cms-spa` authors no `typia.*` call sites of its own — host schemas
 * are generated in the host's build and reach the editor as values. The tests
 * need real host schemas, so the fixtures under `test/fixtures/typia/` author
 * them the way a site does, and this preload compiles exactly those modules.
 *
 * Scoped to that directory because ttsc type-checks the program it is handed,
 * and the package's wider test tree is type-checked by `typecheck-tests`.
 */
const ownedModules = /[\\/]test[\\/]fixtures[\\/]typia[\\/]/;

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
