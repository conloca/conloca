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
  containsMarkdownMarkers,
  isJsxDescriptor,
  type MdxComponentDescriptor,
  useMdxComponents,
  writeAttribute,
} from '../../mdx-components';
import { getSelectedBlock, setSelectedBlock, useSelectedBlock } from '../../selected-block';

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
 * Find string-prop values inside the SSR'd preview and make their rendering
 * element directly editable. The author types in place; on blur the new
 * value flows back through `onPropChange`, which routes through the same
 * mdast updater the side panel uses — so a LinkCard's `description` can
 * be edited inline OR in the side panel, both update the same source.
 *
 * Resolution is a conservative text-match heuristic: only leaf elements
 * (no element children) whose `textContent.trim()` equals the prop value
 * qualify, AND the match must be unique. If two elements happen to render
 * the same string, or the value is too short to disambiguate (<3 chars),
 * the prop falls back to side-panel-only editing. This avoids accidentally
 * binding the wrong element when a value like "tip" coincides with body
 * text or a CSS class.
 *
 * Commits land on blur (or Enter), not on keystroke — committing per-key
 * would refire the render endpoint on every character and lose focus
 * each time the new HTML replaces the wrapper.
 *
 * No registry opt-in for now; the uniqueness + length guards make the
 * heuristic safe enough that "automatically inline-editable for components
 * where it makes sense" matches the zero-config goal of the broader
 * registry work.
 */
function wireInlinePropEditors(
  wrap: HTMLElement,
  attrs: Record<string, unknown>,
  onPropChange: (propName: string, value: string) => void,
): void {
  for (const [propName, rawValue] of Object.entries(attrs)) {
    if (typeof rawValue !== 'string') continue;
    const value = rawValue.trim();
    if (value.length < 3) continue;
    // Skip markdown-bearing values. A `plaintext-only` contenteditable
    // strips `**bold**` / inline code / link syntax on commit, so we
    // route these props through the side panel instead. The author sees
    // the raw string there and decides whether to keep the formatting.
    // Conservative detection (see `containsMarkdownMarkers`) — false
    // positive cost is "edit via panel" which is fine; false negative
    // cost is silent formatting loss, which isn't.
    if (containsMarkdownMarkers(value)) continue;

    // Two parallel walks, combined for uniqueness. The element walk
    // catches "value lives in a leaf span" cases (LinkCard's
    // `<span class="description">`); the text-node walk catches "value
    // is a text node sibling of an icon" cases (Aside's title sits
    // inside `<p class="starlight-aside__title">` right next to an SVG).
    // Total matches across both walks must equal 1 — otherwise we can't
    // unambiguously bind the prop to a single rendering location and
    // fall back to side-panel-only editing.
    const elementMatches: HTMLElement[] = [];
    for (const el of Array.from(wrap.querySelectorAll<HTMLElement>('*'))) {
      // Leaf-only — skip elements with element children, otherwise we'd
      // turn an entire `<a class="sl-link-card">` into a contenteditable.
      if (el.children.length > 0) continue;
      // Skip already-wired editors so re-renders don't double-bind.
      if (el.hasAttribute('data-conloca-prop')) continue;
      if ((el.textContent ?? '').trim() === value) elementMatches.push(el);
    }
    const textMatches: Text[] = [];
    const walker = wrap.ownerDocument.createTreeWalker(wrap, NodeFilter.SHOW_TEXT);
    let textNode: Node | null;
    while ((textNode = walker.nextNode())) {
      const t = textNode as Text;
      if (!t.parentElement) continue;
      // Don't double-count: a text node that is the sole content of a
      // leaf element is already caught by the element walk above.
      const parentIsLeaf = t.parentElement.children.length === 0;
      if (parentIsLeaf) continue;
      // Skip text inside an already-wired inline editor.
      if (t.parentElement.closest('[data-conloca-prop]')) continue;
      if ((t.nodeValue ?? '').trim() === value) textMatches.push(t);
    }
    if (elementMatches.length + textMatches.length !== 1) continue;

    // Resolve the actual target element. For text-node matches we wrap
    // the value in a fresh span so we have something to attach
    // contenteditable to. Surrounding whitespace stays as plain text
    // nodes either side of the span, so the icon→text spacing the host
    // designed for is preserved.
    let target: HTMLElement;
    if (elementMatches.length === 1) {
      target = elementMatches[0];
    } else {
      const t = textMatches[0];
      const original = t.nodeValue ?? '';
      const idx = original.indexOf(value);
      const before = idx > 0 ? original.slice(0, idx) : '';
      const after = idx + value.length < original.length ? original.slice(idx + value.length) : '';
      const span = wrap.ownerDocument.createElement('span');
      span.textContent = value;
      const parent = t.parentNode!;
      if (before) parent.insertBefore(wrap.ownerDocument.createTextNode(before), t);
      parent.insertBefore(span, t);
      if (after) parent.insertBefore(wrap.ownerDocument.createTextNode(after), t);
      parent.removeChild(t);
      target = span;
    }

    bindInlinePropEditor(target, propName, onPropChange);
  }
}

