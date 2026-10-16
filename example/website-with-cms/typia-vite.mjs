import { fileURLToPath } from 'node:url';
import ttsc from '@ttsc/unplugin/vite';

const project = fileURLToPath(new URL('./tsconfig.typia.json', import.meta.url));

/**
 * Native Typia transform for the modules under `src/schemas/`, which author
 * `typia.*<T>()` call sites. Both consumers of those modules go through this
 * Vite pipeline: Astro's content config (entry validation in the Conloca
 * loader) and the CMS editor bundle (`schemasPath`).
 *
 * @returns {import('vite').Plugin[]}
 */
export function schemaTypia() {
  const plugins = ttsc({ project });
  return (Array.isArray(plugins) ? plugins : [plugins]).map((plugin) => {
    const transform = plugin.transform;
    if (!transform) return plugin;
    const hook = typeof transform === 'function' ? { handler: transform } : transform;
    return { ...plugin, transform: { ...hook, filter: { ...hook.filter, id: /[\\/]src[\\/]schemas[\\/]/ } } };
  });
}
