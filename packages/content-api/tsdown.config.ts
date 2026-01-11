import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    node: 'src/node.ts',
    'schemas/index': 'src/schemas/index.ts',
  },
  format: ['esm'],
  // Disable dts generation - use tsc for declarations due to rolldown-plugin-dts issues
  dts: false,
  tsconfig: 'tsconfig.lib.json',
  clean: true,
  external: ['@node-rs/xxhash'],
});
