import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    testing: 'src/testing.ts',
  },
  format: ['esm'],
  dts: { build: true },
  tsconfig: 'tsconfig.lib.json',
  clean: true,
  external: ['@conloca/content-api', '@tanstack/react-query', 'react', 'react-dom'],
});
