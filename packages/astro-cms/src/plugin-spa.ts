import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UIConfig } from '@conloca/cms-spa';
import viteReact from '@vitejs/plugin-react';
import type { AstroIntegration } from 'astro';
import { searchForWorkspaceRoot } from 'vite';

import { deriveComponentPaths, type HydrationDiscovery, scanForHydratableComponents } from './lib/hydration-scanner.js';
import { normalizeRoutingConfig, resolveRouteConfig } from './lib/routing-config.js';

// FRAGILE: viteReact.preambleCode is an undocumented internal API of @vitejs/plugin-react.
// It provides the React Fast Refresh preamble script needed for HMR in virtual modules.
// If @vitejs/plugin-react removes or renames this property, the assertion below will
// fail immediately at dev startup. Test after any @vitejs/plugin-react update.
if (typeof viteReact.preambleCode !== 'string') {
  throw new Error(
    '@vitejs/plugin-react internal API changed: viteReact.preambleCode is no longer a string. ' +
      'This is an undocumented API used by @conloca/astro-cms for React Fast Refresh in virtual modules. ' +
      'Check @vitejs/plugin-react release notes and update the preamble injection logic.',
  );
}

const reactRefreshPreamble = viteReact.preambleCode.replace('__BASE__', '/');

// Get the directory of this module to resolve page-handler.astro
// Works from both src/ (dev) and dist/ (published) since build copies the file
const __dirname = dirname(fileURLToPath(import.meta.url));
const PAGE_HANDLER_PATH = join(__dirname, '..', 'internal', 'page-handler.astro');
const CMS_HANDLER_PATH = join(__dirname, '..', 'internal', 'cms-handler.mjs');
const ACORN_DEFAULT_SHIM_PATH = join(__dirname, '..', 'internal', 'acorn-default.mjs');

import {
  generateBlockCollectionsModule,
  generateLayoutModule,
  generatePageApiModule,
  generatePuckConfigModule,
  generateRoutingConfigModule,
} from './lib/virtual-module-generators.js';
import type { ResolvedRoutingConfig, RoutingConfigInput, TemplateConfig } from './types.js';

// Virtual module for passing config from plugin to route handler
const VIRTUAL_CONFIG_MODULE = 'virtual:conloca-config';
const RESOLVED_VIRTUAL_CONFIG = `\0${VIRTUAL_CONFIG_MODULE}`;

// Virtual module IDs for routing system
const VIRTUAL_ROUTING_CONFIG = 'virtual:conloca-routing-config';
const VIRTUAL_LAYOUT = 'virtual:conloca-layout';
const VIRTUAL_BLOCK_COLLECTIONS = 'virtual:conloca-block-collections';
const VIRTUAL_PAGE_API = 'virtual:conloca-page-api';
const VIRTUAL_PUCK_CONFIG = 'virtual:conloca-puck-config';

// Resolved IDs (with \0 prefix to prevent file resolution)
const RESOLVED_ROUTING_CONFIG = `\0${VIRTUAL_ROUTING_CONFIG}`;
const RESOLVED_LAYOUT = `\0${VIRTUAL_LAYOUT}`;
const RESOLVED_BLOCK_COLLECTIONS = `\0${VIRTUAL_BLOCK_COLLECTIONS}`;
const RESOLVED_PAGE_API = `\0${VIRTUAL_PAGE_API}`;
const RESOLVED_PUCK_CONFIG = `\0${VIRTUAL_PUCK_CONFIG}`;

// Virtual modules for hydration system
const VIRTUAL_HYDRATION_REGISTRY = 'virtual:conloca-hydration-registry';
const VIRTUAL_HYDRATION_ENTRY = 'virtual:conloca-hydration-entry';
const RESOLVED_HYDRATION_REGISTRY = `\0${VIRTUAL_HYDRATION_REGISTRY}`;
const RESOLVED_HYDRATION_ENTRY = `\0${VIRTUAL_HYDRATION_ENTRY}`;

// Virtual module for CMS SPA source loading (dev only)
const VIRTUAL_CMS_SPA_ENTRY = 'virtual:conloca-cms-spa-entry';
const RESOLVED_CMS_SPA_ENTRY = `\0${VIRTUAL_CMS_SPA_ENTRY}`;

