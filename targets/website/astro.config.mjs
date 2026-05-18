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
      customCss: [
        './src/styles/global.css',
        './src/styles/code-blocks.css',
        './src/styles/asides.css',
        './src/styles/starlight-components.css',
        './src/styles/custom.css',
      ],
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
          items: [{ autogenerate: { directory: 'concepts' } }],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Custom Blocks', slug: 'guides/custom-blocks' },
            {
              label: 'Authentication',
              items: [{ autogenerate: { directory: 'guides/auth' } }],
            },
            {
              label: 'Deployment',
              items: [{ autogenerate: { directory: 'guides/deploy' } }],
            },
          ],
        },
        {
          label: 'API Reference',
          items: [{ autogenerate: { directory: 'reference/api' } }],
        },
        {
          label: 'Configuration',
          slug: 'configuration',
        },
        {
          label: 'Packages',
          items: [{ autogenerate: { directory: 'packages' } }],
        },
      ],
    }),
    conlocaCMS({
      contentRoot: './content',
      puckConfigPath: './src/puck.config.tsx',
      schemasPath: './src/schemas.ts',
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
      // Surface Starlight's MDX docs in the CMS Pages list as type:'mdx'
      // pages. Files stay in place at src/content/docs and are still rendered
      // by Starlight's stock docsLoader() in content.config.ts — the CMS just
      // edits them in-place.
      mdxPages: {
        root: './src/content/docs',
        defaultLocale: 'en',
        site: 'default',
        renderer: 'external',
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