/**
 * Attach the inline-prop event listeners to a target element. Pulled
 * out of `wireInlinePropEditors` so both the selector-driven path
 * (defaults like Aside's auto-derived "Note" title) and the text-match
 * path (explicit prop values that render as visible text) share the
 * same wiring code — contenteditable attribute, focus override against
 * stretched-link anchors, Enter/Escape semantics, and the blur commit
 * that flows back through `onPropChange`.
 */
function bindInlinePropEditor(
  target: HTMLElement,
  propName: string,
  onPropChange: (propName: string, value: string) => void,
): void {
  // `plaintext-only` keeps the contenteditable from accepting rich
  // formatting (bold, italic, pasted markup). String props are flat
  // text — bolding inside one would silently lose the styling on
  // save anyway, so the affordance shouldn't suggest otherwise.
  target.setAttribute('contenteditable', 'plaintext-only');
  target.setAttribute('data-conloca-prop', propName);
  target.setAttribute('spellcheck', 'true');
  // Small visual cue so the author can tell which inline regions
  // accept editing. Faint outline-color on hover, no layout shift.
  target.classList.add('conloca-inline-prop');

  let committed = (target.textContent ?? '').trim();
  const commit = () => {
    const next = (target.textContent ?? '').trim();
    if (next !== committed) {
      committed = next;
      onPropChange(propName, next);
    }
  };
  target.addEventListener('blur', commit);
  target.addEventListener('keydown', (e: KeyboardEvent) => {
    // Enter commits (string props are single-line); Escape reverts.
    if (e.key === 'Enter') {
      e.preventDefault();
      target.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      target.textContent = committed;
      target.blur();
    }
  });
  // Anchor-parent focus override. When the inline-editable element sits
  // inside a clickable anchor (Starlight's `<LinkCard>` wraps title +
  // description in a single `<a>`), the browser's default mousedown
  // focuses the anchor, not our contenteditable child. Override by
  // calling preventDefault() to stop the anchor's default focus, then
  // explicitly focus the contenteditable and place the caret at the
  // click point. `stopPropagation` is intentionally NOT used — the
  // parent block's mousedownCapture still needs to fire so the side
  // panel updates with this block's props.
  target.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    target.focus();
    // `caretPositionFromPoint` is the spec API; WebKit/older Chromium
    // ship `caretRangeFromPoint` instead. Try both, fall back to the
    // end of the text if neither works.
    const doc = target.ownerDocument;
    let range: Range | null = null;
    const cp = (
      doc as unknown as {
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      }
    ).caretPositionFromPoint;
    if (cp) {
      const pos = cp.call(doc, e.clientX, e.clientY);
      if (pos) {
        range = doc.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    } else if (
      (doc as unknown as { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint
    ) {
      range = (doc as unknown as { caretRangeFromPoint: (x: number, y: number) => Range | null }).caretRangeFromPoint(
        e.clientX,
        e.clientY,
      );
    }
    if (!range) {
      range = doc.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
    }
    const sel = doc.defaultView?.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  });
}

/**
 * Activate the tab the author clicked on inside an SSR'd `<starlight-tabs>`
 * preview. Mirrors what `<starlight-tabs>`'s connectedCallback does at
 * runtime on the published page — toggling `aria-selected` on the trigger
 * and the `hidden` attribute on the matching panel — but runs purely off
 * the DOM we already SSR'd, so the editor doesn't need to load the host's
 * tab script.
 *
 * Starlight's tab markup ([starlight-tabs] > [role=tablist] > a[role=tab]
 * with `href="#tab-panel-N"`, and `<section role="tabpanel" id="...">`
 * siblings of the tablist) is stable enough that this resolves by
 * traversing roles + the href hash. If Starlight ever ships a different
 * variant the resolution falls back to no-op, which is the same as the
 * pre-fix behaviour.
 */
function activateTabInPlace(tab: HTMLElement): void {
  const tablist = tab.closest('[role="tablist"]');
  // The panels live as siblings of the tablist inside the same custom
  // element (or inside a generic ancestor if Starlight changes shape).
  const tabsRoot = tab.closest('starlight-tabs') ?? tablist?.parentElement ?? null;
  if (!tablist || !tabsRoot) return;

  // Deselect every trigger in this tablist; tabindex=-1 keeps keyboard
  // focus order matching Starlight's runtime behaviour.
  for (const t of tablist.querySelectorAll('[role="tab"]')) {
    t.setAttribute('aria-selected', 'false');
    t.setAttribute('tabindex', '-1');
  }
  tab.setAttribute('aria-selected', 'true');
  tab.setAttribute('tabindex', '0');

  // Resolve target panel via the trigger's `href="#id"`. Falls back to
  // positional match if href is missing — covers future Starlight shapes
  // that wire via aria-controls or index.
  const href = tab.getAttribute('href') || '';
  const targetId = href.startsWith('#') ? href.slice(1) : '';
  const panels = Array.from(tabsRoot.querySelectorAll('[role="tabpanel"]'));
  let activeIndex = -1;
  if (targetId) {
    activeIndex = panels.findIndex((p) => p.id === targetId);
  }
  if (activeIndex < 0) {
    const triggers = Array.from(tablist.querySelectorAll('[role="tab"]'));
    activeIndex = triggers.indexOf(tab);
  }
  panels.forEach((p, i) => {
    if (i === activeIndex) p.removeAttribute('hidden');
    else p.setAttribute('hidden', '');
  });
}

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
 * Strip the `body` (escaped-text fallback) field from every node in the
 * render tree before hashing for the SSR cache key. Cache keys should
 * hash structural shape — NOT prose body text from the portaled
 * `<NestedLexicalEditor>`s. Without this, every keystroke inside a
 * leaf body would mint a different cache key and force a server
 * roundtrip even though the SSR HTML itself doesn't change (the body
 * lives in the portaled slot, not in the SSR markup).
 *
 * `bodyHtml` is NOT stripped — unlike `body` (a static text fallback
 * the editor portal hides), `bodyHtml` IS the actual rendered slot
 * content for strict-slot components (Steps, FileTree) where the
 * editor doesn't portal an inline editor. Its value must participate
 * in the cache key, otherwise changes to the list structure won't
 * bust the stale cached HTML and the SSR returns out-of-date markup.
 */
