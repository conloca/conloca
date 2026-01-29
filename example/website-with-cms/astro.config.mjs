// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import { conlocaCMS } from '@conloca/astro-cms';
import react from '@astrojs/react';

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
      dataSchemasPath: './src/schemas/data.ts',
      assetsPath: './public/assets',
      routing: true, // That's it - Conloca handles all routing
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
