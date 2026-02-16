import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    hydration: 'src/hydration.ts',
    components: 'src/components.ts',
    'cms-handler': 'src/cms-handler.ts',
    collections: 'src/collections.ts',
    'lib/hydration-script': 'src/lib/hydration-script.ts',
  },
  format: ['esm'],
  dts: true,
  tsconfig: 'tsconfig.lib.json',
  clean: true,
  external: [
    // Virtual modules not in package.json — must be explicitly externalized
    'astro:content',
    /^virtual:/,
  ],
});
