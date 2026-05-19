import type { JsxEditorProps } from '@mdxeditor/editor';
import {
  NestedLexicalEditor,
  useLexicalNodeRemove,
  useMdastNodeUpdater,
  useNestedEditorContext,
} from '@mdxeditor/editor';
import { $getNodeByKey } from 'lexical';
import type * as Mdast from 'mdast';
import type { MdxJsxFlowElement } from 'mdast-util-mdx-jsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  isJsxDescriptor,
  type MdxComponentDescriptor,
  useMdxComponents,
  writeStringAttribute,
} from '../../mdx-components';
import { getSelectedBlock, setSelectedBlock } from '../../selected-block';

/**
 * One editor component for any MDX JSX block. Replaces the per-component
 * `AsideEditor` / `CardEditor` / ... files in the host project.
 *
 * Markup comes from the integration's `/api/render` endpoint, which runs
 * the real framework component via Astro's Container API and returns the
 * exact HTML the published page would emit. No hardcoded templates, no
 * version-pinned class names — every component the host can render on
 * its live site renders identically in the editor.
 *
 * Editing affordances (prop fields + delete) live in a small overlay row
 * above the block. The body is a `NestedLexicalEditor` portaled into a
 * `<conloca-slot>` element inside the rendered HTML, so wrapper-HTML
 * replacement on prop change preserves the editor's mounting state
 * (focus, selection, undo stack).
 *
 * If a component has no `import` source (descriptor missing), or the
 * render endpoint fails, falls back to a plain wrapper so the body
 * stays editable and the document still saves correctly.
 */

type AnyProps = Record<string, unknown>;

/**
 * One node in the recursive render-tree payload. Leaves emit a single
 * `<conloca-slot data-slot-id="...">` for inline body editing.
 * Containers (with `children`) emit each child's rendered HTML in
 * document order as the parent's default slot, so the final markup
 * matches what Astro would emit for the same MDX — positional CSS
 * (Card colour cycle, CSS-grid placement, etc.) resolves the same
 * way as on the live page.
 *
 * `body` is an HTML-escaped string of the leaf's text content,
 * shipped as fallback so children inside containers (Cards in a
 * CardGrid) display their authored text statically.
 *
 * `bodyHtml` is RAW HTML that REPLACES the conloca-slot wrapper
 * entirely. Used for components whose Astro implementation validates
 * the slot element type (Starlight's `<Steps>` requires `<ol>`,
 * `<FileTree>` requires `<ul>`) — passing `<conloca-slot>` makes the
 * Container API render call throw. With `bodyHtml` set, the server
 * emits the raw HTML directly as the slot content, so the validator
 * sees the expected element. Inline editing isn't possible until
 * we add slot-id markers to specific positions inside the rendered
 * list and portal editors there.
 */
interface RenderTreeNode {
  component: string;
  source: string;
  defaultExport?: boolean;
  props: AnyProps;
  slotId: string;
  body?: string;
  bodyHtml?: string;
  children?: RenderTreeNode[];
  /** Named-slot HTML keyed by slot name. Extracted from
   * `<Fragment slot="...">...</Fragment>` children in the source MDX
   * and passed to the Astro renderer as additional slots. */
  namedSlots?: Record<string, string>;
}

interface RenderRequest {
  tree: RenderTreeNode;
  /**
   * 1-based position of the top-level block among Lexical's root
   * children. Server prepends `documentIndex - 1` hidden phantom
   * siblings inside the wrapper so the real component lands at
   * `:nth-child(N)` for positional CSS rules.
   *
   * Inline (text-kind) components aren't root flow children, so they
   * skip this — set to 0 (or omit) to suppress the wrapping div + phantoms.
   */
  documentIndex: number;
  /**
   * When true, the server emits inline HTML with no `<div
   * class="sl-markdown-content">` wrapper and no phantom siblings,
   * suitable for splicing into a paragraph's text flow. Used for
   * text-kind components like `<Icon>` whose published markup is an
   * inline `<svg>`.
   */
  inline?: boolean;
}

const SLOT_TAG = 'conloca-slot';
const RENDER_ENDPOINT = '/__cms/api/render';

/**
 * In-memory cache of rendered HTML keyed by the full tree shape +
 * document index. Same edit state reuses cached HTML without a server
 * roundtrip. Cleared on page reload.
 */
const renderCache = new Map<string, string>();

function cacheKey(req: RenderRequest): string {
  return `${req.documentIndex}::${req.inline ? 'inline::' : ''}${stableStringify(stripBodyFields(req.tree as unknown as AnyProps) as AnyProps)}`;
}

