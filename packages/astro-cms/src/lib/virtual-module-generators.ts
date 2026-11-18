import { fileURLToPath } from 'node:url';
import type { ResolvedRoutingConfig, RoutingConfig } from '../types.js';
import type { FragmentIslandDiscovery, HydrationDiscovery } from './hydration-scanner.js';

/** One `key: () => import(module).then((m) => m[export])` loader per island, so each island module is its own chunk. */
function islandLoaders(islands: readonly FragmentIslandDiscovery[]): string {
  const entries = islands.map(
    ({ key, filePath, exportName }) =>
      `  ${JSON.stringify(key)}: () => import(${JSON.stringify(filePath)}).then((m) => m[${JSON.stringify(exportName)}])`,
  );
  return entries.length === 0 ? '{}' : `{\n${entries.join(',\n')}\n}`;
}

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

/**
 * Generate the virtual:conloca-content-schemas module: the site's
 * `contentSchemasPath` module — the `pageSchemas` / `dataSchemas` its content
 * config hands the collection factories — for a draft preview to build the
 * same collection schemas from. Not the content config itself: that imports
 * build-time loaders, which cannot be evaluated in a server runtime.
 *
 * Imported lazily, on the first call, so only a preview render evaluates it.
 *
 * @param contentSchemasPath - Absolute path of the module, or undefined when the site names none
 * @returns JavaScript module code as a string
 */
export function generateContentSchemasModule(contentSchemasPath: string | undefined): string {
  if (contentSchemasPath === undefined) {
    return 'export function loadContentSchemas() { return Promise.resolve({}); }';
  }

  return `export function loadContentSchemas() { return import(${JSON.stringify(contentSchemasPath)}); }`;
}

/**
 * Generate the virtual:conloca-fragment-components module: the site's
 * `fragmentComponentsPath` module, imported on the first call, and a loader per
 * hydrated fragment component it imports. Mirrors {@link generateContentSchemasModule}.
 *
 * @param fragmentComponentsPath - Absolute path of the module, or undefined when the site names none
 * @param islands - The render module's hydrated imports, from `discoverFragmentIslands`
 * @returns JavaScript module code as a string
 */
export function generateFragmentComponentsModule(
  fragmentComponentsPath: string | undefined,
  islands: readonly FragmentIslandDiscovery[],
): string {
  // JSON.stringify(undefined) is undefined, which interpolates as the literal `undefined`.
  const pathExport = `export const fragmentComponentsPath = ${JSON.stringify(fragmentComponentsPath)};`;
  const loadersExport = `export const fragmentIslandLoaders = ${islandLoaders(islands)};`;
  if (fragmentComponentsPath === undefined) {
    return `${pathExport}\n${loadersExport}\nexport function loadFragmentComponents() { return Promise.resolve({}); }`;
  }

  return `${pathExport}\n${loadersExport}\nexport function loadFragmentComponents() { return import(${JSON.stringify(fragmentComponentsPath)}); }`;
}

/**
 * Generate the virtual:conloca-hydration-registry module: the Puck blocks'
 * `componentRegistry` and the fragment islands' `fragmentRegistry`.
 *
 * @param discoveries - Hydrated Puck blocks, from `scanForHydratableComponents`
 * @param projectRoot - Stripped from each block path to give a Vite root-relative path
 * @param islands - The render module's hydrated imports, from `discoverFragmentIslands`
 * @returns JavaScript module code as a string
 */
export function generateHydrationRegistryModule(
  discoveries: readonly HydrationDiscovery[],
  projectRoot: string,
  islands: readonly FragmentIslandDiscovery[],
): string {
  const fragmentRegistry = `export const fragmentRegistry = ${islandLoaders(islands)};`;
  if (discoveries.length === 0) {
    return `export const componentRegistry = {};\n${fragmentRegistry}`;
  }
  const entries = discoveries.map((d) => {
    const relativePath = d.filePath.replace(projectRoot, '');
    return `  '${d.componentName}': {
    loader: () => import('${relativePath}').then(m => m.${d.componentName}.render),
    strategy: '${d.strategy}',
  }`;
  });
  return `// Generated by @conloca/astro-cms scanner
export const componentRegistry = {
${entries.join(',\n')}
};
${fragmentRegistry}`;
}

/**
 * Generate the virtual:conloca-hydration-entry module the page handler loads on pages with islands or hydrated blocks.
 * In dev it imports the React refresh preamble first: plugin-react rewrites the loaded `.tsx` with Fast Refresh calls
 * that throw while `$RefreshSig$` is unset.
 */
export function generateHydrationEntryModule(dev: boolean): string {
  return `${dev ? "import 'virtual:conloca-react-refresh-preamble'\n" : ''}import { initHydration } from '@conloca/astro-cms/lib/hydration-script'
import { componentRegistry, fragmentRegistry } from 'virtual:conloca-hydration-registry'

// Auto-initialize hydration when this module loads
initHydration(componentRegistry, fragmentRegistry)
`;
}

/**
 * Generate the virtual:conloca-site-render module the dev editor's site-render
 * entry reads: the site's fragment vocabulary, its editor frames and the
 * fragment renderer, for `setSiteRender` in cms-spa.
 *
 * @param fragmentComponentsPath - Absolute path of the render module, or undefined when the site names none
 * @param editorFrames - Route name → absolute path of that route's frame module
 * @returns JavaScript module code as a string
 */
export function generateSiteRenderModule(
  fragmentComponentsPath: string | undefined,
  editorFrames: Record<string, string>,
): string {
  const frames = Object.entries(editorFrames);
  // Resolved from astro-cms, so a site need not depend on @conloca/mdx itself.
  const renderPath = fileURLToPath(import.meta.resolve('@conloca/mdx/render'));
  return [
    fragmentComponentsPath === undefined
      ? 'export const fragmentComponents = undefined;'
      : `import * as fragmentRender from ${JSON.stringify(fragmentComponentsPath)};\nexport const fragmentComponents = fragmentRender.fragmentComponents;`,
    ...frames.map(([, path], i) => `import * as frame${i} from ${JSON.stringify(path)};`),
    `export const editorFrames = { ${frames.map(([name], i) => `${JSON.stringify(name)}: frame${i}.default`).join(', ')} };`,
    `export { evaluateMDXToComponent } from ${JSON.stringify(renderPath)};`,
  ].join('\n');
}
