import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  integrations: [
    starlight({
      title: 'Conloca CMS',
      customCss: ['./src/styles/global.css', './src/styles/custom.css'],
      expressiveCode: { themes: ['starlight-dark'] },
      sidebar: [
        { label: 'Getting Started', slug: 'docs/getting-started' },
        {
          label: 'Concepts',
          autogenerate: { directory: 'docs/concepts' },
        },
        {
          label: 'Guides',
          items: [
            { label: 'Custom Blocks', slug: 'docs/guides/custom-blocks' },
            {
              label: 'Authentication',
              autogenerate: { directory: 'docs/guides/auth' },
            },
            {
              label: 'Deployment',
              autogenerate: { directory: 'docs/guides/deploy' },
            },
          ],
        },
        {
          label: 'API Reference',
          autogenerate: { directory: 'docs/reference/api' },
        },
        {
          label: 'Configuration',
          slug: 'docs/reference/configuration',
        },
        {
          label: 'Packages',
          autogenerate: { directory: 'docs/packages' },
        },
      ],
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