function stableStringify(obj: AnyProps): string {
  // Stable across key order so attribute reordering doesn't bust the cache.
  // For nested objects/arrays (children trees) JSON.stringify already
  // preserves array order which is what we want.
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      const keys = Object.keys(v as object).sort();
      return Object.fromEntries(keys.map((k) => [k, sort((v as Record<string, unknown>)[k])]));
    }
    return v;
  };
  return JSON.stringify(sort(obj));
}

/**
 * Strip the `body` and `bodyHtml` fields from every node in the render
 * tree. Cache keys should hash only structural shape (component names,
 * import sources, props, child topology) — NOT prose body text. When a
 * user types inside a portaled `<NestedLexicalEditor>` the leaf body
 * mdast changes; without this strip every keystroke would mint a
 * different cache key and force a server roundtrip — even though the
 * SSR HTML itself doesn't change (the body lives in the portaled slot,
 * not in the SSR'd markup the cache serves).
 */
function stripBodyFields(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripBodyFields);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === 'body' || k === 'bodyHtml') continue;
      out[k] = stripBodyFields(v);
    }
    return out;
  }
  return node;
}

async function fetchRendered(req: RenderRequest): Promise<string> {
  const key = cacheKey(req);
  const cached = renderCache.get(key);
  if (cached !== undefined) return cached;

  const res = await fetch(RENDER_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`Render endpoint returned ${res.status}: ${await res.text()}`);
  const html = await res.text();
  renderCache.set(key, html);
  return html;
}

/**
 * Read mdast JSX attributes as a plain props object. Three attribute
 * shapes from mdast-util-mdx-jsx:
 *   - `prop="value"`           → `value: string`
 *   - `prop={expression}`      → object `{ type: 'mdxJsxAttributeValueExpression', value: '<src>' }`
 *   - `prop`                   → `value: null` (shorthand boolean true)
 *
 * Expression values are parsed as JSON so numeric / boolean / array /
 * object literals (`<Box columns={3}>`, `<Card featured={true}>`,
 * `<Grid sizes={[1,2,3]}>`) reach the Astro component as real values
 * instead of being dropped. Non-JSON expressions (variable refs,
 * function calls) fall through as their literal source string — not
 * ideal but no worse than the previous "drop entirely" behavior, and
 * supporting JS evaluation properly needs a real parser.
 */
function readAttrs(node: MdxJsxFlowElement): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const a of node.attributes) {
    if (a.type !== 'mdxJsxAttribute') continue;
    const v = a.value;
    if (typeof v === 'string') {
      out[a.name] = v;
    } else if (v == null) {
      // `<Card featured />` — shorthand boolean true.
      out[a.name] = true;
    } else if (typeof v === 'object' && 'value' in v && typeof v.value === 'string') {
      const src = v.value.trim();
      try {
        out[a.name] = JSON.parse(src);
      } catch {
        out[a.name] = src;
      }
    }
  }
  return out;
}

/**
 * Many MDX parsers wrap inline JSX (Cards inside CardGrid written on
 * adjacent lines without blank-line separators) in a single
 * `paragraph` node. Authors don't think about that — they just write
 * `<CardGrid><Card/><Card/></CardGrid>`. Unwrap one level of paragraph
 * so the effective children we consider are the JSX nodes themselves.
 */
function effectiveChildren(node: { children?: unknown[] }): unknown[] {
  const kids = node.children ?? [];
  if (kids.length === 1) {
    const only = kids[0] as { type?: string; children?: unknown[] };
    if (only?.type === 'paragraph') return only.children ?? [];
  }
  return kids;
}

/**
 * Parse a slot id like `"root.0.1"` into a numeric path `[0, 1]`. The
 * leading `"root"` is the buildRenderTree prefix and isn't a real
 * index; each subsequent segment is an index into the kids array as
 * `buildRenderTree` saw it (post-effectiveChildren-unwrap and
 * post-named-slot-filter). The empty path corresponds to the root
 * itself, which is never an inline-editable slot (it's the parent we
 * SSR'd) — included only for completeness.
 */
function slotIdToPath(slotId: string): number[] {
  return slotId
    .split('.')
    .slice(1)
    .map((s) => Number.parseInt(s, 10));
}

/**
 * Walk the mdast tree following the same logic `buildRenderTree` uses
 * (effectiveChildren unwrap → named-slot filter → kid at index) and
 * return the subtree at `path`. Returns `null` when the path doesn't
 * resolve (eg the structure changed between SSR and this walk).
 */
