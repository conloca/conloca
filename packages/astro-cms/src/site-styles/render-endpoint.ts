import type { IncomingMessage, ServerResponse } from 'node:http';
import { experimental_AstroContainer } from 'astro/container';

/** Connect-compatible middleware handler. Avoids importing Vite's Connect
 * namespace so dual peer-hash installs of the same Vite version can't
 * produce cross-package `ViteDevServer` identity errors under tsc. */
type NextHandleFunction = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void;

/** Minimal surface used by the render tree — only ssrLoadModule. */
interface SsrModuleLoader {
  ssrLoadModule(url: string): Promise<Record<string, unknown>>;
}

/**
 * Vite middleware that renders an MDX JSX subtree to HTML on demand.
 *
 * Container components (CardGrid, Tabs, …) have JSX children that on
 * the published page render as direct DOM children of the parent —
 * positional CSS (`:nth-child` colour cycling on Card grids, CSS-grid
 * placement) depends on that DOM shape. Per-block isolated rendering
 * breaks both: each child gets its own wrapper, and the parent's only
 * direct child is a slot marker.
 *
 * This endpoint renders a recursive tree: each node provides its
 * component name + source + props, optionally with its own `children`
 * tree. The server renders leaves first and assembles parents by
 * passing rendered children HTML as the parent's default slot, so the
 * final markup matches what Astro would emit for the same MDX
 * source — same DOM, same CSS context.
 *
 * Request shape (JSON body):
 *   {
 *     tree: {
 *       component: string,
 *       source: string,
 *       defaultExport?: boolean,
 *       props?: Record<string, unknown>,
 *       slotId: string,
 *       children?: RenderTreeNode[]
 *     },
 *     documentIndex?: number  // wraps top-level output to fix
 *                             // sibling-position CSS for root-level
 *                             // blocks (see phantom-sibling fix).
 *   }
 *
 * Legacy shape (kept for backward compatibility):
 *   { component, source, defaultExport?, props?, documentIndex? }
 *
 * For each node, the rendered slot content is either:
 *   - The concatenated HTML of recursively-rendered children, if any.
 *   - `<conloca-slot data-slot-id="<id>"></conloca-slot>` placeholder
 *     otherwise (the SPA portals a Lexical editor into it).
 *
 * Returns 200 with `Content-Type: text/html` on success; 4xx with a
 * plain-text error otherwise.
 */
