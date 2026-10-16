import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { buildSandboxSrcdoc, SANDBOX_FRAME_PATH } from '../src/components/sandbox/frame-runtime.js';
import { typiaRuntimeHelpers } from './typia-fixtures.js';

// Prefer an explicit browser binary, then a Chrome already installed on the
// machine, and only then Playwright's own download. CI runner images ship
// Chrome at these paths, so a preinstalled browser is used without the runner
// having to export anything.
const PREINSTALLED_CHROME = ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? PREINSTALLED_CHROME.find((p) => existsSync(p));
const playwrightOptions = executablePath ? ([{ launchOptions: { executablePath } }] as const) : ([] as const);

function sandboxFramePlugin(): Plugin {
  return {
    name: 'conloca-storybook-sandbox-frame',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(SANDBOX_FRAME_PATH, (req, res, next) => {
        if (req.method !== 'GET') return next();
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.statusCode = 200;
        res.end(buildSandboxSrcdoc());
      });
    },
  };
}

// Runs every story discovered by ../.storybook/main.ts as a Vitest test in a
// real Chromium instance — browser mode, never a simulated DOM.
// This is the package's ONLY Vitest target; unit tests stay on bun:test.
export default defineConfig({
  plugins: [
    tailwindcss(),
    sandboxFramePlugin(),
    react(),
    storybookTest({ configDir: fileURLToPath(new URL('.', import.meta.url)) }),
  ],
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
    },
  },
});