function getMdastAtPath(root: unknown, path: number[]): MdxJsxFlowElement | null {
  let node: unknown = root;
  for (const step of path) {
    if (!node || typeof node !== 'object') return null;
    const allKids = effectiveChildren(node as { children?: unknown[] });
    const kids = allKids.filter((k) => getNamedSlotName(k) == null);
    node = kids[step];
    if (!node) return null;
  }
  return (node as MdxJsxFlowElement) ?? null;
}

/**
 * Return a NEW root with the subtree at `path` having its `children`
 * replaced by `newChildren`. The walk mirrors `getMdastAtPath` —
 * effectiveChildren unwrap + named-slot filter — and the write
 * reverses the unwrap when it happened, so the original mdast shape
 * (paragraph wrapper or not) round-trips on save.
 *
 * Empty `path` means "replace the root's children" — the only caller
 * for that case would be the top-level editor, which doesn't go
 * through this path.
 */
function replaceMdastAtPath(
  root: MdxJsxFlowElement,
  path: number[],
  newChildren: MdxJsxFlowElement['children'],
): MdxJsxFlowElement {
  if (path.length === 0) {
    return { ...root, children: newChildren };
  }
  const [head, ...rest] = path;
  const originalKids = (root.children ?? []) as unknown[];

  // Detect the same paragraph-unwrap effectiveChildren did on read.
  const isUnwrapped =
    originalKids.length === 1 && (originalKids[0] as { type?: string } | undefined)?.type === 'paragraph';
  const workingKids = isUnwrapped ? ((originalKids[0] as { children?: unknown[] }).children ?? []) : originalKids;

  // Walk `workingKids` skipping named-slot children, find the original
  // index in `workingKids` that corresponds to filtered-index `head`.
  let filteredIdx = 0;
  let originalIdx = -1;
  for (let i = 0; i < workingKids.length; i++) {
    if (getNamedSlotName(workingKids[i]) != null) continue;
    if (filteredIdx === head) {
      originalIdx = i;
      break;
    }
    filteredIdx++;
  }
  if (originalIdx === -1) return root;

  const targetKid = workingKids[originalIdx] as MdxJsxFlowElement;
  const updatedKid =
    rest.length === 0
      ? ({ ...targetKid, children: newChildren } as MdxJsxFlowElement)
      : replaceMdastAtPath(targetKid, rest, newChildren);

  const newWorkingKids = [...workingKids];
  newWorkingKids[originalIdx] = updatedKid;

  if (isUnwrapped) {
    const paragraphWrap = originalKids[0] as { children?: unknown[] };
    return {
      ...root,
      children: [{ ...paragraphWrap, children: newWorkingKids }] as MdxJsxFlowElement['children'],
    };
  }
  return { ...root, children: newWorkingKids as MdxJsxFlowElement['children'] };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** True when a JSX tag name is a standard HTML element (lowercase-
 * first per the React/Astro convention). Used to render raw HTML
 * inline rather than routing it through the Astro Container API. */
function isHtmlTag(name: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(name);
}

/** Self-closing HTML elements that must NOT have a closing tag. */
const VOID_HTML_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function attrsToHtml(attrs: unknown): string {
  if (!Array.isArray(attrs)) return '';
  const parts: string[] = [];
  for (const a of attrs as Array<{ type?: string; name?: string; value?: unknown }>) {
    if (a?.type !== 'mdxJsxAttribute' || typeof a.name !== 'string') continue;
    const v = a.value;
    if (v == null) {
      parts.push(a.name); // shorthand boolean
    } else if (typeof v === 'string') {
      parts.push(`${a.name}="${escapeHtml(v)}"`);
    } else if (typeof v === 'object' && v && 'value' in v && typeof (v as { value: unknown }).value === 'string') {
      // Expression — serialize the source. JSON-literal expressions
      // (`{42}`, `{true}`) round-trip; non-literal ones fall through
      // as-is, which mirrors what attrsToProps does for the SSR
      // payload.
      const src = ((v as { value: string }).value || '').trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(src);
      } catch {
        parsed = src;
      }
      if (typeof parsed === 'boolean') {
        if (parsed) parts.push(a.name);
      } else if (parsed != null) {
        parts.push(`${a.name}="${escapeHtml(String(parsed))}"`);
      }
    }
  }
  return parts.length ? ' ' + parts.join(' ') : '';
}

