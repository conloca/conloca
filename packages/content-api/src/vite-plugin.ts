import { getRequestListener } from '@hono/node-server';
import type { Plugin, ViteDevServer } from 'vite';
import { createContentAPI, createContentWatchHandlers } from './content-watcher';
import type { FileSystemContentAPI } from './filesystem-content-api';
import { createContentAPIRouter } from './middleware';
import type { MDXCompileResponse } from './types';

export interface ConlocaContentOptions {
  contentRoot: string;
  canvasDir?: string;
  basePath?: string;
  /**
   * MDX compiler injected by the host (typically `compileMDX` from
   * `@conloca/mdx/node`). When absent, `/mdx/compile` returns 501.
   */
  compileMDX?: (content: string) => Promise<MDXCompileResponse>;
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
      contentApi = await createContentAPI(options);

      // Set up content file watcher
      server.watcher.add(options.contentRoot);

      // Create Hono app with routes
      const app = createContentAPIRouter(contentApi, {
        ...(options.compileMDX && { compileMDX: options.compileMDX }),
      });

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
