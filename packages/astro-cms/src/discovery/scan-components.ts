import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import fg from 'fast-glob';
import type { Project } from 'ts-morph';
import { extractAstroFrontmatter } from './astro-frontmatter.js';
import { createScanProject, extractPropsViaTs } from './extract-props-ts.js';
import type { MdxScanResult } from './scan-mdx';

/**
 * Walks configured folder globs for `.astro` and `.tsx` files,
 * extracts each component's `Props` interface, and returns a
 * descriptor-friendly schema. Used alongside `scan-mdx.ts` to
 * populate the CMS registry without the host hand-writing
 * `mdx-components.tsx`.
 *
 * Type extraction uses the TypeScript compiler API (via ts-morph,
 * see `./extract-props-ts.ts`). Derived types — `(typeof X)[number]`,
 * imported aliases, mapped types, conditional types — all resolve
 * to their concrete shape, which is what makes the registry feel
 * smart for real component libraries (eg Starlight's Aside, whose
 * `type` prop uses indexed access). For `.astro` files we extract
 * the leading `---` frontmatter block and feed it to the same
 * extractor as a virtual `.ts` source.
 *
 * A single ts-morph Project is built per scan run and shared across
 * every file in that run, so the per-file cost is small after the
 * initial type-checker warmup. Sidecar `cmsConfig` overrides still
 * apply (see `./scan-overrides.ts`) for components whose author
 * wants to override or annotate fields beyond what the type says.
 *
 * Component name = basename of the file without extension.
 * Component source = the resolved file path. The render endpoint
 * hands this to `server.ssrLoadModule`, which accepts absolute
 * paths in dev.
 */
export interface ParsedProp {
  name: string;
  /** Inferred from the TypeScript type annotation. `'string'` covers
   * literal-string unions too — `options` holds the union values
   * when applicable so the prop panel can render a dropdown. */
  type: 'string' | 'number' | 'boolean' | 'expression';
  /** True when the prop's TS field lacks a `?` modifier. */
  required: boolean;
  /** Literal-string union values, eg `'note' | 'tip' | 'caution'`. */
  options?: string[];
}

export interface LocalComponentScanResult {
  /** Absolute file path of the component. */
  filepath: string;
  /** Component name (filename without extension). */
  name: string;
  /** Path to pass to `server.ssrLoadModule` — currently the absolute
   * file path. The path the import statement should use in MDX is
   * the project-relative form (so save serialization stays portable);
   * we keep both. */
  source: string;
  /** Project-relative path used when emitting `import` statements
   * for newly-inserted components. */
  importSpecifier: string;
  /** All components from this scanner are treated as flow (block).
   * Inline-only components are rare in authored libraries; if any
   * surface as text-level usage they get classified at merge time
   * from the MDX scan, not here. */
  kind: 'flow';
  props: ParsedProp[];
}

/**
 * Scan every `.astro` / `.tsx` file under each configured folder.
 * Folder globs are resolved relative to `projectRoot`.
 */
export async function scanLocalComponents(folders: string[], projectRoot: string): Promise<LocalComponentScanResult[]> {
  if (folders.length === 0) return [];
  // Source files (`.astro` for Astro, `.tsx` for React) first; `.d.ts`
  // declaration files only if no matching source file exists. Same
  // priority rationale as `scanExternalComponents` — host source is
  // ground truth, declarations are last-resort schema.
  const sourcePatterns = folders.map((f) => `${f.replace(/\/+$/, '')}/**/*.{astro,tsx}`);
  const dtsPatterns = folders.map((f) => `${f.replace(/\/+$/, '')}/**/*.d.ts`);
  const sourceFiles = await fg(sourcePatterns, { cwd: projectRoot, absolute: true, dot: false });
  const dtsFiles = await fg(dtsPatterns, { cwd: projectRoot, absolute: true, dot: false });
  const seen = new Set<string>();
  const allFiles: string[] = [];
  for (const file of sourceFiles) {
    const name = componentNameFromPath(file);
    if (seen.has(name)) continue;
    seen.add(name);
    allFiles.push(file);
  }
  for (const file of dtsFiles) {
    const name = componentNameFromPath(file);
    if (seen.has(name)) continue;
    seen.add(name);
    allFiles.push(file);
  }
  // One ts-morph Project per scan run, shared across every file
  // we extract from. Building the Project loads `lib.dom.d.ts` etc.
  // (the dominant cost ~500ms-2s); sharing across files amortises
  // it. Fed the host's tsconfig when present so cross-file `typeof`
  // refs and path mappings (`@/foo`) resolve as authored.
  const tsConfigFilePath = findTsConfig(projectRoot);
  const project = createScanProject(tsConfigFilePath);

  const results: LocalComponentScanResult[] = [];
  for (const file of allFiles) {
    try {
      const r = await scanFile(file, projectRoot, project);
      if (r) results.push(r);
    } catch (err) {
      console.warn(`[conloca:discovery] failed to scan ${file}:`, err instanceof Error ? err.message : err);
    }
  }
  return results;
}

