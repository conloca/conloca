import { resolve } from 'node:path';
import { type Plugin, runnerImport, type UserConfig } from 'vite';
import type { FragmentComponentsModule } from '../handlers/page-render-core.js';
import { discoverFragmentIslands } from '../lib/hydration-scanner.js';

const CHECK_ENTRY = 'virtual:conloca-fragment-check';

/** The render module, and each island the build discovers in its imports as `[key, component]`, from one module graph. */
export interface CheckEntry {
  render: FragmentComponentsModule;
  islands: [string, object | undefined][];
}

/**
 * Serves an entry that imports the render module and every module the island discovery maps, so their components are
 * the same function objects the render module holds: the published render maps islands by identity.
 */
function checkEntryPlugin(renderModulePath: string): Plugin {
  return {
    name: 'conloca:fragment-check-entry',
    resolveId: (id) => (id === CHECK_ENTRY ? `\0${CHECK_ENTRY}` : undefined),
    async load(id) {
      if (id !== `\0${CHECK_ENTRY}`) return undefined;
      const islands = await discoverFragmentIslands(renderModulePath, (s, i) => this.resolve(s, i));
      return [
        `import * as render from ${JSON.stringify(renderModulePath)};`,
        ...islands.map(({ filePath }, i) => `import * as island${i} from ${JSON.stringify(filePath)};`),
        'export { render };',
        `export const islands = [${islands.map(({ key, exportName }, i) => `[${JSON.stringify(key)}, island${i}[${JSON.stringify(exportName)}]]`).join(', ')}];`,
      ].join('\n');
    },
  };
}

// shortcut: shared only when the site and its integrations resolve the same copy of this module; another copy loads
// again, which is correct but slower. Upgrade by passing the loaded module along if a site needs it.
const loads = new Map<string, Promise<CheckEntry>>();

/**
 * Load the site's `fragmentComponentsPath` module once per process for its root and resolved path, so the build's
 * component check and the component manifest share one load. A rejected load stays cached: both see the same error.
 */
export function loadFragmentRender(input: {
  root: string;
  vite: UserConfig;
  fragmentComponentsPath: string;
}): Promise<CheckEntry> {
  // One spelling per directory: callers pass `process.cwd()` or a root URL path with a trailing slash.
  const root = resolve(input.root);
  const renderModulePath = resolve(root, input.fragmentComponentsPath);
  const key = `${root}\0${renderModulePath}`;
  let load = loads.get(key);
  if (!load) {
    load = runnerImport<CheckEntry>(CHECK_ENTRY, {
      ...input.vite,
      plugins: [...(input.vite.plugins ?? []), checkEntryPlugin(renderModulePath)],
      configFile: false,
      root,
      logLevel: 'warn',
    }).then(({ module }) => module);
    loads.set(key, load);
  }
  return load;
}
