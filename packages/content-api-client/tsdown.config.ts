import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    testing: 'src/testing.ts',
  },
  format: ['esm'],
  // Disable dts generation - use tsc for declarations due to rolldown-plugin-dts issues
  dts: false,
  tsconfig: 'tsconfig.lib.json',
  clean: true,
  external: ['@conloca/content-api', '@tanstack/react-query', 'react', 'react-dom'],
});
