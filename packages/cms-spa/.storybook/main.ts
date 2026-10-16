import type { StorybookConfig } from '@storybook/react-vite';
import tailwindcss from '@tailwindcss/vite';
import { typiaFixtures, typiaRuntimeHelpers } from './typia-fixtures.js';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx'],
  addons: ['@storybook/addon-vitest'],
  framework: '@storybook/react-vite',
  viteFinal(config) {
    config.plugins ??= [];
    // Stories render forms from the Typia-authored host-schema fixtures; the
    // vitest addon reuses these plugins for the story tests.
    config.plugins.push(tailwindcss(), ...typiaFixtures());
    config.optimizeDeps = {
      ...config.optimizeDeps,
      include: [...(config.optimizeDeps?.include ?? []), ...typiaRuntimeHelpers],
    };
    return config;
  },
};

export default config;
