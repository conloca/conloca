import { isAbsolute, relative, resolve, sep } from 'node:path';
import { type DiscoveredComponent, mergeRegistry } from './merge-registry.js';
import { scanExternalComponents, scanLocalComponents } from './scan-components.js';
import { scanMdxFiles } from './scan-mdx.js';
import { loadCmsOverrides } from './scan-overrides.js';

/**
 * Inputs for the MDX component registry scan. Resolved ONCE by the
 * integration so the dev endpoint and a build-time integration cannot drift.
 */
export interface MdxRegistryScanOptions {
  /** Absolute or project-relative path to the MDX content directory. */
  contentRoot: string;
  /** Project-relative paths to scan for local components. */
  componentFolders: string[];
  /** Project-relative folder of `*.cms.json` sidecar override files,
   * keyed by component basename (`Card.cms.json` → overrides `Card`).
   * Defaults to `src/cms-overrides` — hosts can omit it when they
   * don't need any overrides yet. */
  overridesFolder?: string;
  /** Base for resolving the paths above. Defaults to `process.cwd()`. */
  projectRoot?: string;
}

/**
 * The three-stage auto-discovery pipeline behind the editor's MDX
 * component registry (scan-mdx + scan-components + merge-registry).
 *
 * Free of any dev-server dependency on purpose: dev serves the result
 * from `/__cms/api/registry`, and a build-time caller, where no dev server
 * runs, calls this same function. One scan implementation is the only way
 * both can agree.
 */
export async function discoverMdxComponents(options: MdxRegistryScanOptions): Promise<DiscoveredComponent[]> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const contentRoot = resolve(projectRoot, options.contentRoot);
  // MDX scan first — its results feed BOTH the merge step AND the
  // external-package scan (which uses the imports to know what
  // packages to walk into).
  const mdxScans = await scanMdxFiles(contentRoot);
  const overridesFolder = options.overridesFolder ?? 'src/cms-overrides';
  const [localComponents, externalComponents, overrides] = await Promise.all([
    scanLocalComponents(options.componentFolders, projectRoot),
    scanExternalComponents(mdxScans, projectRoot),
    loadCmsOverrides(overridesFolder, projectRoot),
  ]);
  // External (npm) and local components live in disjoint key
  // spaces — external source strings are npm specifiers, local
  // source strings are absolute paths — so they never collide on
  // the `${source}::${name}` dedup key. The interesting collision
  // case is two sources sharing a `name`; that pass is resolved
  // inside `mergeRegistry` by usage count (see rule 6 in its top
  // doc). Host sidecar overrides apply last as the highest-priority
  // layer (see `applyOverride` in merge-registry).
  return mergeRegistry(mdxScans, [...externalComponents, ...localComponents], overrides);
}

/**
 * Rewrites absolute local-component import specifiers to project-relative
 * ones (`/src/components/mdx/Aside.tsx`), and `aliases` keys — absolute MDX
 * file paths of the scanning machine — the same way.
 *
 * The scanner records a local component's `import.from` as its absolute file
 * path, which is what the dev render endpoint hands to `ssrLoadModule`. That
 * path is machine-specific: descriptors that outlive the scan (saved with the
 * site's MDX files, say) would carry the scanning machine's prefix into the
 * repository and break the next build elsewhere. Callers whose descriptors
 * outlive the scan apply it; the dev endpoint keeps the paths its loader
 * expects. npm specifiers and paths outside the project are left untouched.
 */
export function toPortableImports(components: DiscoveredComponent[], projectRoot: string): DiscoveredComponent[] {
  return components.map((component) => {
    let next = component;
    const imported = component.import;
    const portableFrom = imported === undefined ? undefined : toProjectRelative(imported.from, projectRoot);
    if (imported && portableFrom !== undefined) {
      next = { ...next, import: { ...imported, from: portableFrom } };
    }
    if (component.aliases) {
      next = {
        ...next,
        aliases: Object.fromEntries(
          Object.entries(component.aliases).map(([file, alias]) => [
            toProjectRelative(file, projectRoot) ?? file,
            alias,
          ]),
        ),
      };
    }
    return next;
  });
}

/**
 * One absolute path → project-relative `/src/...` specifier, or `undefined`
 * when the path is not absolute or falls outside the project. The
 * outside-project guard matches `..` segments only (a directory literally
 * named `..foo` is INSIDE the project and must rewrite); `isAbsolute` catches
 * the Windows different-drive case, where `relative()` returns an absolute
 * path instead of `..` hops.
 */
function toProjectRelative(path: string, projectRoot: string): string | undefined {
  if (!isAbsolute(path)) return undefined;
  const relativePath = relative(projectRoot, path);
  if (relativePath === '' || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath))
    return undefined;
  return `/${relativePath.replace(/\\/g, '/')}`;
}
