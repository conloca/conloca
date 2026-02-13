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
    'astro',
    'astro:content',
    'vite',
    '@conloca/content-api',
    '@conloca/content-api-client',
    '@conloca/cms-spa',
    '@conloca/mdx',
    '@puckeditor/core',
    '@vitejs/plugin-react',
    'react',
    'react-dom',
    /^virtual:/,
  ],
});