async function loadContentApiNode() {
  return import('@conloca/content-api/node');
}

export interface ConlocaCMSOptions extends Omit<UIConfig, 'basename'> {
  contentRoot: string;
  canvasDir?: string;
  route?: string; // Default: /__cms
  puckConfigPath: string; // Path to the puck config module (should be .tsx file with React components)
  schemasPath?: string; // Path to the schemas module (exports { dataSchemas, pageSchemas })

  /**
   * Default layout for content pages.
   * When provided without routing config, enables routing with catch-all pattern.
   * For multi-route setups, use routing.routes.{name}.layout instead.
   *
   * @example './src/layouts/Layout.astro'
   */
  layout?: string;

  routing?: RoutingConfigInput; // Content page routing configuration
  templates?: Record<string, TemplateConfig>; // Page creation templates

  /**
   * Paths to scan for hydratable components.
   * Components using withHydration() in these directories are auto-discovered.
   *
   * @example ['src/components/puck']
   */
  componentPaths?: string[];

  /**
   * Path to the assets directory for image uploads.
   * When provided, enables the Media Library and asset upload API routes.
   *
   * @example 'src/assets/uploads'
   */
  assetsPath?: string;
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
  // We need to ensure the preamble executes before ANY module evaluation
  // So we'll use a dynamic import after the preamble is set up
  return `
// Import and execute React refresh preamble first (from @vitejs/plugin-react)
${reactRefreshPreamble}

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

// Template for the schemas loader virtual module
const schemasLoader = (absoluteSchemasPath: string) => {
  return `
import { setPageSchemas } from '@conloca/cms-spa/page-schemas';
import * as schemas from '${absoluteSchemasPath}';

if (schemas.pageSchemas) {
  setPageSchemas(schemas.pageSchemas);
}

if (import.meta.hot) {
  import.meta.hot.accept('${absoluteSchemasPath}', async (newModule) => {
    if (newModule?.pageSchemas) {
      setPageSchemas(newModule.pageSchemas);
    }
  });
}

export default schemas;
`;
};

export function conlocaCMS(options: ConlocaCMSOptions): AstroIntegration {
  const cmsRoute = options.route || '/__cms';

  // Normalize routing config and resolve defaults
  // Pass top-level layout to enable routing when layout provided without explicit routing config
  const routingConfig = normalizeRoutingConfig(options.routing, options.layout);

  // Always derive component paths - auto-discover from puckConfigPath + extend with explicit paths
  // Scanner handles missing directories gracefully (fast-glob returns empty array)
  const componentPaths = deriveComponentPaths(options.puckConfigPath, options.componentPaths);

  // Scan for hydratable components - this promise is awaited in the virtual module loader
  const hydrationDiscoveriesPromise: Promise<HydrationDiscovery[]> = scanForHydratableComponents(
    componentPaths,
    process.cwd(),
  ).then((discoveries) => {
    if (discoveries.length > 0) {
      console.log(`[Conloca] Found ${discoveries.length} hydratable component(s)`);
    }
    return discoveries;
  });

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
  // This is only served in dev mode (CMS admin is dev-only), so enableDevtools defaults to true
  const spaConfig = {
    basename: cmsRoute,
    apiBaseUrl: `${cmsRoute}/api`,
    siteBaseUrl: options.siteBaseUrl,
    enableDevtools: options.enableDevtools ?? true,
    queryClientOptions: options.queryClientOptions,
    schemasPath: options.schemasPath,
    projectRoot: process.cwd(),
    templates: options.templates,
  };

  let refreshConlocaContent: (() => Promise<void>) | undefined;

  return {
    name: '@conloca/astro-cms',
    hooks: {
      'astro:config:setup': ({ updateConfig, injectRoute, command, logger }) => {
        // Auto-inject fs.allow for external contentRoot (dev mode only)
        const astroRoot = process.cwd();
        const contentAbsolute = resolve(options.contentRoot);

        if (command === 'dev' && !contentAbsolute.startsWith(astroRoot)) {
          logger.info(`Auto-allowing contentRoot in Vite fs.allow: ${options.contentRoot}`);

          updateConfig({
            vite: {
              server: {
                fs: {
                  allow: [
                    searchForWorkspaceRoot(process.cwd()), // Preserve Vite default
                    contentAbsolute,
                  ],
                },
              },
            },
          });
        }

        const devSsrNoExternal = [/^@conloca\//, '@puckeditor/core'];
        const serverOnlyExternal = [
          '@conloca/content-api',
          '@conloca/content-api/node',
          '@conloca/content-api/schemas',
          '@conloca/mdx',
          '@conloca/mdx/node',
        ];
        const blockCollectionsPromise = loadContentApiNode().then(({ createContentAPI }) =>
          createContentAPI({
            contentRoot: options.contentRoot,
            canvasDir: options.canvasDir || './canvas',
          }).then((api) => Array.from(api.blocks.collections)),
        );

        updateConfig({
          vite: {
            resolve: {
              alias: {
                acorn: ACORN_DEFAULT_SHIM_PATH,
              },
            },
            ssr: {
              // In dev, linked workspace packages need to be bundled so React resolves
              // through Vite and HMR works from source.
              noExternal: command === 'dev' ? devSsrNoExternal : [],
              // Keep Node-only content processing packages external so SSR builds do not
              // try to bundle native dependencies like xxhash.
              external: serverOnlyExternal,
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
                  if (id === VIRTUAL_BLOCK_COLLECTIONS) {
                    return RESOLVED_BLOCK_COLLECTIONS;
                  }
                  if (id === VIRTUAL_PUCK_CONFIG) {
                    return RESOLVED_PUCK_CONFIG;
                  }
                  // Hydration virtual modules
                  if (id === VIRTUAL_HYDRATION_REGISTRY) {
                    return RESOLVED_HYDRATION_REGISTRY;
                  }
                  if (id === VIRTUAL_HYDRATION_ENTRY) {
                    return RESOLVED_HYDRATION_ENTRY;
                  }
                  return null;
                },
                async load(id) {
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
                  if (id === RESOLVED_BLOCK_COLLECTIONS) {
                    const blockCollections = await blockCollectionsPromise;

                    return generateBlockCollectionsModule(blockCollections);
                  }
                  if (id === RESOLVED_PUCK_CONFIG) {
                    return generatePuckConfigModule(options.puckConfigPath);
                  }
                  // Hydration virtual modules
                  if (id === RESOLVED_HYDRATION_REGISTRY) {
                    // Always scan - paths are auto-derived from puckConfigPath
                    const discoveries = await hydrationDiscoveriesPromise;
                    if (discoveries.length > 0) {
                      const entries = discoveries.map((d) => {
                        // Convert absolute path to Vite-friendly path
                        const relativePath = d.filePath.replace(process.cwd(), '');
                        return `  '${d.componentName}': {
    loader: () => import('${relativePath}').then(m => m.${d.componentName}.render),
    strategy: '${d.strategy}',
  }`;
                      });
                      return `// Generated by @conloca/astro-cms scanner
export const componentRegistry = {
${entries.join(',\n')}
};`;
                    }

                    // No hydratable components found - return empty registry
                    return 'export const componentRegistry = {};';
                  }
                  if (id === RESOLVED_HYDRATION_ENTRY) {
                    // Generate entry point that imports registry and calls initHydration
                    return `import { initHydration } from '@conloca/astro-cms/lib/hydration-script'
import { componentRegistry } from 'virtual:conloca-hydration-registry'

// Auto-initialize hydration when this module loads
initHydration(componentRegistry)
`;
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
              'import.meta.env.CONLOCA_ASSETS_PATH': JSON.stringify(options.assetsPath || ''),
            },
            resolve: {
              // Dedupe React and React Query to avoid multiple instances when using symlinked packages.
              // Without this, bun link causes esbuild to find nested copies in the symlink target's
              // node_modules, creating separate React.createContext() calls = broken context sharing.
              dedupe: [
                'react',
                'react-dom',
                'react/jsx-runtime',
                'react/jsx-dev-runtime',
                '@puckeditor/core',
                '@tanstack/react-query',
              ],
              // Prevent symlinked packages (via bun link) from resolving dependencies
              // from their real path. Ensures @conloca packages find React from the
              // consumer project's node_modules, not from their source repo.
              preserveSymlinks: true,
            },
            optimizeDeps: {
              // Exclude the puck config from optimization to avoid the outdated dep error
              exclude: [options.puckConfigPath],
              // Pre-bundle ALL CMS dependencies upfront to prevent mid-session re-optimization
              // which causes React dual-instance issues when Vite discovers new deps dynamically
              include: [
                // React core - must be pre-bundled together
                'react',
                'react-dom',
                'react-dom/client',
                'react/jsx-runtime',
                'react/jsx-dev-runtime',
                // CMS dependencies
                '@mdxeditor/editor',
                '@puckeditor/core',
                '@tanstack/react-query',
                '@tanstack/react-query-devtools',
                'react-router-dom',
                '@radix-ui/react-dialog',
                '@radix-ui/react-select',
                'lucide-react',
                'clsx',
                'tailwind-merge',
                // Content processing
                'zod',
                'yaml',
                'nanoid',
                'sort-keys',
                // MDX processing
                '@mdx-js/mdx',
                'remark-frontmatter',
                'remark-gfm',
                'remark-mdx-frontmatter',
              ],
            },
            plugins: [
              // Normalize @conloca/* imports from symlinked source files (bun link).
              // When main.tsx is loaded via /@fs/<real-path>, its @conloca/* imports
              // resolve relative to the real filesystem location, creating duplicate
              // module instances. This plugin re-resolves them from the consumer
              // project root so all @conloca packages use the same module identity.
              {
                name: 'conloca-resolve-normalizer',
                enforce: 'pre' as const,
                async resolveId(source, importer) {
                  // Only normalize @conloca/* bare specifiers
                  if (!source.startsWith('@conloca/')) return null;
                  // Only when imported from outside the project (symlinked source files)
                  if (!importer || importer.startsWith(astroRoot)) return null;
                  // Skip virtual modules (prefixed with \0)
                  if (importer.startsWith('\0')) return null;
                  // Re-resolve from project root to ensure consumer's node_modules is used
                  const resolved = await this.resolve(source, join(astroRoot, '_resolveAnchor.js'), { skipSelf: true });
                  return resolved;
                },
              },
              {
                name: 'conloca-dev-virtual-modules',
                resolveId(id) {
                  // Dev-only config module for cms-handler.ts
                  if (id === VIRTUAL_CONFIG_MODULE) {
                    return RESOLVED_VIRTUAL_CONFIG;
                  }
                  if (id === `${cmsRoute}/puck-entry.js`) {
                    return id;
                  }
                  if (id === `${cmsRoute}/content-listener.js`) {
                    return id;
                  }
                  if (id === `${cmsRoute}/schemas-entry.js`) {
                    return id;
                  }
                  if (id === VIRTUAL_PAGE_API) {
                    return RESOLVED_PAGE_API;
                  }
                  if (id === VIRTUAL_CMS_SPA_ENTRY) {
                    return RESOLVED_CMS_SPA_ENTRY;
                  }
                  if (id === `${cmsRoute}/cms-spa-entry.js`) {
                    return RESOLVED_CMS_SPA_ENTRY;
                  }
                  return null;
                },
                load(id) {
                  // Dev-only config module for cms-handler.ts
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
                  if (id === `${cmsRoute}/schemas-entry.js`) {
                    if (options.schemasPath) {
                      const absoluteSchemasPath = options.schemasPath.startsWith('.')
                        ? `/${options.schemasPath.slice(2)}`
                        : options.schemasPath;
                      return schemasLoader(absoluteSchemasPath);
                    }
                    return 'export default {};';
                  }
                  if (id === RESOLVED_PAGE_API) {
                    return generatePageApiModule({
                      contentRoot: options.contentRoot,
                      canvasDir: options.canvasDir || './canvas',
                      siteName: resolvedRoutingConfig?.siteName ?? 'default',
                      locale: resolvedRoutingConfig?.locale ?? 'en',
                    });
                  }
                  if (id === RESOLVED_CMS_SPA_ENTRY) {
                    // Detect whether cms-spa source is available (workspace mode)
                    // vs only dist/ (npm install)
                    let cmsSpaImport: string;
                    try {
                      const cmsSpaPackageJsonPath = import.meta.resolve('@conloca/cms-spa/package.json');
                      const cmsSpaDir = dirname(
                        cmsSpaPackageJsonPath.startsWith('file://')
                          ? fileURLToPath(cmsSpaPackageJsonPath)
                          : cmsSpaPackageJsonPath,
                      );
                      const srcMainPath = join(cmsSpaDir, 'src', 'main.tsx');

                      if (existsSync(srcMainPath)) {
                        // Workspace mode: import source for HMR
                        cmsSpaImport = `import '${srcMainPath}';`;
                      } else {
                        // npm mode: import pre-built SPA mounting entry
                        cmsSpaImport = "import '@conloca/cms-spa/main';";
                      }
                    } catch {
                      // Fallback: use package import
                      cmsSpaImport = "import '@conloca/cms-spa/main';";
                    }

                    return `
// Import and execute React refresh preamble first (from @vitejs/plugin-react)
${reactRefreshPreamble}

// Import cms-spa through Vite
// Vite will resolve React from its pre-bundled deps (same instance as puck.config.tsx)
${cmsSpaImport}

// Accept HMR
if (import.meta.hot) {
  import.meta.hot.accept();
}
`;
                  }
                  return null;
                },
              },
              {
                name: 'conloca-content-watcher',
                async configureServer(server) {
                  const { createContentAPI, createContentWatchHandlers } = await loadContentApiNode();

                  // Initialize content API using the extracted function
                  const contentApi = await createContentAPI({
                    contentRoot: options.contentRoot,
                    canvasDir: options.canvasDir || './canvas',
                  });

                  // Only add explicit watchers if content is outside the Astro project
                  const { resolve } = await import('node:path');
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
                    async () => {
                      await refreshConlocaContent?.();
                    },
                  );

                  server.watcher.on('change', handlers.onChange);
                  server.watcher.on('add', handlers.onAdd);
                  server.watcher.on('unlink', handlers.onUnlink);
                },
              },
            ],
          },
        });

        // Inject unified CMS handler for all CMS routes
        // Single handler validates auth once, then routes to appropriate sub-handler
        injectRoute({
          pattern: `${cmsRoute}/[...path]`,
          entrypoint: CMS_HANDLER_PATH,
          prerender: false,
        });

        // Also handle the root CMS route
        injectRoute({
          pattern: cmsRoute,
          entrypoint: CMS_HANDLER_PATH,
          prerender: false,
        });
      },

      'astro:server:setup': ({ logger, refreshContent }) => {
        logger.info(`Conloca CMS available at ${cmsRoute}`);

        let refreshChain = Promise.resolve();

        refreshConlocaContent = async () => {
          if (!refreshContent) {
            return;
          }

          refreshChain = refreshChain
            .catch(() => undefined)
            .then(async () => {
              await refreshContent({ loaders: ['conloca-loader'] });
            });

          await refreshChain;
        };

        // Register dev-time content refresh after the Vite server exists.
        // This keeps Astro collections in sync with Conloca's own file watcher.
        logger.debug('Registering Conloca content refresh handler');
      },

      'astro:routes:resolved': ({ routes, logger }) => {
        // Check for route conflicts when routing is enabled
        if (!resolvedRoutingConfig?.enabled) return;

        const injectedPatterns = new Set(Object.values(resolvedRoutingConfig.routes).map((r) => r.pattern));

        // Find file-based routes that may conflict with injected routes
        const conflicts: { injected: string; fileBased: string }[] = [];

        for (const route of routes) {
          // Skip routes from integrations (including our own)
          if (route.origin === 'internal') continue;

          // Skip our own injected page handler route
          const entrypoint = route.entrypoint || '';
          if (entrypoint.includes('page-handler.astro')) continue;

          // Check if this file-based route pattern matches any injected pattern
          const pattern = route.pattern;
          if (injectedPatterns.has(pattern)) {
            conflicts.push({
              injected: pattern,
              fileBased: entrypoint || pattern,
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
          }
          if (onConflict === 'warn') {
            logger.warn(message);
          }
          // 'silent' - do nothing
        }
      },
    },
  };
}
