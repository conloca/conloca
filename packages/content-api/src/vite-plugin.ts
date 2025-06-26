import { getRequestListener } from '@hono/node-server';
import { normalize, resolve } from 'path';
import type { Plugin, ViteDevServer } from 'vite';
import { FileSystemContentAPI } from './filesystem-content-api';
import { createContentAPIRouter } from './middleware';

export interface ConlocaContentOptions {
  contentRoot: string;
  canvasDir?: string;
  basePath?: string;
}

/**
 * Vite plugin wrapper for content middleware
 * This follows the spec in 04-cms-api.md and 09-conloca-content-editing.md
 */
export function conlocaContent(options: ConlocaContentOptions): Plugin {
  let contentApi: FileSystemContentAPI;

  const basePath = options.basePath || '/__conloca/api/content';

  return {
    name: 'vite-plugin-conloca-content',

    async configureServer(server: ViteDevServer) {
      // Initialize content API
      contentApi = await FileSystemContentAPI.create({
        contentRoot: options.contentRoot,
        canvasDir: options.canvasDir || './canvas',
      });

      // Set up content file watcher
      server.watcher.add(options.contentRoot);

      // Create Hono app with routes
      const app = createContentAPIRouter(contentApi);

      // Add to Vite as middleware using @hono/node-server
      server.middlewares.use(basePath, getRequestListener(app.fetch));

      // Set up HMR for content changes
      server.watcher.on('change', async (file) => {
        // Normalize paths for consistent comparison
        const normalizedFile = normalize(resolve(file));
        const normalizedRoot = normalize(resolve(options.contentRoot));

        if (normalizedFile.startsWith(normalizedRoot)) {
          // Reindex the specific changed file
          const result = await contentApi.reindex([normalizedFile]);

          // Send updates for each changed locale
          for (const manifest of result.updated) {
            server.ws.send({
              type: 'custom',
              event: 'conloca:content-update',
              data: {
                action: 'update',
                manifest,
              },
            });
          }
        }
      });

      // Handle new files
      server.watcher.on('add', async (file) => {
        // Normalize paths for consistent comparison
        const normalizedFile = normalize(resolve(file));
        const normalizedRoot = normalize(resolve(options.contentRoot));

        if (normalizedFile.startsWith(normalizedRoot)) {
          // Reindex the new file
          const result = await contentApi.reindex([normalizedFile]);

          // Send updates for each new locale
          for (const manifest of result.updated) {
            server.ws.send({
              type: 'custom',
              event: 'conloca:content-update',
              data: {
                action: 'create',
                manifest,
              },
            });
          }
        }
      });

      // Handle deleted files
      server.watcher.on('unlink', async (file) => {
        // Normalize paths for consistent comparison
        const normalizedFile = normalize(resolve(file));
        const normalizedRoot = normalize(resolve(options.contentRoot));

        if (normalizedFile.startsWith(normalizedRoot)) {
          // Remove from index
          const result = await contentApi.reindex([normalizedFile], { handleDeletions: true });

          // Send deletion updates
          if (result.deleted) {
            for (const deletion of result.deleted) {
              server.ws.send({
                type: 'custom',
                event: 'conloca:content-update',
                data: {
                  action: 'delete',
                  ...deletion,
                },
              });
            }
          }
        }
      });
    },
  };
}
