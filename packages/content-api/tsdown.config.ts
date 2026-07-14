import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    node: 'src/node.ts',
    reader: 'src/reader.ts',
    'schemas/index': 'src/schemas/index.ts',
  },
  format: ['esm'],
  dts: true,
  tsconfig: 'tsconfig.lib.json',
  clean: false,
  // vite is externalized because node.ts exports the vite plugin, which imports from 'vite'.
  // Without this, tsdown bundles vite and all its transitive deps (rollup, esbuild, postcss, etc.)
  // into the output. Consumers always have vite installed already.
  external: ['xxhash-wasm', 'vite'],
});
