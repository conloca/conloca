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
      enableDevtools: true,
      queryClientOptions: {
        defaultOptions: {
          queries: {
            staleTime: 0, // Always fetch fresh data in dev
            refetchOnWindowFocus: true,
            refetchOnMount: true,
            retry: 0, // No retries for faster feedback
          },
        },
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
