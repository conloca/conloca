import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    hydration: 'src/hydration.ts',
    components: 'src/components.ts',
    'spa-handler': 'src/spa-handler.ts',
    'api/content-api-handler': 'src/api/content-api-handler.ts',
    collections: 'src/collections.ts',
    'lib/hydration-script': 'src/lib/hydration-script.ts',
  },
  format: ['esm'],
  dts: true,
  tsconfig: 'tsconfig.lib.json',
  clean: true,
  external: [
    'astro',
    'astro:content',
    '@conloca/content-api',
    '@conloca/content-api-client',
    '@conloca/cms-spa',
    '@conloca/mdx',
    '@measured/puck',
    '@vitejs/plugin-react',
    'react',
    'react-dom',
    /^virtual:/,
  ],
});
