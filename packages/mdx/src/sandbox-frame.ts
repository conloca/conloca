/**
 * Opaque-origin MDX preview frame document + runtime. Confines the MDX
 * `'unsafe-eval'` to this frame — see `SANDBOX_FRAME_CSP` below.
 * Shared by the cms-spa ContentSandbox and the server route that serves this
 * frame's HTML at `SANDBOX_FRAME_PATH`.
 */

/**
 * Build a jsx runtime that constructs real DOM nodes instead of React
 * elements. The two isolated MDX preview surfaces render markdown-subset MDX
 * with no component map supplied, so intrinsic elements plus `Fragment` cover
 * everything they emit; this keeps the frame dependency-free (no React bundle
 * to inline). Inline event-handler props are dropped defensively.
 */

/** Discriminated messages the frame and its host exchange. */
export interface SandboxRenderMessage {
  __conlocaSandbox: true;
  kind: 'render';
  mode: 'mdx' | 'html';
  /** Compiled MDX function body (mode `mdx`) or sanitized HTML (mode `html`). */
  payload: string;
  /** Optional stylesheet text injected into the frame for preview fidelity. */
  styles?: string;
}

export type SandboxOutboundMessage =
  | { __conlocaSandbox: true; k: string; kind: 'ready' }
  | { __conlocaSandbox: true; k: string; kind: 'height'; px: number }
  | { __conlocaSandbox: true; k: string; kind: 'link'; href: string }
  | { __conlocaSandbox: true; k: string; kind: 'interact' }
  | { __conlocaSandbox: true; k: string; kind: 'rendered' }
  | { __conlocaSandbox: true; k: string; kind: 'error'; message: string };

export function createSandboxRuntime(): {
  Fragment: symbol;
  jsx: (type: unknown, props: Record<string, unknown>) => Node;
  jsxs: (type: unknown, props: Record<string, unknown>) => Node;
  jsxDEV: (type: unknown, props: Record<string, unknown>) => Node;
} {
  // Everything below stays inside this function: the frame receives it as source text.
  const Fragment = Symbol('sandbox.fragment');
  const SVG_NS = 'http://www.w3.org/2000/svg';
  // A child is built before its parent, so an element written inside <svg>
  // starts out as HTML, which a browser does not draw there. The <svg> builds
  // it again as SVG from what each HTML element was made of, kept here, which
  // is the namespace React would have given it.
  const madeOf = new WeakMap<Node, { type: string; props: Record<string, unknown> }>();
  const toNodes = (value: unknown): Node[] => {
    if (value == null || value === true || value === false) return [];
    if (Array.isArray(value)) return value.flatMap(toNodes);
    if (typeof value === 'string' || typeof value === 'number') return [document.createTextNode(String(value))];
    if (value instanceof Node) return [value];
    return [document.createTextNode(String(value))];
  };
  const element = (type: string, p: Record<string, unknown>, inSvg: boolean): Element => {
    const svg = inSvg || type === 'svg';
    const el = svg ? document.createElementNS(SVG_NS, type) : document.createElement(type);
    if (!svg) madeOf.set(el, { type, props: p });
    for (const key in p) {
      if (key === 'children' || key === 'key') continue;
      const value = p[key];
      if (/^on/i.test(key)) continue; // never wire an event handler
      if (key === 'className') {
        el.setAttribute('class', String(value));
      } else if (key === 'htmlFor') {
        el.setAttribute('for', String(value));
      } else if (key === 'style' && value && typeof value === 'object') {
        Object.assign((el as HTMLElement).style, value as Record<string, string>);
      } else if (value === true) {
        el.setAttribute(key, '');
      } else if (value != null && value !== false) {
        el.setAttribute(key, String(value));
      }
    }
    // What a <foreignObject> holds is HTML again, as in a browser.
    const svgChildren = svg && type !== 'foreignObject';
    for (const child of toNodes(p.children)) {
      const source = svgChildren ? madeOf.get(child) : undefined;
      el.appendChild(source ? element(source.type, source.props, true) : child);
    }
    return el;
  };
  const jsx = (type: unknown, props: Record<string, unknown>): Node => {
    const p = props || {};
    if (type === Fragment) {
      const frag = document.createDocumentFragment();
      for (const child of toNodes(p.children)) frag.appendChild(child);
      return frag;
    }
    if (typeof type === 'function') return (type as (props: Record<string, unknown>) => Node)(p);
    if (typeof type === 'string') return element(type, p, false);
    const missing = document.createElement('span');
    missing.setAttribute('data-sandbox-unknown', '');
    return missing;
  };
  return { Fragment, jsx, jsxs: jsx, jsxDEV: jsx };
}

