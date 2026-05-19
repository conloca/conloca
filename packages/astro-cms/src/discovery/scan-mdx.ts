import { readFile } from 'node:fs/promises';
import fg from 'fast-glob';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { mdxFromMarkdown } from 'mdast-util-mdx';
import { mdxjs } from 'micromark-extension-mdxjs';

/**
 * Walks the content directory for `.mdx` files, parses each one, and
 * returns a per-file record of:
 *
 *   - **imports** — every `import { Foo, Bar as Baz } from 'pkg'` /
 *     `import Default from 'pkg'` declaration in the file's ESM
 *     header, keyed by the LOCAL name as seen in the JSX usages
 *     below. The `aliasedFrom` field records when the local name
 *     differs from the canonical export, so the save serializer can
 *     preserve the alias when rewriting the file.
 *
 *   - **usages** — every `<Foo>` / `<Foo />` element in the file's
 *     body, in source order, with its observed string attributes.
 *
 * The merge step (downstream) joins each usage to its import via
 * the local name to build the final component descriptor list.
 *
 * Parsing uses `mdast-util-from-markdown` with the full MDX extension
 * bundle (`micromark-extension-mdxjs` + `mdast-util-mdx`) — the same
 * stack the editor uses on every save, so what we observe here is
 * exactly what the editor's save path can round-trip.
 */
export interface MdxImport {
  /** The npm-style or relative source path. */
  source: string;
  /** True for `import Foo from '...'`; false for named imports. */
  defaultExport: boolean;
  /** The canonical export name on the package side. For
   * `import { Aside as Callout }`, this is `'Aside'` while the
   * local key is `'Callout'`. For default imports this is `'default'`. */
  exportName: string;
  /** Local alias used in this file, if it differs from `exportName`.
   * `undefined` when the file uses the canonical name unchanged. */
  aliasedFrom?: string;
}

export interface MdxUsage {
  /** The local name used in the JSX tag — `<Foo>` → `'Foo'`. */
  name: string;
  /** Observed attributes as raw strings. Expression-valued attrs
   * (`prop={42}`) and complex values are not captured here; this
   * field is for inferring "values seen in real usage" to populate
   * dropdown choices on the prop panel. */
  attrs: Record<string, string>;
  /** `'flow'` (block-level) or `'text'` (inline-level) — matches the
   * mdast node type. Used to set the descriptor's `kind`. */
  kind: 'flow' | 'text';
}

export interface MdxScanResult {
  /** Absolute path of the scanned file. */
  filepath: string;
  /** Local name → import declaration. */
  imports: Record<string, MdxImport>;
  /** All JSX usages in document order. */
  usages: MdxUsage[];
}

/**
 * Scan every `.mdx` file under `rootDir` (recursive). Returns one
 * result per file. Files that fail to parse are skipped with a
 * warning rather than throwing — the discovery flow shouldn't take
 * down the dev server on a single broken file.
 */
export async function scanMdxFiles(rootDir: string): Promise<MdxScanResult[]> {
  const files = await fg('**/*.mdx', { cwd: rootDir, absolute: true, dot: false });
  const results: MdxScanResult[] = [];
  for (const file of files) {
    try {
      results.push(await scanFile(file));
    } catch (err) {
      console.warn(`[conloca:discovery] failed to scan ${file}:`, err instanceof Error ? err.message : err);
    }
  }
  return results;
}

async function scanFile(filepath: string): Promise<MdxScanResult> {
  const content = await readFile(filepath, 'utf8');
  const tree = fromMarkdown(content, {
    extensions: [mdxjs()],
    mdastExtensions: [mdxFromMarkdown()],
  });

  const imports: Record<string, MdxImport> = {};
  const usages: MdxUsage[] = [];

  walk(tree, (node) => {
    if (isEsmNode(node)) {
      collectImports(node, imports);
    } else if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
      const name = typeof node.name === 'string' ? node.name : '';
      if (!name) return;
      const attrs: Record<string, string> = {};
      const rawAttrs = (node.attributes as Array<{ type?: string; name?: unknown; value?: unknown }> | undefined) ?? [];
      for (const a of rawAttrs) {
        if (a.type !== 'mdxJsxAttribute' || typeof a.name !== 'string') continue;
        if (typeof a.value === 'string') {
          attrs[a.name] = a.value;
        }
        // Expression values (`prop={...}`) and null (boolean
        // shorthand) are intentionally ignored here — they don't
        // contribute to the "observed string values" we use to
        // suggest dropdown options. The full attribute set per node
        // lives in the editor's mdast node anyway.
      }
      usages.push({
        name,
        attrs,
        kind: node.type === 'mdxJsxFlowElement' ? 'flow' : 'text',
      });
    }
  });

  return { filepath, imports, usages };
}

function isEsmNode(node: { type?: string }): node is EsmNode {
  return node.type === 'mdxjsEsm';
}

interface EsmNode {
  type: 'mdxjsEsm';
  value?: string;
  data?: { estree?: { body?: EstreeStatement[] } };
}

interface EstreeStatement {
  type: string;
  source?: { value?: string };
  specifiers?: EstreeImportSpec[];
}

interface EstreeImportSpec {
  type: 'ImportDefaultSpecifier' | 'ImportSpecifier' | 'ImportNamespaceSpecifier';
  imported?: { type?: string; name?: string; value?: string };
  local: { name: string };
}

function collectImports(esmNode: EsmNode, out: Record<string, MdxImport>): void {
  const estree = esmNode.data?.estree;
  if (!estree?.body) return;
  for (const stmt of estree.body) {
    if (stmt.type !== 'ImportDeclaration') continue;
    const source = stmt.source?.value;
    if (typeof source !== 'string') continue;
    for (const spec of stmt.specifiers ?? []) {
      const local = spec.local?.name;
      if (typeof local !== 'string') continue;
      if (spec.type === 'ImportDefaultSpecifier') {
        out[local] = { source, defaultExport: true, exportName: 'default' };
      } else if (spec.type === 'ImportSpecifier') {
        const exportName =
          spec.imported?.type === 'Identifier'
            ? spec.imported.name
            : typeof spec.imported?.value === 'string'
              ? spec.imported.value
              : local;
        out[local] = {
          source,
          defaultExport: false,
          exportName: exportName ?? local,
          ...(exportName && exportName !== local ? { aliasedFrom: exportName } : {}),
        };
      }
      // ImportNamespaceSpecifier (`import * as X`) is rare in MDX and
      // wouldn't produce a usable component descriptor on its own —
      // we'd see `<X.Foo>` namespaced usages we don't model. Skip.
    }
  }
}

/** Depth-first walk; visits every node including the root. */
function walk(
  node: { type?: string; children?: unknown[] },
  fn: (n: { type?: string } & Record<string, unknown>) => void,
): void {
  fn(node as { type?: string } & Record<string, unknown>);
  if (Array.isArray((node as { children?: unknown[] }).children)) {
    for (const child of (node as { children?: unknown[] }).children!) {
      if (child && typeof child === 'object') walk(child as { type?: string; children?: unknown[] }, fn);
    }
  }
}