async function scanFile(
  filepath: string,
  projectRoot: string,
  project: Project,
): Promise<LocalComponentScanResult | null> {
  const content = await readFile(filepath, 'utf8');
  const name = componentNameFromPath(filepath);
  // Components typically start with a capital. Lowercase-named files
  // are usually utilities, not authorable components — skip them so
  // we don't pollute the registry with `helpers.ts` and friends.
  if (!/^[A-Z]/.test(name)) return null;
  const props = extractPropsForFile(project, filepath, content, name);
  const importSpecifier = `/${relative(projectRoot, filepath).replace(/\\/g, '/')}`;
  return {
    filepath,
    name,
    source: filepath,
    importSpecifier,
    kind: 'flow',
    props,
  };
}

/**
 * Bridge between the file-level scanner and the ts-morph extractor.
 * Handles the three file types we accept:
 *   - `.astro` — extract the `---`-fenced frontmatter, feed it as
 *     a virtual `.ts` source.
 *   - `.tsx` / `.d.ts` — feed the whole file content directly.
 *
 * The virtual source path is the real filepath suffixed with
 * `.virtual.ts` for `.astro` files, so ts-morph's diagnostics still
 * point back at the right author file. For `.tsx` / `.d.ts` we use
 * the real path verbatim — ts-morph parses TS extensions natively.
 */
function extractPropsForFile(project: Project, filepath: string, content: string, componentName: string): ParsedProp[] {
  if (filepath.endsWith('.astro')) {
    const frontmatter = extractAstroFrontmatter(content);
    if (!frontmatter) return [];
    return extractPropsViaTs(project, `${filepath}.virtual.ts`, frontmatter, componentName);
  }
  return extractPropsViaTs(project, filepath, content, componentName);
}

/**
 * Locate the host's `tsconfig.json` so the ts-morph Project can
 * resolve cross-file `typeof` refs, path aliases, and node_modules
 * declarations the same way the author's IDE does. Walks up from
 * `projectRoot` looking for the closest tsconfig; returns `undefined`
 * if none found (the Project then uses permissive defaults).
 */
function findTsConfig(projectRoot: string): string | undefined {
  const candidate = resolve(projectRoot, 'tsconfig.json');
  return existsSync(candidate) ? candidate : undefined;
}

/**
 * Derive the canonical component name from a file path.
 *
 * Two extension shapes:
 *   - Single (`.astro`, `.tsx`) → strip with `extname`/`basename`.
 *   - Compound (`.d.ts`) → strip `.d.ts` explicitly, since `extname`
 *     would return only `.ts` and leave a trailing `.d` (`Card.d`).
 *
 * Keeps the rule simple and consistent: file basename === component
 * name. Multi-component files (a `.d.ts` exporting many React
 * components from one barrel) are NOT supported through this path —
 * the sidecar `cmsConfig` mechanism (future task) covers those.
 */
function componentNameFromPath(filepath: string): string {
  const base = basename(filepath);
  if (base.endsWith('.d.ts')) return base.slice(0, -'.d.ts'.length);
  return base.slice(0, -extname(base).length);
}

/**
 * Scan every npm-style import source referenced in the MDX usage scan
 * and treat any `.astro` / `.tsx` file inside the resolved package as a
 * candidate component. Resolves each unique specifier via Node's
 * `require.resolve` (run from `projectRoot` so packages are looked up
 * in the consumer's `node_modules`, not ours), walks up to the package
 * root, then globs the package for component-shaped files.
 *
 * The returned `source` on each result is the ORIGINAL specifier from
 * the MDX import (e.g. `@astrojs/starlight/components`) — not the
 * resolved file path. That's what makes the merge work: `scan-mdx`
 * records imports by their literal source string, so for the merge
 * registry to dedupe local-folder scan ⨯ MDX-usage scan we need both
 * sides to key on the same specifier. Vite's `ssrLoadModule` handles
 * the specifier itself at render time, so we don't need an absolute
 * file path on the descriptor.
 *
 * Caveats:
 *   - Specifiers that look like local paths (`./foo`, `/abs/path`) are
 *     intentionally skipped here — those are local components, already
 *     covered by `scanLocalComponents`.
 *   - One specifier per package: if a package is imported via two
 *     different specifiers (`@pkg/components` and `@pkg`), we'll scan
 *     it twice and emit two descriptor sets keyed on each specifier.
 *     The merge layer's collision resolution picks the one with more
 *     real usage, so this is self-correcting in practice.
 *   - We cap glob depth at 4 to avoid walking into deeply-nested
 *     library internals (most component packages put their exports
 *     near the root). Components nested deeper won't surface; hosts
 *     can either re-export them at a shallower path or add a sidecar
 *     `cmsConfig` (when sidecar support lands).
 */
