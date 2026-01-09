import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UIConfig } from '@conloca/cms-spa';
import { createContentAPI, createContentWatchHandlers } from '@conloca/content-api/node';
import viteReact from '@vitejs/plugin-react';
import type { AstroIntegration } from 'astro';

import { normalizeRoutingConfig, resolveRouteConfig } from './lib/routing-config.js';

// Get the directory of this module to resolve page-handler.astro
// In development, __dirname points to src/. In production, it points to dist/.
// The handlers directory is always in src/, so we need to handle both cases.
const __dirname = dirname(fileURLToPath(import.meta.url));
const isInDist = __dirname.endsWith('/dist') || __dirname.includes('/dist/');
const PAGE_HANDLER_PATH = isInDist
  ? join(dirname(__dirname), 'src', 'handlers', 'page-handler.astro')
  : join(__dirname, 'handlers', 'page-handler.astro');
import {
  generateLayoutModule,
  generatePageApiModule,
  generatePuckConfigModule,
  generateRoutingConfigModule,
} from './lib/virtual-module-generators.js';
import type { ResolvedRoutingConfig, RoutingConfigInput } from './types.js';

// Virtual module for passing config from plugin to route handler
const VIRTUAL_CONFIG_MODULE = 'virtual:conloca-config';
const RESOLVED_VIRTUAL_CONFIG = '\0' + VIRTUAL_CONFIG_MODULE;

// Virtual module IDs for routing system
const VIRTUAL_ROUTING_CONFIG = 'virtual:conloca-routing-config';
const VIRTUAL_LAYOUT = 'virtual:conloca-layout';
const VIRTUAL_PAGE_API = 'virtual:conloca-page-api';
const VIRTUAL_PUCK_CONFIG = 'virtual:conloca-puck-config';

// Resolved IDs (with \0 prefix to prevent file resolution)
const RESOLVED_ROUTING_CONFIG = '\0' + VIRTUAL_ROUTING_CONFIG;
const RESOLVED_LAYOUT = '\0' + VIRTUAL_LAYOUT;
const RESOLVED_PAGE_API = '\0' + VIRTUAL_PAGE_API;
const RESOLVED_PUCK_CONFIG = '\0' + VIRTUAL_PUCK_CONFIG;

