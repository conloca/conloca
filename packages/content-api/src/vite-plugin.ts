import { getRequestListener } from '@hono/node-server';
import type { Plugin, ViteDevServer } from 'vite';
import { createContentAPI, createContentWatchHandlers } from './content-watcher.js';
import type { FileSystemContentAPI } from './filesystem-content-api.js';
import { createContentAPIRouter } from './middleware.js';

export interface ConlocaContentOptions {
  contentRoot: string;
  canvasDir?: string;
  basePath?: string;
}

/**
 * Vite plugin wrapper for content middleware, mounting the content API routes
 * on the dev server so editing works without a separate backend.
 */
export function conlocaContent(options: ConlocaContentOptions): Plugin {
  let contentApi: FileSystemContentAPI;

  const basePath = options.basePath || '/__conloca/api/content';

  return {
    name: 'vite-plugin-conloca-content',

    async configureServer(server: ViteDevServer) {
      // Initialize content API
      contentApi = await createContentAPI(options);

      // Set up content file watcher
      server.watcher.add(options.contentRoot);

      // Create Hono app with routes
      const app = createContentAPIRouter(contentApi);

      // Add to Vite as middleware using @hono/node-server
      server.middlewares.use(basePath, getRequestListener(app.fetch));

      // Set up HMR for content changes using extracted handlers
      const handlers = createContentWatchHandlers(contentApi, options, server.ws);
      server.watcher.on('change', handlers.onChange);
      server.watcher.on('add', handlers.onAdd);
      server.watcher.on('unlink', handlers.onUnlink);
    },
  };
}
