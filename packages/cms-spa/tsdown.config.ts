import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'puck-config': 'src/puck-config.ts',
    'page-schemas': 'src/page-schemas.ts',
    'data-schemas': 'src/data-schemas.ts',
  },
  format: ['esm'],
  dts: true,
  tsconfig: 'tsconfig.lib.json',
  clean: false, // CRITICAL: Don't delete dist/spa/main.css from SPA build
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    '@conloca/content-api',
    '@conloca/content-api-client',
    '@conloca/mdx',
    '@measured/puck',
    '@mdxeditor/editor',
    '@tanstack/react-query',
    '@tanstack/react-query-devtools',
    '@radix-ui/react-dialog',
    '@radix-ui/react-select',
    '@radix-ui/react-dropdown-menu',
    'react-router-dom',
    'lucide-react',
    'clsx',
    'tailwind-merge',
    'zod',
  ],
});
