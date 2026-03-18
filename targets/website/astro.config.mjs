import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://conloca.com',
  integrations: [
    starlight({
      title: 'Conloca CMS',
      customCss: ['./src/styles/global.css', './src/styles/custom.css'],
      expressiveCode: { themes: ['starlight-dark', 'starlight-light'] },
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
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