export function createRenderEndpoint(
  server: SsrModuleLoader,
  getAllowedSources: () => Promise<Set<string>>,
): NextHandleFunction {
  let containerPromise: Promise<experimental_AstroContainer> | null = null;
  const getContainer = () => {
    if (!containerPromise) containerPromise = experimental_AstroContainer.create();
    return containerPromise;
  };

  return async (req, res, _next) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('content-type', 'text/plain');
      res.end('Method not allowed');
      return;
    }

    try {
      const body = (await readJson(req)) as RequestBody;

      // Normalize: accept either { tree } or the legacy flat shape.
      const tree: RenderTreeNode = body.tree ?? {
        component: body.component ?? '',
        source: body.source ?? '',
        defaultExport: body.defaultExport,
        props: body.props,
        slotId: 'root',
      };

      if (!tree.component || !tree.source) {
        res.statusCode = 400;
        res.setHeader('content-type', 'text/plain');
        res.end('Missing required fields: tree.component, tree.source');
        return;
      }

      // Allowlist check. `source` flows into `server.ssrLoadModule`,
      // which will load and execute ANY file Vite can resolve — so
      // accepting arbitrary strings here would let any localhost POST
      // (eg from a malicious tab visited during `bun dev`) run any
      // JS file on the developer's machine. The registry already knows
      // every legal component source; reject anything outside it.
      const allowed = await getAllowedSources();
      const disallowed = collectDisallowedSources(tree, allowed);
      if (disallowed.length > 0) {
        res.statusCode = 400;
        res.setHeader('content-type', 'text/plain');
        res.end(`source not in registry: ${disallowed.join(', ')}`);
        return;
      }

      const container = await getContainer();
      // Even the top-level render is wrapped: a hard failure here would
      // 500 the whole response and leave the editor with no usable
      // HTML to portal a body editor into. The stub keeps the surface
      // editable so the author can fix the broken prop in place.
      let rendered: string;
      try {
        rendered = await renderTree(tree, container, server);
      } catch (err) {
        console.warn(`[conloca:render] <${tree.component}> failed:`, err instanceof Error ? err.message : err);
        rendered = renderErrorStub(tree, err);
      }

      // Wrap top-level output in a host-marker parent (`.sl-markdown-content`)
      // with `(documentIndex - 1)` hidden phantom siblings so root-level
      // components match the live page's `:nth-child(N)` position. See
      // earlier commit for the rationale (Starlight Card cycle).
      //
      // Inline (text-kind) requests skip the wrapper entirely: the
      // rendered HTML is destined for inline text flow (eg an Icon's
      // `<svg>` inside a paragraph), where a block wrapper would force
      // a line break and phantom siblings make no sense (the node
      // isn't a root flow child).
      let html: string;
      if (body.inline) {
        html = rendered;
      } else {
        const documentIndex = body.documentIndex;
        const phantomCount = typeof documentIndex === 'number' && documentIndex > 0 ? documentIndex - 1 : 0;
        const phantoms = phantomCount > 0 ? '<span hidden aria-hidden="true"></span>'.repeat(phantomCount) : '';
        html = `<div class="sl-markdown-content">${phantoms}${rendered}</div>`;
      }

      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(html);
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('content-type', 'text/plain');
      res.end(`Render failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}

interface RenderTreeNode {
  component: string;
  source: string;
  defaultExport?: boolean;
  props?: Record<string, unknown>;
  slotId: string;
  /** HTML-escaped text fallback for leaf body. Shown when no editor
   * is portaled into the slot (eg inside container-rendered children
   * before Phase 3 inline editing lands). */
  body?: string;
  /** Raw HTML that REPLACES the conloca-slot wrapper. Used for
   * components whose Astro implementation validates the slot element
   * type (Starlight's `<Steps>` requires `<ol>`, `<FileTree>` requires
   * `<ul>`) — wrapping in `<conloca-slot>` makes the Container API
   * render call throw. With `bodyHtml`, the validator sees the real
   * element. No inline editing possible until per-position slot
   * markers are added inside the rendered list. */
  bodyHtml?: string;
  children?: RenderTreeNode[];
  /** Named-slot HTML keyed by slot name. Passed as additional slots
   * to `container.renderToString`. Source MDX uses
   * `<Fragment slot="...">…</Fragment>` to declare them. */
  namedSlots?: Record<string, string>;
}

interface RequestBody {
  // New shape
  tree?: RenderTreeNode;
  // Legacy shape (one component, no children)
  component?: string;
  source?: string;
  defaultExport?: boolean;
  props?: Record<string, unknown>;
  // Top-level wrapping
  documentIndex?: number;
  /** When true, suppress the `<div class="sl-markdown-content">` wrapper
   * and phantom siblings — the rendered HTML is destined for inline
   * text flow (eg `<Icon>`), where a block wrapper would force a line
   * break and phantom siblings make no sense (the node isn't a root
   * flow child). */
  inline?: boolean;
}

async function renderTree(
  node: RenderTreeNode,
  container: experimental_AstroContainer,
  server: SsrModuleLoader,
): Promise<string> {
  const module = (await server.ssrLoadModule(node.source)) as Record<string, unknown>;
  const exportKey = node.defaultExport ? 'default' : node.component;
  const factory = module[exportKey];

  if (typeof factory !== 'function') {
    throw new Error(`Component '${node.component}' not found at '${node.source}' (export '${exportKey}')`);
  }

  // Slot content priority:
  //   1. `children` (recursive tree)    — pure-JSX container case.
  //   2. `bodyHtml`                     — raw HTML emitted as-is, no
  //                                       conloca-slot wrapper. For
  //                                       components whose Astro
  //                                       implementation validates the
  //                                       slot's element type.
  //   3. `<conloca-slot data-slot-id>{body}</conloca-slot>`
  //                                     — default path for everything
  //                                       else. The slot marker is the
  //                                       portal target; `body` is the
  //                                       static text fallback shown
  //                                       when no portal is mounted.
  let slotContent: string;
  if (node.children && node.children.length > 0) {
    // Per-child error isolation: one broken `<Card>` no longer blanks
    // its sibling Cards. A failure to render any specific child
    // becomes an inline error stub (carrying that child's slot id so
    // the body editor still portals into it), and the parent goes on
    // to render with the stub HTML in that child's position.
    const renderedChildren = await Promise.all(
      node.children.map(async (child) => {
        try {
          return await renderTree(child, container, server);
        } catch (err) {
          // Log to the dev console so the failure isn't entirely
          // invisible — the inline stub is the author's surface, but
          // a dev tailing the terminal still wants the stack trace.
          console.warn(`[conloca:render] <${child.component}> failed:`, err instanceof Error ? err.message : err);
          return renderErrorStub(child, err);
        }
      }),
    );
    slotContent = renderedChildren.join('');
  } else if (node.bodyHtml) {
    slotContent = node.bodyHtml;
  } else {
    const fallback = node.body ?? '';
    slotContent = `<conloca-slot data-slot-id="${escapeHtml(node.slotId)}">${fallback}</conloca-slot>`;
  }

  // Named slots (Astro's `<Fragment slot="header">` pattern) are
  // passed alongside `default`. The client extracts them from mdast
  // and ships each as an HTML string keyed by slot name.
  const slots: Record<string, string> = { default: slotContent, ...(node.namedSlots ?? {}) };

  return container.renderToString(factory as Parameters<experimental_AstroContainer['renderToString']>[0], {
    props: node.props,
    slots,
    // Frameworks (Starlight, others) read content via `Astro.locals.t(...)`
    // set by their middleware. The bare container has none, so we
    // pass a fallback: strip namespace, capitalize the leaf
    // ('asides.note' → 'Note'). Real titles/body come from props.
    locals: { t: defaultI18nFallback } as App.Locals,
  });
}

/**
 * Build a self-contained, editable error stub for one render failure.
 *
 * Three jobs:
 *   1. Surface the error inline so the author sees *exactly* which
 *      component blew up and why, right where it sits in the document.
 *      No console-spelunking required.
 *   2. Keep the slot id intact so GenericBlock's portal-discovery loop
 *      (`querySelectorAll('conloca-slot[data-slot-id]')`) still finds a
 *      mount point inside the stub. The body editor mounts as normal;
 *      the author can edit the children even though the parent
 *      component's own render failed — typically that's enough to fix
 *      whatever the validator was upset about.
 *   3. Stay structurally innocuous. A `<div>` wrapper renders cleanly
 *      inside any parent slot that accepts arbitrary HTML, and a
 *      data-attribute on the wrapper lets host CSS style it however
 *      they like (yellow background, red border, whatever).
 *
 * Note: if the parent component itself has a strict-slot validator
 * (eg `<Tabs>` rejects non-TabItem children), the stub will fail the
 * parent's render too — but the recursion at the parent level then
 * catches THAT failure and emits its own stub one level up. The
 * worst case bubbles all the way to the top-level wrap in the
 * endpoint handler. Errors never escape as 500s.
 */
function renderErrorStub(node: RenderTreeNode, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const name = node.component || 'unknown';
  return (
    `<div class="conloca-render-error" data-component="${escapeHtml(name)}" data-slot-id="${escapeHtml(node.slotId)}" role="alert">` +
    `<div class="conloca-render-error__label">&lt;${escapeHtml(name)}&gt; failed to render: ${escapeHtml(message)}</div>` +
    `<conloca-slot data-slot-id="${escapeHtml(node.slotId)}"></conloca-slot>` +
    '</div>'
  );
}

function collectDisallowedSources(node: RenderTreeNode, allowed: Set<string>): string[] {
  const bad: string[] = [];
  if (!allowed.has(node.source)) bad.push(node.source);
  if (node.children) {
    for (const child of node.children) bad.push(...collectDisallowedSources(child, allowed));
  }
  return bad;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function defaultI18nFallback(key: string): string {
  const leaf = key.split('.').pop() ?? key;
  return leaf.charAt(0).toUpperCase() + leaf.slice(1);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}
