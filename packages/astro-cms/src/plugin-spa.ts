import type { UIConfig } from '@conloca/cms-spa';
import { createContentAPI, createContentWatchHandlers } from '@conloca/content-api/node';
import viteReact from '@vitejs/plugin-react';
import type { AstroIntegration } from 'astro';

export interface ConlocaCMSOptions extends Omit<UIConfig, 'basename'> {
  contentRoot: string;
  canvasDir?: string;
  route?: string; // Default: /__cms
  puckConfigPath: string; // Path to the puck config module (should be .tsx file with React components)
  dataSchemasPath?: string; // Path to the data schemas module (exports { dataSchemas })
}

// Template for content change listener virtual module
const contentChangeListener = () => {
  return `
// Content change listener that uses Vite HMR
if (import.meta.hot) {
  import.meta.hot.on('conloca:content-update', (data) => {
    console.log('[Conloca CMS] Content updated, invalidating cache:', data);
    
    // Get the query client from the global scope and invalidate
    if (window.__QUERY_CLIENT__) {
      window.__QUERY_CLIENT__.invalidateQueries();
    }
  });
}

export default {};
`;
};

// Template for the puck config loader virtual module
const puckConfigLoader = (absolutePuckPath: string) => {
  // Get the exact preamble code from the React plugin
  // The base needs to be '/' so the import becomes '/@react-refresh'
  const preambleCode = viteReact.preambleCode.replace('__BASE__', '/');

  // We need to ensure the preamble executes before ANY module evaluation
  // So we'll use a dynamic import after the preamble is set up
  return `
// Import and execute React refresh preamble first (from @vitejs/plugin-react)
${preambleCode}

// Now dynamically import the config after preamble is ready
const puckConfigPromise = import('${absolutePuckPath}');

// Handle the initial load
puckConfigPromise.then(module => {
  const puckConfig = module.default;
  window.__PUCK_CONFIG__ = puckConfig;
  
  // Notify app of initial config
  window.dispatchEvent(new CustomEvent('puck-config-loaded', { detail: puckConfig }));
  
  // Hook into React Fast Refresh to detect component updates
  if (window.__registerBeforePerformReactRefresh) {
    window.__registerBeforePerformReactRefresh(async () => {
      // Re-import the config module to get updated components
      const newModule = await import('${absolutePuckPath}');
      window.__PUCK_CONFIG__ = newModule.default;
      window.dispatchEvent(new CustomEvent('puck-config-updated', { detail: newModule.default }));
    });
  }
});

// Accept HMR for this module itself
if (import.meta.hot) {
  import.meta.hot.accept();
}

// Export the promise so the module has a default export
export default puckConfigPromise.then(m => m.default);
`;
};

// Template for the data schemas loader virtual module
const dataSchemasLoader = (absoluteSchemasPath: string) => {
  return `
// Import directly from data-schemas to avoid loading MDXContent which triggers React Refresh errors
import { setDataSchemas } from '@conloca/cms-spa/data-schemas';
import { dataSchemas } from '${absoluteSchemasPath}';

// Register the schemas with the CMS and notify React components
setDataSchemas(dataSchemas);
window.dispatchEvent(new CustomEvent('data-schemas-loaded', { detail: dataSchemas }));

// Accept HMR for this module
if (import.meta.hot) {
  import.meta.hot.accept('${absoluteSchemasPath}', async (newModule) => {
    if (newModule?.dataSchemas) {
      setDataSchemas(newModule.dataSchemas);
      window.dispatchEvent(new CustomEvent('data-schemas-updated', { detail: newModule.dataSchemas }));
    }
  });
}

export default dataSchemas;
`;
};