/**
 * Convert a (small) mdast subtree to HTML. Two motivating cases:
 *
 *   1. Components like Starlight's `<Steps>`/`<FileTree>` whose Astro
 *      implementation validates the slot tag name and rejects
 *      `<conloca-slot>` — we render the list body as raw HTML and
 *      pass that as the slot content instead.
 *
 *   2. Raw HTML the author writes directly in MDX (`<div class="x">`,
 *      `<details><summary>` etc.) — those land in the mdast as
 *      `mdxJsxFlowElement`/`mdxJsxTextElement` with a lowercase tag
 *      name. We render them in place rather than routing through the
 *      Container API (which expects a component import).
 *
 * Anything we don't recognize collapses to its concatenated children
 * (treating it as a transparent wrapper). That's safer than dropping
 * content — text still shows even if formatting doesn't.
 */
function mdastToHtml(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as {
    type?: string;
    value?: unknown;
    children?: unknown[];
    ordered?: boolean;
    url?: string;
    name?: string;
    attributes?: unknown;
    depth?: number;
    lang?: string;
  };
  switch (n.type) {
    case 'text':
      return typeof n.value === 'string' ? escapeHtml(n.value) : '';
    case 'inlineCode':
      return `<code>${typeof n.value === 'string' ? escapeHtml(n.value) : ''}</code>`;
    case 'emphasis':
      return `<em>${(n.children ?? []).map(mdastToHtml).join('')}</em>`;
    case 'strong':
      return `<strong>${(n.children ?? []).map(mdastToHtml).join('')}</strong>`;
    case 'delete':
      return `<del>${(n.children ?? []).map(mdastToHtml).join('')}</del>`;
    case 'link':
      return `<a href="${escapeHtml(typeof n.url === 'string' ? n.url : '')}">${(n.children ?? []).map(mdastToHtml).join('')}</a>`;
    case 'image':
      return `<img src="${escapeHtml(typeof n.url === 'string' ? n.url : '')}" alt="${escapeHtml(typeof (n as { alt?: unknown }).alt === 'string' ? (n as { alt: string }).alt : '')}" />`;
    case 'paragraph':
      return `<p>${(n.children ?? []).map(mdastToHtml).join('')}</p>`;
    case 'heading': {
      const lvl = Math.max(1, Math.min(6, Number(n.depth) || 1));
      return `<h${lvl}>${(n.children ?? []).map(mdastToHtml).join('')}</h${lvl}>`;
    }
    case 'blockquote':
      return `<blockquote>${(n.children ?? []).map(mdastToHtml).join('')}</blockquote>`;
    case 'list': {
      const tag = n.ordered ? 'ol' : 'ul';
      return `<${tag}>${(n.children ?? []).map(mdastToHtml).join('')}</${tag}>`;
    }
    case 'listItem':
      return `<li>${(n.children ?? []).map(mdastToHtml).join('')}</li>`;
    case 'thematicBreak':
      return '<hr />';
    case 'code': {
      const lang = typeof n.lang === 'string' && n.lang ? ` class="language-${escapeHtml(n.lang)}"` : '';
      return `<pre><code${lang}>${typeof n.value === 'string' ? escapeHtml(n.value) : ''}</code></pre>`;
    }
    case 'html':
      // Raw HTML mdast — pass through unescaped.
      return typeof n.value === 'string' ? n.value : '';
    case 'break':
      return '<br />';
    case 'mdxJsxFlowElement':
    case 'mdxJsxTextElement': {
      const tag = typeof n.name === 'string' ? n.name : '';
      if (!tag) return Array.isArray(n.children) ? n.children.map(mdastToHtml).join('') : '';
      if (!isHtmlTag(tag)) {
        // Capital-cased JSX — a component we don't know how to render
        // statically here. Fall back to children (their text/HTML).
        return Array.isArray(n.children) ? n.children.map(mdastToHtml).join('') : '';
      }
      const attrs = attrsToHtml(n.attributes);
      if (VOID_HTML_TAGS.has(tag)) return `<${tag}${attrs} />`;
      const inner = Array.isArray(n.children) ? n.children.map(mdastToHtml).join('') : '';
      return `<${tag}${attrs}>${inner}</${tag}>`;
    }
    default:
      return Array.isArray(n.children) ? n.children.map(mdastToHtml).join('') : '';
  }
}

/**
 * True when the mdast subtree's body contains any block-level non-JSX
 * mdast node that we'd want to render as HTML rather than route
 * through the editor's slot+portal flow. Two reasons we go this route:
 *
 *   1. Some Astro components validate the slot element type and
 *      reject `<conloca-slot>` (Starlight's `<Steps>` wants `<ol>`,
 *      `<FileTree>` wants `<ul>`, hypothetical Carousels/Tables/etc
 *      could want their own tag). Rendering the body as HTML and
 *      emitting it raw makes the validator see the real element.
 *
 *   2. The portal-based editor surface is built for prose text (with
 *      inline marks) plus block JSX. Heading/blockquote/table/code
 *      blocks as a component's direct body are less common and not
 *      cleanly editable inline anyway — rendering them statically
 *      until we add per-position slot markers (Phase 3) keeps the
 *      visual right.
 *
 * Plain text + inline JSX bodies stay on the slot+portal path so
 * Cards, Asides, etc. remain inline-editable.
 */
