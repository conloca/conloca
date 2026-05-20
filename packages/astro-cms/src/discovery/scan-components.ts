import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, extname, relative } from 'node:path';
import fg from 'fast-glob';
import type { MdxScanResult } from './scan-mdx';

/**
 * Walks configured folder globs for `.astro` and `.tsx` files,
 * extracts each component's `Props` interface, and returns a
 * descriptor-friendly schema. Used alongside `scan-mdx.ts` to
 * populate the CMS registry without the host hand-writing
 * `mdx-components.tsx`.
 *
 * The extraction is regex-based — not a real TS parser. That's
 * intentional: most authored components define `Props` as a flat
 * interface with primitive types, and regex covers that 90% case
 * without pulling in TypeScript or a full AST parser. Components
 * with complex generic Props, mapped types, or inheritance fall
 * through to "no inferred props" — the editor still discovers them
 * by name and lets the author edit attributes free-form. Sidecar
 * `cmsConfig` overrides cover anything the regex misses.
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
  const patterns = folders.map((f) => `${f.replace(/\/+$/, '')}/**/*.{astro,tsx}`);
  const files = await fg(patterns, { cwd: projectRoot, absolute: true, dot: false });
  const results: LocalComponentScanResult[] = [];
  for (const file of files) {
    try {
      const r = await scanFile(file, projectRoot);
      if (r) results.push(r);
    } catch (err) {
      console.warn(`[conloca:discovery] failed to scan ${file}:`, err instanceof Error ? err.message : err);
    }
  }
  return results;
}

async function scanFile(filepath: string, projectRoot: string): Promise<LocalComponentScanResult | null> {
  const content = await readFile(filepath, 'utf8');
  const name = basename(filepath, extname(filepath));
  // Components typically start with a capital. Lowercase-named files
  // are usually utilities, not authorable components — skip them so
  // we don't pollute the registry with `helpers.ts` and friends.
  if (!/^[A-Z]/.test(name)) return null;
  const props = extractPropsInterface(content);
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
      const files = await fg('**/*.{astro,tsx}', {
        cwd: packageRoot,
        absolute: true,
        dot: false,
        deep: 4,
      });
      for (const file of files) {
        try {
          const r = await scanExternalFile(file, specifier);
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
async function scanExternalFile(filepath: string, specifier: string): Promise<LocalComponentScanResult | null> {
  const content = await readFile(filepath, 'utf8');
  const name = basename(filepath, extname(filepath));
  if (!/^[A-Z]/.test(name)) return null;
  const props = extractPropsInterface(content);
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

/**
 * Pull the `interface Props { ... }` block out of source and parse
 * each field. Two acceptable forms:
 *
 *   interface Props { ... }
 *   type Props = { ... }
 *
 * Inside the braces, each prop is `name: type` or `name?: type`,
 * one per line (with optional trailing semicolons or commas).
 * Comments are stripped before matching.
 */
function extractPropsInterface(source: string): ParsedProp[] {
  // Strip block + line comments so they don't confuse the field
  // matcher. Crude but safe: comments in TS source code don't
  // contain `}` followed by newline at the top level for any
  // realistic component header.
  const cleaned = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  // Match `interface Props { ... }` OR `type Props = { ... }`.
  // Brace matching is non-trivial with nested objects; we use a
  // small hand-rolled balancer to be robust to nested types like
  // `events: { onClick: () => void }`.
  const startMatch = /(?:interface\s+Props\s*\{|type\s+Props\s*=\s*\{)/.exec(cleaned);
  if (!startMatch) return [];
  let depth = 1;
  let i = startMatch.index + startMatch[0].length;
  const startBody = i;
  while (i < cleaned.length && depth > 0) {
    const ch = cleaned[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  if (depth !== 0) return [];
  const body = cleaned.slice(startBody, i - 1);

  const props: ParsedProp[] = [];
  // Split fields by top-level `;` or newline. Track brace depth so
  // splits don't fire inside nested `{ ... }` types.
  const fields: string[] = [];
  {
    let buf = '';
    let bd = 0;
    for (const c of body) {
      if (c === '{') bd++;
      if (c === '}') bd--;
      if (bd === 0 && (c === ';' || c === '\n')) {
        if (buf.trim()) fields.push(buf.trim());
        buf = '';
        continue;
      }
      buf += c;
    }
    if (buf.trim()) fields.push(buf.trim());
  }

  for (const field of fields) {
    const m = /^([A-Za-z_$][\w$]*)\s*(\?)?\s*:\s*(.+?)\s*[,;]?$/.exec(field);
    if (!m) continue;
    const propName = m[1];
    const optional = !!m[2];
    const typeExpr = m[3].trim();
    props.push(parseTypeExpr(propName, typeExpr, !optional));
  }
  return props;
}

function parseTypeExpr(name: string, typeExpr: string, required: boolean): ParsedProp {
  // Quick wins for primitives.
  if (typeExpr === 'string') return { name, type: 'string', required };
  if (typeExpr === 'number') return { name, type: 'number', required };
  if (typeExpr === 'boolean') return { name, type: 'boolean', required };

  // Literal-string union: `'a' | 'b' | 'c'` (also `"a" | "b"`).
  // Trailing `| string` etc. broadens the type — still treat as
  // string with the literal options as suggestions.
  const literalMatches = [...typeExpr.matchAll(/['"]([^'"\n]+)['"]/g)];
  if (literalMatches.length > 0 && /^[\s|]*(?:['"][^'"]+['"][\s|]*)+(?:\|\s*string\s*)?$/.test(typeExpr)) {
    return {
      name,
      type: 'string',
      required,
      options: literalMatches.map((m) => m[1]),
    };
  }

  // Anything else (arrays, function types, branded types, etc.)
  // — let the panel render as free-form.
  return { name, type: 'expression', required };
}