export interface ConlocaCMSOptions extends Omit<UIConfig, 'basename'> {
  contentRoot: string;
  canvasDir?: string;
  route?: string; // Default: /__cms
  puckConfigPath: string; // Path to the puck config module (should be .tsx file with React components)
  dataSchemasPath?: string; // Path to the data schemas module (exports { dataSchemas })
  routing?: RoutingConfigInput; // Content page routing configuration
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

// Import the setPuckConfig function from cms-spa
import { setPuckConfig } from '@conloca/cms-spa/puck-config';

// Now dynamically import the config after preamble is ready
const puckConfigPromise = import('${absolutePuckPath}');

// Handle the initial load
puckConfigPromise.then(module => {
  const puckConfig = module.default;
  setPuckConfig(puckConfig);

  // Hook into React Fast Refresh to detect component updates
  if (window.__registerBeforePerformReactRefresh) {
    window.__registerBeforePerformReactRefresh(async () => {
      // Re-import the config module to get updated components
      const newModule = await import('${absolutePuckPath}');
      setPuckConfig(newModule.default);
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
// Import setDataSchemas which handles subscription notifications
import { setDataSchemas } from '@conloca/cms-spa/data-schemas';
import { dataSchemas } from '${absoluteSchemasPath}';

// Register the schemas - subscribers are notified automatically
setDataSchemas(dataSchemas);

// Accept HMR for this module
if (import.meta.hot) {
  import.meta.hot.accept('${absoluteSchemasPath}', async (newModule) => {
    if (newModule?.dataSchemas) {
      setDataSchemas(newModule.dataSchemas);
    }
  });
}

export default dataSchemas;
`;
};

export function conlocaCMS(options: ConlocaCMSOptions): AstroIntegration {
  const cmsRoute = options.route || '/__cms';

  // Normalize routing config and resolve defaults
  const routingConfig = normalizeRoutingConfig(options.routing);

  // Build resolved routing config with all defaults applied
  let resolvedRoutingConfig: ResolvedRoutingConfig | undefined;
  if (routingConfig?.enabled !== false && routingConfig) {
    const resolvedRoutes: Record<string, Required<import('./types.js').RouteConfig>> = {};
    for (const [name, config] of Object.entries(routingConfig.routes || {})) {
      resolvedRoutes[name] = resolveRouteConfig(config);
    }
    resolvedRoutingConfig = {
      enabled: routingConfig.enabled ?? true,
      routes: resolvedRoutes,
      fallback: routingConfig.fallback ?? '404',
      onConflict: routingConfig.onConflict ?? 'warn',
      siteName: routingConfig.siteName ?? 'default',
      locale: routingConfig.locale ?? 'en',
    };
  }

  // SPA config passed to route handler via virtual module
  const spaConfig = {
    basename: cmsRoute,
    apiBaseUrl: `${cmsRoute}/api`,
    siteBaseUrl: options.siteBaseUrl,
    enableDevtools: options.enableDevtools,
    queryClientOptions: options.queryClientOptions,
    dataSchemasPath: options.dataSchemasPath,
    projectRoot: process.cwd(),
  };

  return {
    name: '@conloca/astro-cms',
    hooks: {
      'astro:config:setup': ({ updateConfig, injectRoute, command, logger }) => {
        // Always apply SSR externalization for native modules (needed for both dev and build)
        // This must be outside the dev-only block to fix build errors
        updateConfig({
          vite: {
            ssr: {
              // Force these packages through Vite's resolver during SSR
              // This ensures symlinked packages use the consumer's React, not their own
              // Without this, symlinked packages resolve React from their node_modules
              noExternal: ['@conloca/astro-cms', '@conloca/cms-spa'],
              // Externalize native Node modules for SSR builds
              // These cannot be bundled and must be available at runtime
              external: ['@node-rs/xxhash'],
            },
            // Virtual modules for routing - needed in both dev and build
            plugins: [
              {
                name: 'conloca-routing-virtual-modules',
                resolveId(id) {
                  // Routing virtual modules (work in both dev and build)
                  if (id === VIRTUAL_ROUTING_CONFIG) {
                    return RESOLVED_ROUTING_CONFIG;
                  }
                  if (id === VIRTUAL_LAYOUT) {
                    return RESOLVED_LAYOUT;
                  }
                  if (id === VIRTUAL_PAGE_API) {
                    return RESOLVED_PAGE_API;
                  }
                  if (id === VIRTUAL_PUCK_CONFIG) {
                    return RESOLVED_PUCK_CONFIG;
                  }
                  return null;
                },
                load(id) {
                  // Routing virtual modules
                  if (id === RESOLVED_ROUTING_CONFIG) {
                    if (resolvedRoutingConfig) {
                      return generateRoutingConfigModule(resolvedRoutingConfig);
                    }
                    // Return disabled config if routing not configured
                    return 'export default { enabled: false, routes: {}, fallback: "404", onConflict: "warn" };';
                  }
                  if (id === RESOLVED_LAYOUT) {
                    return generateLayoutModule(routingConfig);
                  }
                  if (id === RESOLVED_PAGE_API) {
                    return generatePageApiModule({
                      contentRoot: options.contentRoot,
                      canvasDir: options.canvasDir || './canvas',
                      siteName: resolvedRoutingConfig?.siteName ?? 'default',
                      locale: resolvedRoutingConfig?.locale ?? 'en',
                    });
                  }
                  if (id === RESOLVED_PUCK_CONFIG) {
                    return generatePuckConfigModule(options.puckConfigPath);
                  }
                  return null;
                },
              },
            ],
          },
        });

        // Content page routes - works in both dev and build
        if (resolvedRoutingConfig?.enabled) {
          for (const [routeName, routeConfig] of Object.entries(resolvedRoutingConfig.routes)) {
            logger.info(`Injecting content route: ${routeConfig.pattern} (${routeName})`);
            injectRoute({
              pattern: routeConfig.pattern,
              entrypoint: PAGE_HANDLER_PATH,
              prerender: routeConfig.prerender,
            });
          }
        }

        // Only inject CMS admin routes and dev-specific config in dev mode
        if (command !== 'dev') return;

        // Pass options via Vite define for API routes
        updateConfig({
          vite: {
            define: {
              'import.meta.env.CONLOCA_CONTENT_ROOT': JSON.stringify(options.contentRoot),
              'import.meta.env.CONLOCA_CANVAS_DIR': JSON.stringify(options.canvasDir || './canvas'),
              'import.meta.env.CONLOCA_PUCK_CONFIG_PATH': JSON.stringify(options.puckConfigPath),
            },
            resolve: {
              // Dedupe React to avoid multiple instances when using symlinked packages
              // This prevents "Cannot read properties of null (reading 'useMemo')" errors
              dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', '@measured/puck'],
            },
            optimizeDeps: {
              // Exclude the puck config from optimization to avoid the outdated dep error
              exclude: [options.puckConfigPath],
            },
            plugins: [
              {
                name: 'conloca-dev-virtual-modules',
                resolveId(id) {
                  // Dev-only config module for spa-handler.ts
                  if (id === VIRTUAL_CONFIG_MODULE) {
                    return RESOLVED_VIRTUAL_CONFIG;
                  }
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
                  // Dev-only config module for spa-handler.ts
                  if (id === RESOLVED_VIRTUAL_CONFIG) {
                    return `export default ${JSON.stringify(spaConfig)};`;
                  }
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

      'astro:routes:resolved': ({ routes, logger }) => {
        // Check for route conflicts when routing is enabled
        if (!resolvedRoutingConfig?.enabled) return;

        const injectedPatterns = new Set(
          Object.values(resolvedRoutingConfig.routes).map((r) => r.pattern),
        );

        // Find file-based routes that may conflict with injected routes
        const conflicts: { injected: string; fileBased: string }[] = [];

        for (const route of routes) {
          // Skip routes from integrations (including our own)
          if (route.origin === 'internal') continue;

          // Check if this file-based route pattern matches any injected pattern
          const pattern = route.pattern;
          if (injectedPatterns.has(pattern)) {
            conflicts.push({
              injected: pattern,
              fileBased: route.entrypoint || pattern,
            });
          }
        }

        if (conflicts.length === 0) return;

        // Handle conflicts based on onConflict setting
        const onConflict = resolvedRoutingConfig.onConflict;

        for (const conflict of conflicts) {
          const message = `Route conflict: '${conflict.injected}' is defined both in ${conflict.fileBased} and injected by Conloca routing. Conloca route will take precedence.`;

          if (onConflict === 'error') {
            throw new Error(`[Conloca] ${message}`);
          } else if (onConflict === 'warn') {
            logger.warn(message);
          }
          // 'silent' - do nothing
        }
      },
    },
  };
}
