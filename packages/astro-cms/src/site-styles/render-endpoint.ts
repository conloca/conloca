import { experimental_AstroContainer } from 'astro/container';
import type { Connect, ViteDevServer } from 'vite';

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
export function createRenderEndpoint(server: ViteDevServer): Connect.NextHandleFunction {
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

      const container = await getContainer();
      const rendered = await renderTree(tree, container, server);

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
  server: ViteDevServer,
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
    const renderedChildren = await Promise.all(node.children.map((child) => renderTree(child, container, server)));
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function defaultI18nFallback(key: string): string {
  const leaf = key.split('.').pop() ?? key;
  return leaf.charAt(0).toUpperCase() + leaf.slice(1);
}

async function readJson(req: Connect.IncomingMessage): Promise<unknown> {
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
