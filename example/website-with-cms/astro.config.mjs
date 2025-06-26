// @ts-check
import { defineConfig } from 'astro/config';
import { ligmaCMS } from '@ligma/astro-ligma-cms';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  integrations: [
    react({
      //   exclude: [/puck\.config\.tsx$/] // Testing automatic handling
    }),
    ligmaCMS({
      contentRoot: './content',
      canvasDir: './canvas',
      puckConfigPath: './src/puck.config.tsx',
      enableDevtools: true,
      queryClientOptions: {
        defaultOptions: {
          queries: {
            staleTime: 0, // Always fetch fresh data in dev
            refetchOnWindowFocus: true,
            refetchOnMount: true,
            retry: 0, // No retries for faster feedback
          },
        },
      },
    }),
  ],
  /*
  vite: {
    plugins: [
      {
        name: 'hmr-debug',
        handleHotUpdate({ file, modules }) {
          console.log('[HMR Debug] File changed:', file);
          console.log('[HMR Debug] Affected modules:', modules.map(m => m.id));
          
          // Just log what's happening, don't interfere
          if (file.includes('puck.config')) {
            console.log('[HMR Debug] Puck config changed, modules:', modules);
          }
          
          // Let Vite handle the update normally
          return modules;
        },
        configureServer(server) {
          // Patch Vite's WebSocket to log ALL messages
          const originalSend = server.ws.send;
          server.ws.send = function(payload) {
            console.log('[WS]', payload.type, payload);
            if (payload?.type === 'full-reload') {
              console.error('[VITE RELOAD] Full reload triggered!', payload);
              console.trace('Reload stack trace:');
            }
            return originalSend.call(this, payload);
          };
        }
      }
    ]
  }
  */
});
