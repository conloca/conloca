import type { UIConfig } from '@conloca/cms-spa';
// @ts-ignore - accessing internal export
import viteReact from '@vitejs/plugin-react';
import type { AstroIntegration } from 'astro';
import { configureSpaHandler } from './spa-handler';

export interface ConlocaCMSOptions extends Omit<UIConfig, 'basename'> {
  contentRoot: string;
  canvasDir?: string;
  route?: string; // Default: /__cms
  puckConfigPath: string; // Path to the puck config module (should be .tsx file with React components)
}

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

export function conlocaCMS(options: ConlocaCMSOptions): AstroIntegration {
  const cmsRoute = options.route || '/__cms';

  // Configure the SPA handler with CMS options
  configureSpaHandler({
    basename: cmsRoute,
    siteBaseUrl: options.siteBaseUrl,
    enableDevtools: options.enableDevtools,
    queryClientOptions: options.queryClientOptions,
  });

  return {
    name: '@conloca/astro-cms',
    hooks: {
      'astro:config:setup': ({ updateConfig, injectRoute, command }) => {
        // Only inject routes in dev mode
        if (command !== 'dev') return;

        // Pass options via environment variables for API routes
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
                name: 'puck-config-virtual-module',
                resolveId(id) {
                  if (id === `${cmsRoute}/puck-entry.js`) {
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
                  return null;
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

        // Configure spa-handler with updated options
        configureSpaHandler({
          basename: cmsRoute,
          apiBaseUrl: `${cmsRoute}/api`,
          siteBaseUrl: options.siteBaseUrl,
          enableDevtools: options.enableDevtools,
          queryClientOptions: options.queryClientOptions,
        });
      },
    },
  };
}