export async function scanExternalComponents(
  mdxScans: MdxScanResult[],
  projectRoot: string,
): Promise<LocalComponentScanResult[]> {
  const specifiers = collectExternalSpecifiers(mdxScans);
  if (specifiers.size === 0) return [];

  // Same Project-per-scan rationale as scanLocalComponents — pay the
  // checker init cost once, share across every external file.
  const tsConfigFilePath = findTsConfig(projectRoot);
  const project = createScanProject(tsConfigFilePath);

  const results: LocalComponentScanResult[] = [];
  // `createRequire(projectRoot/package.json)` so resolution starts in
  // the consumer's tree. Without this, Node looks up modules relative
  // to wherever this file lives (our package), which would miss the
  // consumer's installed dependencies.
  const requireFromProject = createRequire(`${projectRoot.replace(/\/$/, '')}/package.json`);

  for (const specifier of specifiers) {
    try {
      const resolved = requireFromProject.resolve(specifier);
      const packageRoot = findPackageRoot(resolved);
      if (!packageRoot) continue;

      // First try: parse the resolved file as a re-export barrel
      // (`export { default as Card } from './user-components/Card.astro'`).
      // If we find re-exports, scan ONLY those files — the package's
      // own author has declared the public surface, and everything
      // else is internal noise we don't want in the registry.
      //
      // This is the Starlight case: `@astrojs/starlight/components`
      // resolves to a barrel `.ts` listing exactly the 12 components
      // the package intends for MDX use, hiding ~30 internal layout
      // components in the same `node_modules` tree.
      const barrelFiles = await collectBarrelExports(resolved, packageRoot);
      let scanFiles: string[];
      if (barrelFiles.length > 0) {
        scanFiles = barrelFiles;
      } else {
        // Fallback: glob the whole package. Source files (`.astro`,
        // `.tsx`) first, then `.d.ts` as a last-resort schema source
        // for compiled packages. Dedupe by component name so a package
        // shipping BOTH `Card.tsx` and `Card.d.ts` uses the source
        // file (more reliable schema) and ignores the declaration.
        const sourceFiles = await fg('**/*.{astro,tsx}', {
          cwd: packageRoot,
          absolute: true,
          dot: false,
          deep: 4,
        });
        const dtsFiles = await fg('**/*.d.ts', {
          cwd: packageRoot,
          absolute: true,
          dot: false,
          deep: 4,
        });
        const seen = new Set<string>();
        scanFiles = [];
        for (const file of [...sourceFiles, ...dtsFiles]) {
          const name = componentNameFromPath(file);
          if (seen.has(name)) continue;
          seen.add(name);
          scanFiles.push(file);
        }
      }

      for (const file of scanFiles) {
        try {
          const r = await scanExternalFile(file, specifier, project);
          if (r) results.push(r);
        } catch (err) {
          console.warn(`[conloca:discovery] failed to scan ${file}:`, err instanceof Error ? err.message : err);
        }
      }
    } catch (err) {
      // Resolution failures are common and expected — a `./local.css`
      // import or a missing optional peer dep both land here. Skip
      // quietly rather than failing the whole registry build.
      console.warn(
        `[conloca:discovery] could not resolve '${specifier}' from ${projectRoot}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return results;
}

/**
 * Same parsing as `scanFile`, but with `source` set to the original
 * npm specifier instead of the absolute file path. See the function
 * doc on `scanExternalComponents` for why.
 */
async function scanExternalFile(
  filepath: string,
  specifier: string,
  project: Project,
): Promise<LocalComponentScanResult | null> {
  const content = await readFile(filepath, 'utf8');
  const name = componentNameFromPath(filepath);
  if (!/^[A-Z]/.test(name)) return null;
  const props = extractPropsForFile(project, filepath, content, name);
  return {
    filepath,
    name,
    // CRITICAL: source = specifier (not filepath) so merge-registry
    // joins this entry with MDX-usage entries that key on the same
    // specifier. See the merge logic at `byKey` in merge-registry.ts.
    source: specifier,
    importSpecifier: specifier,
    kind: 'flow',
    props,
  };
}

/**
 * Pick out unique npm-style specifiers from every import seen in the
 * MDX scan. Local paths (`./foo`, `/abs`) are dropped — `scanLocalComponents`
 * covers those via its folder glob.
 */
function collectExternalSpecifiers(mdxScans: MdxScanResult[]): Set<string> {
  const out = new Set<string>();
  for (const scan of mdxScans) {
    for (const imp of Object.values(scan.imports)) {
      const src = imp.source;
      if (!src) continue;
      // Local-path indicators per ESM spec: starts with `.` (`./foo`,
      // `../bar`) or `/` (absolute). Everything else is treated as
      // npm-resolvable.
      if (src.startsWith('.') || src.startsWith('/')) continue;
      out.add(src);
    }
  }
  return out;
}

/**
 * If `resolvedFile` is a barrel (re-export aggregator), return the
 * absolute paths of every re-exported component file. Otherwise
 * return an empty array.
 *
 * Patterns recognized:
 *   - `export { default as Foo } from './path/to/Foo.astro'`
 *   - `export { Foo } from './path/to/Foo'`
 *   - `export { Foo, Bar } from './path/to/m'`
 *   - `export * from './path/to/m'`        (treated as opaque — we
 *                                            can't enumerate the
 *                                            names without a real
 *                                            parser, so we skip and
 *                                            fall back to glob-all)
 *
 * The barrel must resolve to a real file we can re-resolve to one of
 * the supported extensions (`.astro`, `.tsx`, `.d.ts`). Missing or
 * unsupported targets are dropped quietly. Comments are stripped
 * first to avoid matching commented-out exports.
 *
 * Why this matters: Starlight's `@astrojs/starlight/components`
 * barrel lists exactly the 12 MDX-friendly components. Globbing the
 * whole package would also pull in ~30 internal layout components
 * (Banner, Hero, Pagination, ...) — they'd litter the slash menu
 * even though they're not meant for author use.
 */
async function collectBarrelExports(resolvedFile: string, packageRoot: string): Promise<string[]> {
  // Only `.ts` / `.js` / `.mjs` source files can be barrels; an
  // `.astro` or `.tsx` file is the component itself, not an
  // aggregator. Bail early to avoid reading binary or unsupported
  // file types.
  if (!/\.(?:m?[jt]s)$/.test(resolvedFile)) return [];

  let content: string;
  try {
    content = await readFile(resolvedFile, 'utf8');
  } catch {
    return [];
  }
  const cleaned = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  // Collect the relative source paths from every `export {...} from '<path>'`.
  // We don't need the export names here — we just need the files to
  // scan. Each scanned file's component name comes from its own
  // basename, the same way local components work.
  const pathRe = /export\s*(?:\{[^}]*\}|\*)\s*from\s*['"]([^'"]+)['"]/g;
  const relPaths = new Set<string>();
  for (const m of cleaned.matchAll(pathRe)) {
    const rel = m[1];
    // Skip `export *` — we can't enumerate without a real parser, and
    // re-running the barrel collector recursively would invite cycles.
    // Falls through to glob-all below if no other re-exports exist.
    if (!rel) continue;
    relPaths.add(rel);
  }
  if (relPaths.size === 0) return [];

  // Resolve each relative path. `import.meta.resolve` doesn't take a
  // base file, so use the barrel's directory as the resolution root.
  const barrelDir = dirname(resolvedFile);
  const requireFromBarrel = createRequire(`${barrelDir}/_.js`);
  const resolved: string[] = [];
  for (const rel of relPaths) {
    try {
      const target = requireFromBarrel.resolve(rel);
      // Only keep targets that look like component files we can
      // scan (extensions our extractor supports) AND live inside
      // the package root (defensive — barrels in the wild can
      // re-export from sibling packages, which we don't want to
      // descend into).
      if (!/\.(?:astro|tsx|d\.ts)$/.test(target)) continue;
      if (!target.startsWith(packageRoot)) continue;
      resolved.push(target);
    } catch {
      // Missing optional file or extension we don't handle — skip.
    }
  }
  return resolved;
}

/**
 * Walk up from a resolved file path until we find the directory that
 * contains the closest `package.json`. That's the package root we'll
 * glob for component files. Returns `null` if no package.json is found
 * within a reasonable depth (defensive — shouldn't happen for a real
 * resolution).
 */
function findPackageRoot(resolvedPath: string): string | null {
  let dir = dirname(resolvedPath);
  for (let i = 0; i < 10; i++) {
    // Sync existsSync is fine here — the walk is at most ~10 hops per
    // package and runs once per unique specifier per scan.
    if (existsSync(`${dir}/package.json`)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

// Prop extraction lives in `./extract-props-ts.ts` (TypeScript
// compiler API via ts-morph). The previous regex-based scanner —
// `extractPropsInterface` + `parseTypeExpr` — was removed in the
// migration: it silently dropped options for derived types like
// `(typeof asideVariants)[number]`, mapped types, conditional types,
// and imported aliases. The ts-morph path resolves all of those.
// Astro frontmatter extraction lives in `./astro-frontmatter.ts`.