function bodyNeedsStaticHtml(kids: unknown[]): boolean {
  return kids.some((c) => {
    const t = (c as { type?: string })?.type;
    return (
      t === 'list' ||
      t === 'heading' ||
      t === 'blockquote' ||
      t === 'table' ||
      t === 'code' ||
      t === 'thematicBreak' ||
      t === 'html'
    );
  });
}

/**
 * Walk the mdast subtree starting at `node` and build the render-tree
 * payload. Children that are JSX elements (flow OR text — MDX parses
 * inline-written JSX as text variants) with a registered descriptor
 * are recursed into; anything else terminates the recursion and the
 * parent ends up with a single body slot like a leaf would.
 *
 * `isRoot=true` means this is the top-level node the caller will
 * portal a Lexical editor into. We skip the static text fallback on
 * the root so the portal isn't stacked on top of duplicate text —
 * the editor itself owns the body content for the root. Nested
 * leaves (children inside a container) DO get the fallback, since
 * they aren't being portaled into yet (Phase 3).
 */
/** Read the `slot` attribute off a `<Fragment slot="...">` mdast
 * node. Returns null when the node isn't a Fragment, isn't named, or
 * the slot attribute isn't a plain string. */
function getNamedSlotName(child: unknown): string | null {
  const c = child as { type?: string; name?: string; attributes?: unknown };
  if (!c || (c.type !== 'mdxJsxFlowElement' && c.type !== 'mdxJsxTextElement')) return null;
  if (c.name !== 'Fragment') return null;
  if (!Array.isArray(c.attributes)) return null;
  for (const a of c.attributes as Array<{ type?: string; name?: string; value?: unknown }>) {
    if (a?.type === 'mdxJsxAttribute' && a.name === 'slot' && typeof a.value === 'string') {
      return a.value;
    }
  }
  return null;
}

function buildRenderTree(
  node: MdxJsxFlowElement,
  descriptors: ReadonlyArray<MdxComponentDescriptor>,
  slotIdPrefix: string,
  isRoot = false,
): RenderTreeNode | null {
  const name = node.name ?? '';
  const desc = descriptors.find((d): d is MdxComponentDescriptor => 'name' in d && d.name === name);
  const jsxDesc = desc && isJsxDescriptor(desc) ? desc : null;
  const source = jsxDesc?.import?.from;
  if (!source) return null;

  const allKids = effectiveChildren(node as { children?: unknown[] });

  // Extract `<Fragment slot="name">…</Fragment>` children into a
  // namedSlots map and continue body processing with the remaining
  // (default-slot) children only. This is the Astro convention for
  // multi-slot components like `<Layout>` or `<Hero>`.
  const namedSlots: Record<string, string> = {};
  const kids: unknown[] = [];
  for (const child of allKids) {
    const slot = getNamedSlotName(child);
    if (slot) {
      const inner = (child as { children?: unknown[] }).children;
      namedSlots[slot] = mdastToHtml({ children: Array.isArray(inner) ? inner : [] });
    } else {
      kids.push(child);
    }
  }

  const children: RenderTreeNode[] = [];
  let hasJsxChildren = false;
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i] as { type?: string };
    if (child?.type === 'mdxJsxFlowElement' || child?.type === 'mdxJsxTextElement') {
      const childTree = buildRenderTree(child as MdxJsxFlowElement, descriptors, `${slotIdPrefix}.${i}`);
      if (childTree) {
        children.push(childTree);
        hasJsxChildren = true;
      }
    }
  }

  // If the body is a markdown list (Steps/FileTree), render it as
  // raw HTML — those components' Astro implementations validate the
  // slot tag name and reject `<conloca-slot>`. `bodyHtml` makes the
  // server emit our rendered list directly as the slot content with
  // no wrapper.
  const bodyHtml = !hasJsxChildren && bodyNeedsStaticHtml(kids) ? mdastToHtml({ children: kids }) : undefined;

  // Previously, nested leaves shipped a static-text `body` fallback
  // inside their slot so authored text was visible even without an
  // inline editor — back when only the root slot got a Lexical
  // portal. Every container child now gets its own `ContainerSlotEditor`
  // portaled in (see `GenericBlock`), so the slot's owner is always
  // an editor. Emitting `body` here would render the same text twice:
  // once as static text from the SSR'd slot, once via the portaled
  // editor's contentEditable. Always omit.
  const body: string | undefined = undefined;

  return {
    component: name,
    source,
    defaultExport: jsxDesc?.import?.default ?? false,
    props: readAttrs(node),
    slotId: slotIdPrefix,
    ...(hasJsxChildren ? { children } : {}),
    ...(body ? { body } : {}),
    ...(bodyHtml ? { bodyHtml } : {}),
    ...(Object.keys(namedSlots).length > 0 ? { namedSlots } : {}),
  };
}

