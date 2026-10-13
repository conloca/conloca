import type { ResolvedRoutingConfig, RoutingConfig } from '../types.js';

/**
 * Generate the virtual:conloca-routing-config module.
 *
 * Returns a module that exports the resolved routing configuration as default.
 *
 * @param config - Resolved routing configuration with all defaults applied
 * @returns JavaScript module code as a string
 */
export function generateRoutingConfigModule(config: ResolvedRoutingConfig): string {
  return `export default ${JSON.stringify(config, null, 2)};`;
}

/**
 * Generate the virtual:conloca-layout module.
 *
 * Returns a module that re-exports the layout component or exports undefined
 * if no layout is configured.
 *
 * Currently uses the first route's layout. Multi-layout support is future work.
 *
 * @param routing - Routing configuration (may be undefined if routing disabled)
 * @returns JavaScript module code as a string
 */
export function generateLayoutModule(routing: RoutingConfig | undefined): string {
  // Get layout from first route (for now - multi-layout is future work)
  const routes = routing?.routes || {};
  const firstRoute = Object.values(routes)[0];
  const layoutPath = firstRoute?.layout;

  if (layoutPath) {
    // Convert relative path to absolute for Vite resolution
    // ./src/... -> /src/...
    const absolutePath = layoutPath.startsWith('.') ? `/${layoutPath.slice(2)}` : layoutPath;

    return `export { default } from '${absolutePath}';`;
  }

  return 'export default undefined;';
}

/**
 * Generate the virtual:conloca-puck-config module.
 *
 * Returns a module that re-exports the Puck configuration.
 * This is separate from the HMR-enabled puck-entry.js used by the CMS SPA.
 *
 * @param puckConfigPath - Path to the puck config module
 * @returns JavaScript module code as a string
 */
export function generatePuckConfigModule(puckConfigPath: string): string {
  // Convert relative path to absolute for Vite resolution
  // ./src/... -> /src/...
  const absolutePath = puckConfigPath.startsWith('.') ? `/${puckConfigPath.slice(2)}` : puckConfigPath;

  return `export { default } from '${absolutePath}';`;
}
