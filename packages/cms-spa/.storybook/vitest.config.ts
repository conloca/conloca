import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { sandboxFramePlugin } from './sandbox-frame-plugin.js';
import { typiaFixtures, typiaRuntimeHelpers } from './typia-fixtures.js';

// Prefer an explicit browser binary, then a Chrome already installed on the
// machine, and only then Playwright's own download. CI runner images ship
// Chrome at these paths, so a preinstalled browser is used without the runner
// having to export anything.
const PREINSTALLED_CHROME = ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? PREINSTALLED_CHROME.find((p) => existsSync(p));
const playwrightOptions = executablePath ? ([{ launchOptions: { executablePath } }] as const) : ([] as const);

// Runs every story discovered by ../.storybook/main.ts as a Vitest test in a
// real Chromium instance — browser mode, never a simulated DOM.
// This is the package's ONLY Vitest target; unit tests stay on bun:test.
export default defineConfig({
  envFile: false,
  plugins: [
    tailwindcss(),
    sandboxFramePlugin(),
    react(),
    // Stories render forms from the Typia-authored host-schema fixtures.
    ...typiaFixtures(),
    storybookTest({ configDir: fileURLToPath(new URL('.', import.meta.url)) }),
  ],
  resolve: { dedupe: ['react', 'react-dom'] },
  // Pre-bundle DOMPurify so its first import inside a story does not trigger a
  // mid-run Vite dep-optimization reload (which drops the module fetch and fails
  // the sanitizer stories on a cold cache — see SanitizeHtml.stories.tsx).
  // Typia's runtime helpers likewise (see typia-fixtures.ts).
  optimizeDeps: { include: ['dompurify', ...typiaRuntimeHelpers] },
  test: {
    name: 'storybook',
    browser: {
      enabled: true,
      provider: playwright(...playwrightOptions),
      headless: true,
      instances: [{ browser: 'chromium' }],
      // Storybook's runner sets 1200x900 before each story without its own viewport. Starting each
      // file's frame there keeps that call from resizing it, whose `resize` event would otherwise
      // fire during the file's first story.
      viewport: { width: 1200, height: 900 },
    },
  },
});