/**
 * True when every non-trivial child of `node` is itself a JSX element
 * (flow or text variant). This is the "container" case (CardGrid with
 * Cards inside, Tabs with TabItems). Text-bearing or mixed children
 * fall through to leaf rendering with one body slot.
 */
function isPureContainer(node: MdxJsxFlowElement): boolean {
  const allKids = effectiveChildren(node as { children?: unknown[] });
  if (allKids.length === 0) return false;
  // Ignore named-slot Fragments — they're passed as separate slots,
  // not part of the default-body container detection.
  const kids = allKids.filter((k) => getNamedSlotName(k) == null);
  if (kids.length === 0) return false;
  let sawJsx = false;
  for (const child of kids) {
    const c = child as { type?: string; value?: unknown };
    if (!c || typeof c !== 'object') continue;
    if (c.type === 'mdxJsxFlowElement' || c.type === 'mdxJsxTextElement') {
      sawJsx = true;
      continue;
    }
    // Permit pure-whitespace text nodes between block JSX.
    if (c.type === 'text' && typeof c.value === 'string' && c.value.trim() === '') continue;
    return false;
  }
  return sawJsx;
}

/**
 * One nested editor scoped to a single child inside a container's
 * render-tree. The parent's MDXEditor `JsxNode` owns the WHOLE mdast
 * subtree (CardGrid + its Cards + grandchildren) as one opaque blob;
 * we can't give each child its own Lexical node within the library's
 * data model. Instead, this component sits inside the parent's JsxEditor
 * context (via `<NestedLexicalEditor>`) and uses `getContent` /
 * `getUpdatedMdastNode` to read and write a SPECIFIC child by mdast
 * path. The same `effectiveChildren` unwrap that buildRenderTree did
 * on read is mirrored in the write helper so the original tree shape
 * round-trips on save.
 *
 * Concurrency caveat: when two `ContainerSlotEditor` instances inside
 * the same parent both fire `getUpdatedMdastNode`, each sees the
 * parent snapshot captured by `useMdastNodeUpdater` at its render
 * time. MDXEditor's `discrete: true` update path makes the parent
 * commit synchronously between blurs and React re-renders before
 * the next blur could fire, so blur-driven prose edits are safe. The
 * race exists only for non-blur updates (codemirror's
 * `NESTED_EDITOR_UPDATED_COMMAND` while still focused) — vanishingly
 * rare in container-child editing today.
 */
function ContainerSlotEditor({ path }: { path: number[] }) {
  return (
    <NestedLexicalEditor<MdxJsxFlowElement>
      getContent={(parent) => {
        const target = getMdastAtPath(parent, path);
        return (target?.children as Mdast.PhrasingContent[]) ?? [];
      }}
      getUpdatedMdastNode={(parent, newChildren) =>
        replaceMdastAtPath(parent, path, newChildren as MdxJsxFlowElement['children'])
      }
    />
  );
}

