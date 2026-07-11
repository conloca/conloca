import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Runs every story discovered by ../.storybook/main.ts as a Vitest test in a
// real Chromium instance (spec 14 A97: browser mode, never a simulated DOM).
// This is the package's ONLY Vitest target — unit tests stay on bun:test per
// the sanctioned A94 exception (dec-20260709-a94-sanctioned-bun-test-exceptions).
export default defineConfig({
  plugins: [react(), storybookTest({ configDir: fileURLToPath(new URL('.', import.meta.url)) })],
  test: {
    name: 'storybook',
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
});
