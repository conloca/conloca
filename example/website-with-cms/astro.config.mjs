// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import { conlocaCMS } from '@conloca/astro-cms';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [
    react({
      //   exclude: [/puck\.config\.tsx$/] // Testing automatic handling
    }),
    conlocaCMS({
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
  vite: {
    // Force Vite to watch and reload on changes to workspace packages
    optimizeDeps: {
      exclude: ['@conloca/content-api', '@conloca/astro-cms', '@conloca/cms-spa'],
    },
    server: {
      watch: {
        // Watch the CMS dist folder for changes (both symlinked and actual path)
        ignored: ['!**/node_modules/@conloca/cms-spa/dist/**', '!**/packages/cms-spa/dist/**'],
      },
      fs: {
        // Allow serving files from the workspace
        allow: ['../..'],
      },
    },
    // Note: SSR configuration (external/noExternal) is now handled by the @conloca/astro-cms integration
  },
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