export function GenericBlock({ mdastNode }: JsxEditorProps) {
  const updater = useMdastNodeUpdater<MdxJsxFlowElement>();
  const removeNode = useLexicalNodeRemove();
  const descriptors = useMdxComponents();
  const { parentEditor, lexicalNode } = useNestedEditorContext();

  const node = mdastNode as MdxJsxFlowElement;
  const attrs = readAttrs(node);
  const name = node.name ?? '';
  const found = descriptors.find((d): d is MdxComponentDescriptor => 'name' in d && d.name === name);
  const descriptor = found && isJsxDescriptor(found) ? found : null;
  const source = descriptor?.import?.from;

  // Inline (text-kind) components — `<Icon>`, anything rendered as
  // `mdxJsxTextElement` — sit inside a paragraph's text flow and must
  // NOT carry block wrappers. The phantom-sibling / `sl-markdown-content`
  // path only makes sense for root-level flow blocks (Card colour
  // cycle, CSS-grid placement); for inline elements it would force a
  // line break and stack hidden siblings around the glyph.
  const isInline = descriptor?.kind === 'text';

  // This block's 1-based position among Lexical's root-level children.
  // Passed to the render endpoint so it can prepend phantom siblings and
  // restore the same `:nth-child(N)` position the live page would have.
  // Subscribes to the parent editor so the index updates when the user
  // adds, deletes, or reorders blocks above this one. Inline components
  // skip this entirely — they aren't root children.
  const [documentIndex, setDocumentIndex] = useState(1);
  useEffect(() => {
    if (isInline) return;
    const computeIndex = () => {
      parentEditor.getEditorState().read(() => {
        const me = $getNodeByKey(lexicalNode.getKey());
        // Walk up to the root-level child (a JSX block lives inside a
        // Lexical paragraph; the paragraph is the root's direct child).
        let cursor = me;
        while (cursor && cursor.getParent() && cursor.getParent()?.getParent() !== null) {
          cursor = cursor.getParent();
        }
        const root = cursor?.getParent();
        if (root && cursor) {
          const idx = root.getChildren().indexOf(cursor);
          if (idx >= 0) setDocumentIndex(idx + 1);
        }
      });
    };
    computeIndex();
    return parentEditor.registerUpdateListener(computeIndex);
  }, [parentEditor, lexicalNode, isInline]);

  // Container mode: when all of this node's children are themselves
  // JSX flow elements with known descriptors, we render the whole
  // subtree in one server call so the children emerge as real DOM
  // siblings of their parent (vs. each child rendering in its own
  // wrapper). This fixes CSS grid layout and positional CSS for
  // components like CardGrid and Tabs whose children must be direct
  // DOM children of the container.
  const containerMode = isPureContainer(node);

  // Build the full render-tree payload. For leaves this is one node
  // with a `<conloca-slot>` body slot. For containers it recurses
  // into children. `tree` is null when we lack an import source for
  // the root component — the fallback wrapper handles that path.
  const tree = useMemo<RenderTreeNode | null>(
    () => buildRenderTree(node, descriptors, 'root', true),
    // mdast attrs/children are regenerated on every render but
    // structurally stable, so we use stableStringify in cacheKey to
    // dedupe identical requests. Recomputing the tree per render is
    // cheap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node, descriptors],
  );

  const propsJson = useMemo(() => stableStringify(attrs), [attrs]);
  const renderReq = useMemo<RenderRequest | null>(
    () => (tree ? { tree, documentIndex, ...(isInline ? { inline: true } : {}) } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tree, documentIndex, propsJson, isInline],
  );

  const [html, setHtml] = useState<string | null>(() =>
    renderReq ? (renderCache.get(cacheKey(renderReq)) ?? null) : null,
  );
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [slotEl, setSlotEl] = useState<Element | null>(null);
  /** Container-mode slots: slot-id → element. Each entry portals a
   * `<ContainerSlotEditor>` into that element so every child's body
   * is inline-editable, even when N children share one SSR'd wrapper. */
  const [containerSlots, setContainerSlots] = useState<Map<string, Element>>(() => new Map());

  // Fetch (or serve from cache) the rendered HTML on prop changes.
  useEffect(() => {
    if (!renderReq) return;
    let cancelled = false;
    setError(null);
    fetchRendered(renderReq)
      .then((next) => {
        if (!cancelled) setHtml(next);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        console.warn('[Conloca] GenericBlock render failed:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [renderReq]);

  // Imperatively swap the wrapper's inner HTML when the rendered
  // string changes, then locate every body slot in the SSR'd markup.
  //
  // Leaf mode: one `<conloca-slot>` at the root, portaled with a
  // single `<NestedLexicalEditor>` for the component's body.
  //
  // Container mode: each child JSX node also emits a slot (carrying
  // its `data-slot-id` from the buildRenderTree path). Each gets its
  // own portaled `<ContainerSlotEditor>` scoped to that child's mdast
  // subtree via path resolution — so editing the body of a Card
  // inside a CardGrid works the same as editing the body of a
  // root-level Aside.
  useEffect(() => {
    const wrap = wrapperRef.current;
    if (!wrap || html == null) return;
    wrap.innerHTML = html;
    if (containerMode) {
      // Multiple slots — discover them all and key by slot-id so the
      // path resolution in `ContainerSlotEditor` can find the right
      // mdast subtree to edit.
      const next = new Map<string, Element>();
      const slotEls = wrap.querySelectorAll(`${SLOT_TAG}[data-slot-id]`);
      for (const el of Array.from(slotEls)) {
        const slotId = el.getAttribute('data-slot-id');
        if (slotId) next.set(slotId, el);
      }
      setContainerSlots(next);
      setSlotEl(null);
    } else {
      setContainerSlots(new Map());
      setSlotEl(wrap.querySelector(SLOT_TAG));
    }
  }, [html, containerMode]);

  const slot = (
    <NestedLexicalEditor<MdxJsxFlowElement>
      getContent={(n) => n.children as Mdast.PhrasingContent[]}
      getUpdatedMdastNode={(n, children) => ({ ...n, children: children as MdxJsxFlowElement['children'] })}
    />
  );

  const onPropChange = useCallback(
    (propName: string, next: string) => {
      updater({ attributes: writeStringAttribute(node.attributes, propName, next) as typeof node.attributes });
    },
    [updater, node.attributes],
  );

  // Publish to the side-panel registry whenever this block is the
  // currently-selected one, or its props change while still selected.
  // The panel reads `descriptor`/`attrs` to render the form and calls
  // back through `onPropChange`/`removeNode` (closed over the block's
  // own updater hooks) so updates flow on the same path inline editing
  // used.
  useEffect(() => {
    if (!descriptor) return;
    if (getSelectedBlock()?.descriptor.name === name) {
      setSelectedBlock({ name, descriptor, attrs, onPropChange, onRemove: removeNode });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propsJson, descriptor, name, onPropChange, removeNode]);

  const handleSelect = useCallback(() => {
    if (!descriptor) return;
    setSelectedBlock({ name, descriptor, attrs, onPropChange, onRemove: removeNode });
  }, [descriptor, name, attrs, onPropChange, removeNode]);

  // Raw HTML in MDX (`<div class="x">`, `<details>`, etc.) lands here
  // with a lowercase tag name and no registered component descriptor.
  // Render the whole subtree client-side as HTML — no SSR roundtrip,
  // no labelled fallback. Static (not inline-editable) for now.
  if (!source && isHtmlTag(name)) {
    const rawHtml = mdastToHtml(node);
    return (
      <div
        className="conloca-generic-block conloca-generic-block--html"
        onMouseDownCapture={handleSelect}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: rawHtml }}
      />
    );
  }

  // Text-kind components are inline glyphs (Icon, raw-HTML inline tags).
  // Wrapping them in a `<div>` would force a line break inside the
  // paragraph that contains them. Use `<span>` wrappers and a class
  // modifier so CSS can drop block-level styling for this path.
  if (isInline) {
    return (
      <span className="conloca-generic-block conloca-generic-block--inline" onMouseDownCapture={handleSelect}>
        {source && !error ? (
          <>
            <span
              ref={wrapperRef as unknown as React.RefObject<HTMLSpanElement>}
              className="conloca-generic-block__rendered"
            />
            {slotEl && createPortal(slot, slotEl)}
          </>
        ) : (
          <span className="conloca-generic-block__fallback" data-mdx-block={name}>
            <span className="conloca-generic-block__fallback-label">{name}</span>
            <span className="conloca-generic-block__fallback-body">{slot}</span>
          </span>
        )}
      </span>
    );
  }

  return (
    <div className="conloca-generic-block" onMouseDownCapture={handleSelect}>
      {/* Wrapper that hosts the SSR'd HTML. The nested editor portals
          into the <conloca-slot> element inside this HTML. When no source
          is registered (unknown JSX tag, custom React/Vue component without
          a descriptor) or the SSR call fails, fall back to a labelled
          wrapper so the body stays editable and visual chrome at least
          shows the block's name. */}
      {source && !error ? (
        <>
          <div ref={wrapperRef} className="conloca-generic-block__rendered" />
          {/* Leaf mode: one slot at the wrapper level, portaled with a
              single nested editor for the block's body. */}
          {slotEl && createPortal(slot, slotEl)}
          {/* Container mode: each child JSX node also emits a slot
              with its `data-slot-id`. Portal a `ContainerSlotEditor`
              into each, scoped to that child's mdast subtree via
              path resolution. */}
          {containerMode &&
            Array.from(containerSlots).map(([slotId, el]) =>
              createPortal(<ContainerSlotEditor key={slotId} path={slotIdToPath(slotId)} />, el),
            )}
        </>
      ) : (
        <div className="conloca-generic-block__fallback" data-mdx-block={name}>
          <span className="conloca-generic-block__fallback-label">{name}</span>
          <div className="conloca-generic-block__fallback-body">{slot}</div>
        </div>
      )}
    </div>
  );
}
