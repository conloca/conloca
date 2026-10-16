import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { sandboxFramePlugin } from './sandbox-frame-plugin.js';
import { typiaFixtures, typiaRuntimeHelpers } from './typia-fixtures.js';

// Browser-only catalog configuration, also consumed by composed catalogs.
// No server-runtime plugins, application environment files, auth, or backend proxy.
// Stories render forms from the Typia-authored host-schema fixtures; Typia's
// runtime helpers are pre-bundled with DOMPurify (see typia-fixtures.ts).
export default defineConfig({
  envFile: false,
  plugins: [tailwindcss(), sandboxFramePlugin(), react(), ...typiaFixtures()],
  resolve: { dedupe: ['react', 'react-dom'] },
  optimizeDeps: { include: ['dompurify', ...typiaRuntimeHelpers] },
});