export function conlocaCMS(options: ConlocaCMSOptions): AstroIntegration {
  const cmsRoute = options.route || '/__cms';

  // Build SPA config - stored on globalThis for route handler access
  const spaConfig = {
    basename: cmsRoute,
    apiBaseUrl: `${cmsRoute}/api`,
    siteBaseUrl: options.siteBaseUrl,
    enableDevtools: options.enableDevtools,
    queryClientOptions: options.queryClientOptions,
    dataSchemasPath: options.dataSchemasPath,
    projectRoot: process.cwd(),
  };

  // Store config in process.env for spa-handler access (survives module reloads)
  process.env.__CONLOCA_SPA_CONFIG__ = JSON.stringify(spaConfig);

  return {
    name: '@conloca/astro-cms',
    hooks: {
      'astro:config:setup': ({ updateConfig, injectRoute, command }) => {
        // Only inject routes in dev mode
        if (command !== 'dev') return;

        // Pass options via Vite define for API routes
        updateConfig({
          vite: {
            define: {
              'import.meta.env.CONLOCA_CONTENT_ROOT': JSON.stringify(options.contentRoot),
              'import.meta.env.CONLOCA_CANVAS_DIR': JSON.stringify(options.canvasDir || './canvas'),
              'import.meta.env.CONLOCA_PUCK_CONFIG_PATH': JSON.stringify(options.puckConfigPath),
            },
            optimizeDeps: {
              // Exclude the puck config from optimization to avoid the outdated dep error
              exclude: [options.puckConfigPath],
            },
            plugins: [
              {
                name: 'conloca-virtual-modules',
                resolveId(id) {
                  if (id === `${cmsRoute}/puck-entry.js`) {
                    return id;
                  }
                  if (id === `${cmsRoute}/content-listener.js`) {
                    return id;
                  }
                  if (id === `${cmsRoute}/data-schemas-entry.js`) {
                    return id;
                  }
                  return null;
                },
                load(id) {
                  if (id === `${cmsRoute}/puck-entry.js`) {
                    const absolutePuckPath = options.puckConfigPath.startsWith('.')
                      ? `/${options.puckConfigPath.slice(2)}`
                      : options.puckConfigPath;

                    return puckConfigLoader(absolutePuckPath);
                  }
                  if (id === `${cmsRoute}/content-listener.js`) {
                    return contentChangeListener();
                  }
                  if (id === `${cmsRoute}/data-schemas-entry.js`) {
                    if (options.dataSchemasPath) {
                      const absoluteSchemasPath = options.dataSchemasPath.startsWith('.')
                        ? `/${options.dataSchemasPath.slice(2)}`
                        : options.dataSchemasPath;

                      return dataSchemasLoader(absoluteSchemasPath);
                    }
                    // Return empty module if no schemas path configured
                    return 'export default {};';
                  }
                  return null;
                },
              },
              {
                name: 'conloca-content-watcher',
                async configureServer(server) {
                  // Initialize content API using the extracted function
                  const contentApi = await createContentAPI({
                    contentRoot: options.contentRoot,
                    canvasDir: options.canvasDir || './canvas',
                  });

                  // Only add explicit watchers if content is outside the Astro project
                  const { resolve } = await import('path');
                  const astroRoot = process.cwd();
                  const contentAbsolute = resolve(options.contentRoot);
                  const canvasAbsolute = resolve(options.canvasDir || './canvas');

                  const foldersToWatch = [];

                  if (!contentAbsolute.startsWith(astroRoot)) {
                    console.log(
                      `[Astro Integration] Content outside project, adding to watcher: ${options.contentRoot}`,
                    );
                    foldersToWatch.push(options.contentRoot);
                  } else {
                    console.log(
                      `[Astro Integration] Content inside project, Vite will watch automatically: ${options.contentRoot}`,
                    );
                  }

                  if (!canvasAbsolute.startsWith(astroRoot)) {
                    console.log(
                      `[Astro Integration] Canvas outside project, adding to watcher: ${options.canvasDir || './canvas'}`,
                    );
                    foldersToWatch.push(options.canvasDir || './canvas');
                  } else {
                    console.log(
                      `[Astro Integration] Canvas inside project, Vite will watch automatically: ${options.canvasDir || './canvas'}`,
                    );
                  }

                  if (foldersToWatch.length > 0) {
                    server.watcher.add(foldersToWatch);
                  }

                  // Set up HMR for content changes using extracted handlers
                  const handlers = createContentWatchHandlers(
                    contentApi,
                    {
                      contentRoot: options.contentRoot,
                      canvasDir: options.canvasDir || './canvas',
                    },
                    server.ws,
                  );

                  server.watcher.on('change', handlers.onChange);
                  server.watcher.on('add', handlers.onAdd);
                  server.watcher.on('unlink', handlers.onUnlink);
                },
              },
            ],
            ssr: {
              // Externalize native Node modules for SSR builds
              // These cannot be bundled and must be available at runtime
              external: ['@node-rs/xxhash'],
            },
          },
        });

        // Inject catch-all route for the SPA
        injectRoute({
          pattern: `${cmsRoute}/[...path]`,
          entrypoint: '@conloca/astro-cms/spa-handler',
          prerender: false,
        });

        // Also handle the root CMS route
        injectRoute({
          pattern: cmsRoute,
          entrypoint: '@conloca/astro-cms/spa-handler',
          prerender: false,
        });

        // Inject single catch-all API route
        injectRoute({
          pattern: `${cmsRoute}/api/[...path]`,
          entrypoint: '@conloca/astro-cms/api/content-api-handler',
          prerender: false,
        });
      },

      'astro:server:setup': ({ logger }) => {
        logger.info(`Conloca CMS available at ${cmsRoute}`);
      },
    },
  };
}
