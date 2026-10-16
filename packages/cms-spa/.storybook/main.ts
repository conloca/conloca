import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx'],
  addons: ['@storybook/addon-vitest'],
  framework: '@storybook/react-vite',
  core: {
    builder: {
      name: '@storybook/builder-vite',
      options: {
        // Never inherit an application/dev-server Vite configuration.
        viteConfigPath: fileURLToPath(new URL('./vite.config.ts', import.meta.url)),
      },
    },
  },
};

export default config;
