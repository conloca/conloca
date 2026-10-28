// @ts-check
import node from '@astrojs/node';
import react from '@astrojs/react';
import { conlocaCMS } from '@conloca/astro-cms/node';
import { conlocaCloud } from '@conloca/cloud-astro';
import { defineConfig } from 'astro/config';
import { schemaTypia } from './typia-vite.mjs';

// https://astro.build/config
export default defineConfig({
  site: 'https://example.conloca.com',
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [
    react(),
    conlocaCMS({
      contentRoot: './content',
      canvasDir: './canvas',
      // Same sheet the Layout imports: the option feeds the canvas/sandbox
      // registry, the Layout import feeds the page graph + discovery
      // endpoints. Both channels carrying one file mirrors how real sites
      // wire prose CSS, so the editor surfaces and the rendered page agree.
      siteStyles: './src/styles/prose.css',
      // The fragment editor discovers styles against a representative page;
      // the default (`/`) has no page in this example. The parity fixture
      // page embeds the fragment, so it IS the representative context.
      fragmentPreviewRoute: '/prose-parity',
      puckConfigPath: './src/puck.config.tsx',
      // Same module content.config.ts imports `dataSchemas` from: the option
      // feeds the editor's entry forms, the import feeds build validation and
      // entry types. The one object is the contract — keep both pointing at it.
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
    // Writes the editor page to /_conloca/editor/. CONLOCA_ENDPOINT points it at another editor
    // (a local one during development); unset, the default endpoint applies.
    conlocaCloud({ endpoint: process.env.CONLOCA_ENDPOINT, repoUri: 'dev/dev-site' }),
  ],
  vite: {
    // Generates the validators and form metadata in src/schemas/data.ts.
    plugins: [...schemaTypia()],
    // Monorepo development (not needed for published packages)
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
