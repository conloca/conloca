import type { MdxJsxFlowElement } from 'mdast-util-mdx-jsx';

/**
 * Pure mdast-walking helpers used by `GenericBlock` to read and rewrite
 * the JSX subtree it owns.
 *
 * Lives outside the component file because none of these touch React,
 * the DOM, or editor state — they're plain tree operations on the
 * mdast shape produced by `mdast-util-mdx-jsx`. Same input, same
 * output, every time.
 */

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
export function stripBodyFields(node: unknown): unknown {
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
export function readAttrs(node: MdxJsxFlowElement): Record<string, unknown> {
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
export function effectiveChildren(node: { children?: unknown[] }): unknown[] {
  const kids = node.children ?? [];
  if (kids.length === 1) {
    const only = kids[0] as { type?: string; children?: unknown[] };
    if (only?.type === 'paragraph') return only.children ?? [];
  }
  return kids;
}

/** Read the `slot` attribute off a `<Fragment slot="...">` mdast
 * node. Returns null when the node isn't a Fragment, isn't named, or
 * the slot attribute isn't a plain string. */
export function getNamedSlotName(child: unknown): string | null {
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

/**
 * Parse a slot id like `"root.0.1"` into a numeric path `[0, 1]`. The
 * leading `"root"` is the buildRenderTree prefix and isn't a real
 * step; an empty path (`"root"` alone) means the top-level node
 * itself, which is never an inline-editable slot (it's the parent we
 * SSR'd) — included only for completeness.
 */
export function slotIdToPath(slotId: string): number[] {
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
export function getMdastAtPath(root: unknown, path: number[]): MdxJsxFlowElement | null {
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
export function replaceMdastAtPath(
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
export function replaceMdastNodeAtPath(
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
export function removeMdastNodeAtPath(root: MdxJsxFlowElement, path: number[]): MdxJsxFlowElement {
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
