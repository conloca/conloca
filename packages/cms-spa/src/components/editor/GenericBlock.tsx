import type { JsxEditorProps } from '@mdxeditor/editor';
import { NestedLexicalEditor, useLexicalNodeRemove, useMdastNodeUpdater } from '@mdxeditor/editor';
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

interface RenderRequest {
  component: string;
  source: string;
  defaultExport?: boolean;
  props: AnyProps;
}

const SLOT_TAG = 'conloca-slot';
const RENDER_ENDPOINT = '/__cms/api/render';

/**
 * In-memory cache of rendered HTML keyed by component + source + props.
 * Same edit state (eg the author scrolls back to a prop they already
 * tried) reuses the cached HTML without a server roundtrip. Cleared on
 * page reload.
 */
const renderCache = new Map<string, string>();

function cacheKey(req: RenderRequest): string {
  return `${req.source}::${req.defaultExport ? '*default*:' : ''}${req.component}::${stableStringify(req.props)}`;
}

function stableStringify(obj: AnyProps): string {
  const keys = Object.keys(obj).sort();
  return JSON.stringify(Object.fromEntries(keys.map((k) => [k, obj[k]])));
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

function readAttrs(node: MdxJsxFlowElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of node.attributes) {
    if (a.type === 'mdxJsxAttribute' && typeof a.value === 'string') out[a.name] = a.value;
  }
  return out;
}

export function GenericBlock({ mdastNode }: JsxEditorProps) {
  const updater = useMdastNodeUpdater<MdxJsxFlowElement>();
  const removeNode = useLexicalNodeRemove();
  const descriptors = useMdxComponents();

  const node = mdastNode as MdxJsxFlowElement;
  const attrs = readAttrs(node);
  const name = node.name ?? '';
  const found = descriptors.find((d): d is MdxComponentDescriptor => 'name' in d && d.name === name);
  const descriptor = found && isJsxDescriptor(found) ? found : null;
  const source = descriptor?.import?.from;
  const defaultExport = descriptor?.import?.default ?? false;

  // Memoize the request so we don't re-fetch on every render — only when
  // name/source/props actually change. Props are compared via stable JSON
  // so attribute reordering doesn't trigger a re-fetch.
  const propsJson = useMemo(() => stableStringify(attrs), [attrs]);
  const renderReq = useMemo<RenderRequest | null>(
    () => (source ? { component: name, source, defaultExport, props: attrs } : null),
    // attrs is regenerated on every render but its identity is stable per propsJson.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [name, source, defaultExport, propsJson],
  );

  const [html, setHtml] = useState<string | null>(() =>
    renderReq ? (renderCache.get(cacheKey(renderReq)) ?? null) : null,
  );
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [slotEl, setSlotEl] = useState<Element | null>(null);

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

  // Imperatively swap the wrapper's inner HTML when the rendered string
  // changes, then locate the slot element so the nested editor can portal
  // into it. Imperative swap (vs `dangerouslySetInnerHTML`) makes it easy
  // to keep the slot ref stable for React to find via the portal.
  useEffect(() => {
    const wrap = wrapperRef.current;
    if (!wrap || html == null) return;
    wrap.innerHTML = html;
    setSlotEl(wrap.querySelector(SLOT_TAG));
  }, [html]);

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

  return (
    <div className="conloca-generic-block" onMouseDownCapture={handleSelect}>
      {/* Wrapper that hosts the SSR'd HTML. The nested editor portals
          into the <conloca-slot> element inside this HTML. When no source
          is registered or the SSR call fails (eg components like Starlight's
          `<Steps>` / `<FileTree>` validate their slot must be a specific
          list element and reject the `<conloca-slot>` marker), fall back to
          a generic wrapper so the body stays editable and visual chrome
          appears at least labeled. */}
      {source && !error ? (
        <>
          <div ref={wrapperRef} className="conloca-generic-block__rendered" />
          {slotEl && createPortal(slot, slotEl)}
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