/**
 * Evaluate a pre-compiled MDX function body. This is the `new AsyncFunction`
 * eval that used to run in the privileged parent (`useMDXEvaluation`) — it now
 * runs only here, inside the sandbox, which is why `'unsafe-eval'` is confined
 * to the frame CSP. Returns the module's default export (the MDX component).
 */
export function runCompiledMdx(
  code: string,
  runtime: Record<string, unknown>,
): Promise<{ default?: (props: Record<string, unknown>) => Node }> {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
    body: string,
  ) => (runtime: Record<string, unknown>) => Promise<{ default?: (props: Record<string, unknown>) => Node }>;
  return new AsyncFunction(String(code))(runtime);
}

/**
 * The frame entry point. Wires the message listener, height reporting, and
 * link/interaction interception, then announces readiness. Every dependency
 * arrives as `deps` so the serialized source carries no free identifiers a
 * minifier could rename.
 */
export function sandboxFrameMain(deps: {
  createSandboxRuntime: typeof createSandboxRuntime;
  runCompiledMdx: typeof runCompiledMdx;
}): void {
  const root = document.getElementById('__sandbox_root');
  if (!root) return;
  // Per-instance key from ?k= so the host can accept messages without relying
  // on event.source === iframe.contentWindow (broken for opaque sandboxes in Chromium).
  let frameKey = '';
  try {
    frameKey = new URL(location.href).searchParams.get('k') || '';
  } catch {
    frameKey = '';
  }
  const post = (message: { kind: string; [key: string]: unknown }): void => {
    parent.postMessage({ ...message, k: frameKey, __conlocaSandbox: true as const }, '*');
  };
  let lastHeight = -1;
  const postHeight = (): void => {
    // Child margins (prose p/h1) collapse out of a normal block root, so
    // getBoundingClientRect(root) under-reports. flow-root on the root
    // contains them; also take scrollHeight so a short iframe cannot
    // circularly clamp the measure.
    const px = Math.ceil(
      Math.max(
        root.getBoundingClientRect().height,
        root.scrollHeight,
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
      ),
    );
    if (px !== lastHeight) {
      lastHeight = px;
      post({ __conlocaSandbox: true, kind: 'height', px });
    }
  };

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target as Element | null;
      const anchor = target && 'closest' in target ? target.closest('a') : null;
      if (anchor) {
        event.preventDefault();
        post({ __conlocaSandbox: true, kind: 'link', href: anchor.getAttribute('href') || '' });
      }
    },
    true,
  );
  document.addEventListener('pointerdown', () => post({ __conlocaSandbox: true, kind: 'interact' }), true);

  const applyStyles = (css: string): void => {
    let style = document.getElementById('__sandbox_styles');
    if (!style) {
      style = document.createElement('style');
      style.id = '__sandbox_styles';
      document.head.appendChild(style);
    }
    style.textContent = css;
  };
  const renderMdx = (code: string): void => {
    const runtime = deps.createSandboxRuntime();
    deps
      .runCompiledMdx(code, runtime as unknown as Record<string, unknown>)
      .then((module) => {
        const Component = module?.default;
        root.textContent = '';
        if (typeof Component === 'function') {
          const output = Component({});
          if (output) root.appendChild(output);
        }
        post({ __conlocaSandbox: true, kind: 'rendered' });
        postHeight();
      })
      .catch((error: unknown) => {
        post({
          __conlocaSandbox: true,
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      });
  };
  const renderHtml = (html: string): void => {
    // Already allowlist-sanitized by the host; the sandbox contains anything
    // that slips through (opaque origin, no privileged globals, strict CSP).
    root.innerHTML = html;
    post({ __conlocaSandbox: true, kind: 'rendered' });
    postHeight();
  };

  window.addEventListener('message', (event) => {
    // Brand + kind only. Requiring event.source === parent drops legitimate
    // host posts under some nested/opaque-origin Chromium cases.
    const data = event.data as SandboxRenderMessage | undefined;
    if (data?.__conlocaSandbox !== true || data.kind !== 'render') return;
    if (typeof data.styles === 'string') applyStyles(data.styles);
    try {
      if (data.mode === 'mdx') renderMdx(data.payload);
      else renderHtml(data.payload);
    } catch (error: unknown) {
      post({ __conlocaSandbox: true, kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  });

  const ResizeObs = (
    window as unknown as { ResizeObserver?: new (cb: () => void) => { observe: (el: Element) => void } }
  ).ResizeObserver;
  if (ResizeObs) new ResizeObs(postHeight).observe(root);
  post({ __conlocaSandbox: true, kind: 'ready' });
}

/**
 * The frame's own Content-Security-Policy. `'unsafe-eval'` is intentional and
 * confined here (the MDX eval lives in the frame). What it does and does NOT
 * close, stated precisely:
 *   - The isolation that HOLDS: no `allow-same-origin` gives the frame an opaque
 *     origin, so it exposes no cookies, no privileged globals, and no
 *     `window.parent` — nothing privileged is reachable to exfiltrate.
 *   - Structured-data egress is closed: with no `connect-src`, `fetch`/XHR/
 *     WebSocket/`sendBeacon` cannot post data out.
 *   - Metadata-only leak channels REMAIN OPEN and are an accepted residual risk.
 *     A hostile preview script can still leak the previewing admin's IP/UA/timing
 *     (plus author-encoded data) to an external host two ways: (a) passive
 *     img/font GETs to `https:` (`img-src`/`font-src`, which `connect-src` does
 *     not govern — kept for remote-image/`@font-face` fidelity, CSP-toggleable
 *     below); and (b) self-navigation — `location.href`/`location.replace` or a
 *     `<meta http-equiv=refresh>` — which is inherent to `allow-scripts` and NOT
 *     closeable by CSP (`navigate-to` is unsupported in browsers) or the sandbox
 *     flags (same-frame navigation is always allowed), short of dropping
 *     `allow-scripts` and the interactive preview with it.
 * Owner toggle: replacing `https:` with just `data: blob:` in `img-src`/`font-src`
 * below closes (a) at a remote-image/-font fidelity cost — but not (b), which has
 * no CSP mitigation. Both leak only request metadata, never privileged content.
 */
export const SANDBOX_FRAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: https: blob:; font-src data: https:";

/**
 * esbuild-style bundlers inject `/* @__PURE__ *\/ __name(fn, "id")` around
 * function expressions when keepNames is on. That helper exists in the bundle
 * scope but NOT inside the iframe document after Function#toString() copy.
 * Provide a no-op so the serialized bootstrap can run in isolation.
 */
const SANDBOX_BUNDLE_HELPERS = 'var __name=function(fn){return fn};';

/**
 * Assemble the sandbox frame document. The runtime functions are injected as
 * argument expressions to `sandboxFrameMain` so no cross-function identifier
 * has to survive minification by name.
 *
 * The editor loads this from `GET /api/v1/mdx/sandbox-frame` (own response CSP
 * with unsafe-eval). Do NOT use srcdoc/blob from the parent document: those
 * inherit the parent CSP, which forbids unsafe-inline/unsafe-eval and leaves
 * MDX fragment previews as empty white boxes.
 */
export function buildSandboxSrcdoc(): string {
  const bootstrap = `${SANDBOX_BUNDLE_HELPERS}(${sandboxFrameMain.toString()})({createSandboxRuntime:${createSandboxRuntime.toString()},runCompiledMdx:${runCompiledMdx.toString()}})`;
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_FRAME_CSP}">`,
    '<style>html,body{margin:0;padding:0}#__sandbox_root{box-sizing:border-box;display:flow-root}</style>',
    // `conloca-prose` is the documented scope class for prose surfaces
    // (the MDX editor's contenteditable carries it too). Sites can scope
    // typography to `.conloca-prose <tag>` in their registered styles and
    // it applies inside this sandbox as well as the editor.
    '</head><body><div id="__sandbox_root" class="conloca-prose"></div>',
    `<script>${bootstrap}</script>`,
    '</body></html>',
  ].join('');
}

/** Well-known path where a host serves {@link buildSandboxSrcdoc}. */
export const SANDBOX_FRAME_PATH = '/api/v1/mdx/sandbox-frame';