function stripBodyFields(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripBodyFields);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === 'body') continue;
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

/**
 * Like `replaceMdastAtPath` but swaps the WHOLE node at `path`, not
 * just its children. Used when the side panel edits a CHILD
 * component's attributes (eg a Card inside a CardGrid): we replace
 * the child JSX node with a new one carrying updated attributes.
 *
 * `replaceMdastAtPath` only rewrites `children` because that's all
 * the inline body editors ever change. For attribute edits the whole
 * node needs replacement, hence this twin.
 */
function replaceMdastNodeAtPath(
  root: MdxJsxFlowElement,
  path: number[],
  newNode: MdxJsxFlowElement,
): MdxJsxFlowElement {
  if (path.length === 0) return newNode;
  const [head, ...rest] = path;
  const originalKids = (root.children ?? []) as unknown[];
  const isUnwrapped =
    originalKids.length === 1 && (originalKids[0] as { type?: string } | undefined)?.type === 'paragraph';
  const workingKids = isUnwrapped ? ((originalKids[0] as { children?: unknown[] }).children ?? []) : originalKids;
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
  const updatedKid = rest.length === 0 ? newNode : replaceMdastNodeAtPath(targetKid, rest, newNode);
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

/**
 * Drop the JSX node at `path` from its parent's children. Same walk
 * as `replaceMdastNodeAtPath` — at the leaf we splice instead of
 * replace. Used when the side panel's Remove button fires on a
 * selected CHILD inside a container (eg removing one Card from a
 * CardGrid without touching the grid itself).
 */
function removeMdastNodeAtPath(root: MdxJsxFlowElement, path: number[]): MdxJsxFlowElement {
  if (path.length === 0) return root;
  const [head, ...rest] = path;
  const originalKids = (root.children ?? []) as unknown[];
  const isUnwrapped =
    originalKids.length === 1 && (originalKids[0] as { type?: string } | undefined)?.type === 'paragraph';
  const workingKids = isUnwrapped ? ((originalKids[0] as { children?: unknown[] }).children ?? []) : originalKids;
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
  let newWorkingKids: unknown[];
  if (rest.length === 0) {
    // Leaf — splice the child out.
    newWorkingKids = workingKids.filter((_, i) => i !== originalIdx);
  } else {
    const targetKid = workingKids[originalIdx] as MdxJsxFlowElement;
    const updatedKid = removeMdastNodeAtPath(targetKid, rest);
    newWorkingKids = [...workingKids];
    newWorkingKids[originalIdx] = updatedKid;
  }
  if (isUnwrapped) {
    const paragraphWrap = originalKids[0] as { children?: unknown[] };
    return {
      ...root,
      children: [{ ...paragraphWrap, children: newWorkingKids }] as MdxJsxFlowElement['children'],
    };
  }
  return { ...root, children: newWorkingKids as MdxJsxFlowElement['children'] };
}

/**
 * Given a child slot element inside a container's SSR'd preview,
 * return the DOM subtree that belongs to ONLY this child. Used to
 * bound the inline-prop scan so we don't accidentally match a
 * sibling child's title.
 *
 * Heuristic: walk up from the slot. Each ancestor is a candidate.
 * We keep walking as long as the parent of the ancestor contains
 * exactly one slot-with-data-slot-id descendant (this slot). The
 * moment we'd step into an ancestor whose subtree contains MORE
 * than one slot — that's the boundary between children — we stop
 * and return the last single-slot ancestor.
 *
 * For Starlight CardGrid the result is the `<article class="card">`
 * for each child. For a future framework that wraps each child
 * differently the same logic applies — we don't care about the
 * specific class names.
 *
 * Returns `null` if the slot isn't actually inside a container with
 * sibling slots (eg edge cases where the framework only emits one
 * child). The caller falls back to wiring against the whole wrapper.
 */
function findChildRegion(slot: HTMLElement): HTMLElement | null {
  let region: HTMLElement = slot;
  let parent = slot.parentElement;
  while (parent) {
    const slotCount = parent.querySelectorAll(`${SLOT_TAG}[data-slot-id]`).length;
    if (slotCount > 1) {
      // Parent encloses more than one child — region is the current
      // node (before stepping into the multi-child container).
      return region === slot ? null : region;
    }
    region = parent;
    parent = parent.parentElement;
  }
  return region === slot ? null : region;
}

/**
 * Find the first mdast `list` node inside a component's effective
 * children. Returns both the list and the path that `getMdastAtPath`
 * would walk to reach it. `null` when no list is present at the top
 * level — eg a regular Aside body where children are paragraphs.
 *
 * Handles two common shapes:
 *   1. `{ name: 'Steps', children: [list] }` — path: `[0]`
 *   2. `{ name: 'Steps', children: [{paragraph, children:[list]}] }`
 *      — `effectiveChildren` unwraps the single-paragraph wrapper, so
 *      the list is still reached at path `[0]`.
 *
 * Restricted to "first child is a list" because that's the strict-
 * slot list pattern (Steps, FileTree). A Card body that happens to
 * contain a list as a non-leading child stays in the regular slot
 * path — those have a real `<conloca-slot>` from the server already.
 */
function findTopLevelList(
  node: MdxJsxFlowElement,
): { list: { children: unknown[]; ordered?: boolean }; path: number[] } | null {
  const effective = effectiveChildren(node as { children?: unknown[] });
  if (effective.length === 0) return null;
  const first = effective[0] as { type?: string; children?: unknown[]; ordered?: boolean } | undefined;
  if (first?.type !== 'list' || !Array.isArray(first.children)) return null;
  return { list: first as { children: unknown[]; ordered?: boolean }, path: [0] };
}

/**
 * Wire each `<li>` of the first ordered/unordered list in the
 * rendered preview as a contenteditable, with on-blur commit that
 * rewrites the corresponding mdast `listItem`. Used for strict-slot
 * list components (Starlight `<Steps>`, `<FileTree>`) where the
 * framework rejects `<conloca-slot>` children — we can't portal a
 * Lexical editor into them, so we edit the rendered HTML in place.
 *
 * Trade-off vs the portal path: this loses any inline formatting on
 * commit (the blur handler reads `textContent` and rewrites the item
 * as plain text). The rendered output keeps whatever formatting the
 * framework SSR'd (bold survives across renders that don't touch the
 * item), but typing in a step replaces its content with plaintext.
 * For step descriptions and file-tree labels that's usually fine; for
 * heavily-formatted lists the user has to edit through markdown.
 *
 * DOM mutation safety: we DO NOT replace the li's children or inject
 * anything React might reconcile against. Just set `contenteditable`
 * on the existing element and attach listeners. The next render's
 * `wrap.innerHTML = html` wipes the contenteditable cleanly.
 */
function wireListItemEditors(
  wrap: HTMLElement,
  node: MdxJsxFlowElement,
  updater: (partial: Partial<MdxJsxFlowElement>) => void,
  pendingFocusIndexRef: { current: number | null },
): void {
  const found = findTopLevelList(node);
  if (!found) return;
  const domList = wrap.querySelector('ol, ul');
  if (!domList) return;
  const domItems = Array.from(domList.children).filter((c): c is HTMLElement => c.tagName === 'LI');
  if (domItems.length !== found.list.children.length) return;
  // Default-deny tree-shaped lists. A flat plaintext editor over an
  // `<li>` that contains a nested `<ul>`/`<ol>` would collapse the
  // sub-tree into a single text node on commit. FileTree is the
  // canonical case, but the same trap applies to any nav-menu /
  // outline / nested-list component. The side panel still works;
  // authors who need to restructure the tree edit the raw MDX.
  // Future: a proper tree-aware editor can ship as a follow-up that
  // handles recursive wiring, path-scoped writes, and add/remove
  // affordances for sub-items.
  if (domItems.some((li) => li.querySelector('ul, ol') !== null)) return;
  const listOrdered = found.list.ordered ?? false;

  /**
   * Shared helper that writes a new list of items back through the
   * mdast updater, preserving the paragraph-wrap shape if any. All
   * commit / insert / remove paths funnel through this so the
   * write-side logic stays in one place.
   */
  const writeListChildren = (newListChildren: unknown[]) => {
    const newList = { type: 'list', ordered: listOrdered, children: newListChildren };
    const originalKids = (node.children ?? []) as unknown[];
    const isWrapped =
      originalKids.length === 1 && (originalKids[0] as { type?: string } | undefined)?.type === 'paragraph';
    const newChildren = isWrapped ? [{ ...(originalKids[0] as object), children: [newList] }] : [newList];
    updater({ children: newChildren as typeof node.children });
  };
  const buildListItem = (text: string) => ({
    type: 'listItem',
    children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }],
  });

  for (let i = 0; i < domItems.length; i++) {
    const li = domItems[i];
    // Skip already-wired editors so re-renders don't double-bind.
    if (li.hasAttribute('data-conloca-listitem')) continue;
    li.setAttribute('data-conloca-listitem', String(i));
    li.setAttribute('contenteditable', 'plaintext-only');
    li.classList.add('conloca-listitem');
    let committed = (li.textContent ?? '').trim();
    const itemIndex = i;
    const commit = () => {
      const next = (li.textContent ?? '').trim();
      if (next === committed) return;
      committed = next;
      // Build a fresh listItem with a single paragraph of plain text.
      // Future enhancement: parse inline markdown so `**bold**` round-
      // trips correctly. For now, plaintext-only matches the editing
      // affordance authors see (no formatting toolbar in the li).
      const newListChildren = found.list.children.map((it, idx) => (idx === itemIndex ? buildListItem(next) : it));
      writeListChildren(newListChildren);
    };
    /**
     * Insert an empty list item BELOW this one and ask the next
     * render to focus the new li. The render cycle is:
     *   1. writeListChildren → mdast updates → React re-renders
     *   2. html-injection effect runs `wrap.innerHTML = html`
     *   3. wireListItemEditors runs again; it sees the pending
     *      focus index and focuses that li.
     * The ref decouples the focus request from the render — we
     * can't focus the new li synchronously because it doesn't
     * exist in the DOM yet.
     */
    const insertItemBelow = () => {
      // Commit current text first so we don't lose any unsaved
      // typing in this li. `commit` is a no-op if nothing changed.
      const currentText = (li.textContent ?? '').trim();
      const updatedCurrent = buildListItem(currentText);
      const newListChildren = [
        ...found.list.children.slice(0, itemIndex),
        updatedCurrent,
        buildListItem(''),
        ...found.list.children.slice(itemIndex + 1),
      ];
      pendingFocusIndexRef.current = itemIndex + 1;
      writeListChildren(newListChildren);
    };
    /**
     * Remove this list item from the list. Used when the author
     * presses Backspace at the start of an already-empty step. If
     * removing would leave the list empty we leave one empty item
     * — Starlight's `<Steps>` rejects an empty `<ol>` and the
     * author probably wants to keep editing.
     */
    const removeSelf = () => {
      if (found.list.children.length <= 1) return;
      const newListChildren = found.list.children.filter((_, idx) => idx !== itemIndex);
      // Focus the previous item after re-render (or the new first
      // item if we removed the head).
      pendingFocusIndexRef.current = Math.max(0, itemIndex - 1);
      writeListChildren(newListChildren);
    };

    li.addEventListener('blur', commit);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        // Enter splits the list: commit current text, append a new
        // empty item below, focus it. Standard list-editor pattern
        // (Notion, Bear, native markdown editors).
        e.preventDefault();
        insertItemBelow();
      } else if (e.key === 'Backspace') {
        // Backspace at the start of an empty item removes the item.
        // Anywhere else: default delete-character behaviour.
        const text = (li.textContent ?? '').trim();
        if (text.length === 0) {
          e.preventDefault();
          removeSelf();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        li.textContent = committed;
        li.blur();
      }
    });
  }

  // After every re-wire pass, honor any pending focus request from
  // the previous render's keyboard handler. This is what makes Enter
  // / Backspace feel responsive — the new li appears AND gets the
  // caret in one perceived action.
  if (pendingFocusIndexRef.current !== null) {
    const targetIdx = pendingFocusIndexRef.current;
    pendingFocusIndexRef.current = null;
    const target = domItems[targetIdx];
    if (target) {
      // Defer to next microtask so any in-flight focus management
      // (Lexical refocus after the discrete update) settles first.
      Promise.resolve().then(() => {
        target.focus();
        // Place caret at start for the freshly-inserted empty item.
        const range = target.ownerDocument.createRange();
        range.selectNodeContents(target);
        range.collapse(true);
        const sel = target.ownerDocument.defaultView?.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
      });
    }
  }
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
    case 'listItem': {
      // Unwrap `paragraph` children of list items so their contents
      // render inline-of-the-`<li>` rather than wrapped in a block
      // `<p>`. Matches Astro's MDX pipeline for both tight lists (a
      // single-paragraph listItem) AND loose lists like `<FileTree>`'s
      // directory items (`paragraph` for the name + nested `list` for
      // children).
      //
      // Without this, Starlight's <FileTree> renders directory names
      // in a block <p>, which inside .tree-entry (inline-flex) wraps
      // onto its own line — folder icons end up stacked above their
      // names instead of inline with them, the way the live page
      // renders. Same fix protects any list-bearing strict-slot
      // component shipped via bodyHtml.
      const kids = n.children ?? [];
      const inner = kids
        .map((c) =>
          (c as { type?: string } | undefined)?.type === 'paragraph'
            ? ((c as { children?: unknown[] }).children ?? []).map(mdastToHtml).join('')
            : mdastToHtml(c),
        )
        .join('');
      return `<li>${inner}</li>`;
    }
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
  /** Index of a list item that should receive focus after the next
   * render commits. Set by the Enter / Backspace handlers in
   * `wireListItemEditors`; consumed by the same function on the
   * next re-wire pass. Lives at component level (not effect-local)
   * so it survives across render cycles. */
  const pendingListItemFocusRef = useRef<number | null>(null);

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
    // After replacing the preview HTML, scan for string-prop values that
    // appear exactly once as a leaf element's textContent and wire those
    // elements as contenteditable. Authors edit eg LinkCard's `description`
    // in place; the blur handler commits via `onPropChange`. Runs after
    // every prop change because the new HTML wipes prior contenteditable
    // attributes — re-wiring keeps inline editing alive across re-renders.
    wireInlinePropEditors(wrap, attrs, onPropChange);
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
      // Per-child inline-prop wiring. The container's own
      // `wireInlinePropEditors` call above only matches against the
      // container's props (eg CardGrid's `stagger`) — child Cards'
      // `title` and `icon` values are skipped because the matcher
      // doesn't know they belong to a child. For each child slot
      // we find the enclosing region (the DOM subtree the framework
      // rendered for that one child), then run the matcher against
      // the child's own attrs with a child-scoped `onPropChange` that
      // routes through `replaceMdastNodeAtPath`. This is what lets
      // the author click "First card" inside a CardGrid and edit it.
      for (const [slotId, slotEl] of next) {
        const childPath = slotIdToPath(slotId);
        const childNode = getMdastAtPath(node, childPath);
        if (!childNode) continue;
        const region = findChildRegion(slotEl as HTMLElement);
        if (!region) continue;
        // Tag the child's enclosing region with its path so the
        // wrapper-level mousedown/focus handler (`handleSelect`) can
        // resolve which child a click landed in. The slot-id walk
        // alone isn't enough — clicks on a child's title or icon
        // (which sit OUTSIDE the slot) wouldn't find a slot ancestor
        // via `closest`. This attribute IS a child ancestor in those
        // cases, so `closest('[data-conloca-child-path]')` lands on
        // the right region.
        region.setAttribute('data-conloca-child-path', slotId);
        const childAttrs = readAttrs(childNode);
        const childOnPropChange = (propName: string, value: string | boolean | number | null | undefined) => {
          const newChild = {
            ...childNode,
            attributes: writeAttribute(childNode.attributes, propName, value),
          } as MdxJsxFlowElement;
          const nextRoot = replaceMdastNodeAtPath(node, childPath, newChild);
          updater({ children: nextRoot.children as typeof node.children });
        };
        wireInlinePropEditors(region, childAttrs, childOnPropChange);
      }
    } else {
      // Not a JSX container (so `containerMode` is false). But the
      // mdast might still be a list-based strict-slot component (Steps,
      // FileTree, anything else whose framework component validates
      // its slot as a real `<ol>` / `<ul>` and rejects `<conloca-slot>`
      // children). For those, we wire each `<li>` as a contenteditable
      // with on-blur commit — no DOM mutation, no portal collision
      // with React. Trade-off: plaintext-only commits (loses bold/
      // italic on edit). Future enhancement: parse inline markdown
      // back from contenteditable text so formatting round-trips.
      wireListItemEditors(wrap, node, updater, pendingListItemFocusRef);
      setContainerSlots(new Map());
      setSlotEl(wrap.querySelector(SLOT_TAG));
    }
    // `attrs` and `onPropChange` are NOT in deps on purpose. They get a
    // fresh identity on every render (new object from `readAttrs`, new
    // callback closure), so listing them would re-run this effect for
    // every parent render — including selection-change re-renders that
    // don't actually touch the preview HTML. That would re-set
    // `innerHTML` mid-typing and trash the contenteditable's focus.
    // The effect already runs whenever `html` changes, and `html` only
    // updates after `propsJson` changes (via the renderReq fetch path),
    // so the closure captures the right `attrs`/`onPropChange` for the
    // commit that triggered the new render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, containerMode]);

  const slot = (
    <NestedLexicalEditor<MdxJsxFlowElement>
      getContent={(n) => n.children as Mdast.PhrasingContent[]}
      getUpdatedMdastNode={(n, children) => ({ ...n, children: children as MdxJsxFlowElement['children'] })}
    />
  );

  const onPropChange = useCallback(
    (propName: string, next: string | boolean | number | null | undefined) => {
      // Route through the type-aware writer so booleans become JSX
      // shorthand (`<CardGrid stagger />`), numbers become expressions
      // (`<Box columns={3} />`), and strings stay as string literals.
      // The inline-prop editor in the preview still calls this with
      // string values — `writeAttribute` handles those identically to
      // `writeStringAttribute` (the previous narrow writer).
      updater({ attributes: writeAttribute(node.attributes, propName, next) as typeof node.attributes });
    },
    [updater, node.attributes],
  );

  // Publish to the side-panel registry whenever this block is the
  // currently-selected one, or its props change while still selected.
  // The panel reads `descriptor`/`attrs` to render the form and calls
  // back through `onPropChange`/`removeNode` (closed over the block's
  // own updater hooks) so updates flow on the same path inline editing
  // used.
  // Stable per-block identity. `useLexicalNodeRemove` returns a fresh
  // closure on each render so we can't key off `removeNode`. The Lexical
  // node `getKey()` is stable for the block's whole lifetime and unique
  // across siblings — exactly what the side-panel registry and the
  // `is-selected` className need to identify the active block.
  const blockKey = lexicalNode.getKey();

  useEffect(() => {
    if (!descriptor) return;
    const current = getSelectedBlock();
    if (!current) return;
    if (current.key === blockKey) {
      // Container/leaf itself is selected — republish with current attrs.
      setSelectedBlock({ key: blockKey, name, descriptor, attrs, onPropChange, onRemove: removeNode });
      return;
    }
    // A child of this container might be the selection. Child keys are
    // `${containerKey}:${dotPath}` — strip our prefix to find which
    // child path the panel is showing. Re-resolve that child from the
    // current mdast so panel inputs reflect prop edits done elsewhere
    // (inline editor commits, programmatic updates).
    if (containerMode && current.key.startsWith(`${blockKey}:`)) {
      const dotPath = current.key.slice(blockKey.length + 1);
      const childPath = dotPath ? dotPath.split('.').map((s) => Number.parseInt(s, 10)) : [];
      const childNode = getMdastAtPath(node, childPath);
      if (!childNode || childNode.name !== current.name) return;
      const childDescriptor = descriptors.find((d) => d.name === childNode.name);
      if (!childDescriptor || !isJsxDescriptor(childDescriptor)) return;
      const childAttrs = readAttrs(childNode);
      const childOnPropChange = (propName: string, value: string | boolean | number | null | undefined) => {
        const newChild = {
          ...childNode,
          attributes: writeAttribute(childNode.attributes, propName, value),
        } as MdxJsxFlowElement;
        const next = replaceMdastNodeAtPath(node, childPath, newChild);
        updater({ children: next.children as typeof node.children });
      };
      const childOnRemove = () => {
        const next = removeMdastNodeAtPath(node, childPath);
        updater({ children: next.children as typeof node.children });
      };
      setSelectedBlock({
        key: current.key,
        name: childNode.name,
        descriptor: childDescriptor,
        attrs: childAttrs,
        onPropChange: childOnPropChange,
        onRemove: childOnRemove,
      });
    }
    // Deps are intentionally narrow. `propsJson` is the content the panel
    // reads; `descriptor`/`name`/`blockKey` define identity. `onPropChange`
    // and `removeNode` are FRESH closures on every render (Lexical's
    // updater hooks rebuild them), so including them would trigger a
    // re-publish → useSelectedBlock fires → all blocks re-render →
    // closure identities change → re-publish → infinite loop. We capture
    // the latest closures via the `attrs`/`propsJson` change signal
    // instead, which is the moment the panel actually needs an update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propsJson, descriptor, name, blockKey, containerMode]);

  const handleSelect = useCallback(
    (e?: React.SyntheticEvent) => {
      if (!descriptor) return;
      // Container resolution: when the click/focus landed inside a
      // child slot (eg a Card inside a CardGrid), publish the CHILD's
      // descriptor + attrs to the panel instead of the container's.
      // The same wrapper handler covers both cases — we walk from the
      // event target to find the nearest `data-slot-id` ancestor; if
      // one exists, the user clicked into a child, otherwise the click
      // hit container-level chrome and the container itself is the
      // selection.
      if (containerMode && e) {
        const target = e.target as HTMLElement | null;
        // Prefer the child-region marker stamped by the html-injection
        // effect — covers clicks anywhere inside a child (title, icon,
        // body). The slot-id fallback covers the case where the
        // region marker is missing (eg edge cases where the region
        // walker couldn't find a bounded subtree).
        const regionEl = target?.closest<HTMLElement>('[data-conloca-child-path]');
        const slotEl = regionEl ?? target?.closest<HTMLElement>('[data-slot-id]');
        if (slotEl) {
          const slotId = slotEl.getAttribute('data-conloca-child-path') ?? slotEl.getAttribute('data-slot-id') ?? '';
          const childPath = slotIdToPath(slotId);
          const childNode = getMdastAtPath(node, childPath);
          if (childNode && childNode.name) {
            const childDescriptor = descriptors.find((d) => d.name === childNode.name);
            if (childDescriptor && isJsxDescriptor(childDescriptor)) {
              const childAttrs = readAttrs(childNode);
              const childKey = `${blockKey}:${childPath.join('.')}`;
              const childOnPropChange = (propName: string, value: string | boolean | number | null | undefined) => {
                const newChild = {
                  ...childNode,
                  attributes: writeAttribute(childNode.attributes, propName, value),
                } as MdxJsxFlowElement;
                const next = replaceMdastNodeAtPath(node, childPath, newChild);
                updater({ children: next.children as typeof node.children });
              };
              const childOnRemove = () => {
                const next = removeMdastNodeAtPath(node, childPath);
                updater({ children: next.children as typeof node.children });
              };
              setSelectedBlock({
                key: childKey,
                name: childNode.name,
                descriptor: childDescriptor,
                attrs: childAttrs,
                onPropChange: childOnPropChange,
                onRemove: childOnRemove,
              });
              return;
            }
          }
        }
      }
      setSelectedBlock({ key: blockKey, name, descriptor, attrs, onPropChange, onRemove: removeNode });
    },
    [blockKey, descriptor, name, attrs, onPropChange, removeNode, containerMode, node, descriptors, updater],
  );

  // SSR'd component previews ship with real interactive anchors — Starlight
  // `<LinkCard>`s navigate, `<Tabs>` triggers are `<a role="tab" href="#...">`,
  // any `<a>` inside a `<Card>` body, etc. In a live page Starlight's custom
  // elements (`<starlight-tabs>`) wire click → tab-panel toggle, and link
  // anchors navigate. In the editor neither of those is desirable: the JS
  // that runs `<starlight-tabs>`'s connectedCallback isn't loaded under
  // /__cms, and navigation yanks the author away from what they're editing.
  //
  // So intercept anchor clicks in capture phase and handle the two cases:
  //   1. `[role="tab"]` → switch tabs in place (manual ARIA toggle that
  //      mirrors what `<starlight-tabs>` would do at runtime). The author
  //      can now click "npm" to see and edit the npm tab body.
  //   2. Any other `<a>` → swallow. Selection still fires from the
  //      `mousedown` handler so the block becomes selected as if it were a
  //      static surface.
  //
  // `auxclick` (middle-click) gets the anchor swallow too — without it
  // middle-click on a LinkCard would still "open in new tab" and escape
  // the editor.
  const handleAnchorClickInPreview = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const tab = target?.closest('[role="tab"]');
    if (tab) {
      e.preventDefault();
      e.stopPropagation();
      activateTabInPlace(tab as HTMLElement);
      return;
    }
    if (target?.closest('a')) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  // Per-block "am I selected" subscription. Compares the registry's
  // current key with this block's stable key; safe across re-renders.
  // The CSS hook is the `is-selected` class on the wrapper, which paints
  // the accent outline; the side panel keys off the same registry.
  const selected = useSelectedBlock();
  const isSelected = selected?.key === blockKey;

  // Raw HTML in MDX (`<div class="x">`, `<details>`, etc.) lands here
  // with a lowercase tag name and no registered component descriptor.
  // Render the whole subtree client-side as HTML — no SSR roundtrip,
  // no labelled fallback. Static (not inline-editable) for now.
  if (!source && isHtmlTag(name)) {
    const rawHtml = mdastToHtml(node);
    return (
      <div
        className={`conloca-generic-block conloca-generic-block--html${isSelected ? ' is-selected' : ''}`}
        onMouseDownCapture={handleSelect}
        onFocusCapture={handleSelect}
        onClickCapture={handleAnchorClickInPreview}
        onAuxClickCapture={handleAnchorClickInPreview}
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
      <span
        className={`conloca-generic-block conloca-generic-block--inline${isSelected ? ' is-selected' : ''}`}
        onMouseDownCapture={handleSelect}
        onFocusCapture={handleSelect}
        onClickCapture={handleAnchorClickInPreview}
        onAuxClickCapture={handleAnchorClickInPreview}
      >
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
    <div
      className={`conloca-generic-block${isSelected ? ' is-selected' : ''}`}
      onMouseDownCapture={handleSelect}
      onFocusCapture={handleSelect}
      onClickCapture={handleAnchorClickInPreview}
      onAuxClickCapture={handleAnchorClickInPreview}
    >
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
          {/* Container/list slots: each child node OR list item gets
              a slot with `data-slot-id`. Portal a `ContainerSlotEditor`
              into each, scoped to that child's mdast subtree via path
              resolution. The same render path covers two cases —
              container components (CardGrid → Card children) and
              strict-slot list components (Steps → listItem children)
              where the slot markers are injected client-side post-SSR. */}
          {Array.from(containerSlots).map(([slotId, el]) =>
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
