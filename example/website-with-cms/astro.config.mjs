// @ts-check
import node from '@astrojs/node';
import { conlocaCMS } from '@conloca/astro-cms/node';
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [
    react(),
    conlocaCMS({
      contentRoot: './content',
      canvasDir: './canvas',
      puckConfigPath: './src/puck.config.tsx',
      schemasPath: './src/schemas/data.ts',
      assetsPath: './public/assets',
      routing: {
        routes: {
          pages: {
            pattern: '/[...slug]',
            collection: 'pages',
            layout: './src/layouts/Layout.astro',
          },
        },
        fallback: '404',
        siteName: 'default',
        locale: 'en',
      },
    }),
  ],
  // Vite config for monorepo development (not needed for published packages)
  vite: {
    server: {
      watch: {
        // Watch CMS dist folder for HMR during local development
        ignored: ['!**/node_modules/@conloca/cms-spa/dist/**'],
      },
      fs: {
        // Allow serving files from workspace root
        allow: ['../..'],
      },
    },
  },
});
