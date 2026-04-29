import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import starlight from '@astrojs/starlight';
import { conlocaCMS } from '@conloca/astro-cms/node';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://conloca.com',
  integrations: [
    react(),
    starlight({
      title: 'Conloca CMS',
      description:
        'Visual editing for marketers, full git ownership for developers. File-based CMS powered by Puck with drag-and-drop components.',
      customCss: ['./src/styles/global.css', './src/styles/custom.css'],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/conloca/conloca' }],
      expressiveCode: { themes: ['starlight-dark', 'starlight-light'] },
      routeMiddleware: './src/route-data.ts',
      components: {
        ThemeSelect: './src/components/ThemeSelect.astro',
      },
      sidebar: [
        { label: 'Getting Started', slug: 'getting-started' },
        {
          label: 'Concepts',
          autogenerate: { directory: 'concepts' },
        },
        {
          label: 'Guides',
          items: [
            { label: 'Custom Blocks', slug: 'guides/custom-blocks' },
            {
              label: 'Authentication',
              autogenerate: { directory: 'guides/auth' },
            },
            {
              label: 'Deployment',
              autogenerate: { directory: 'guides/deploy' },
            },
          ],
        },
        {
          label: 'API Reference',
          autogenerate: { directory: 'reference/api' },
        },
        {
          label: 'Configuration',
          slug: 'reference/configuration',
        },
        {
          label: 'Packages',
          autogenerate: { directory: 'packages' },
        },
      ],
    }),
    conlocaCMS({
      contentRoot: './content',
      puckConfigPath: './src/puck.config.tsx',
      siteStyles: './src/styles/global.css',
      assetsPath: './public/assets',
      templates: {
        contentPage: {
          label: 'Content Page',
          component: 'ContentPageTemplate',
          description: 'Legal, policy, and content-heavy pages',
        },
      },
      routing: {
        routes: {
          pages: {
            pattern: '/[...slug]',
            collection: 'pages',
            layout: './src/layouts/CMSPageLayout.astro',
          },
        },
        fallback: 'passthrough',
        onConflict: 'warn',
        siteName: 'default',
        locale: 'en',
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
