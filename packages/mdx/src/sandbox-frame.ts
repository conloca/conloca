/**
 * Opaque-origin HTML preview frame document + runtime. Renders host-sanitized
 * HTML where it has no origin, cookies or privileged globals of its own.
 * Shared by the cms-spa ContentSandbox and the server route that serves this
 * frame's HTML at `SANDBOX_FRAME_PATH`.
 */

/** Discriminated messages the frame and its host exchange. */
export interface SandboxRenderMessage {
  __conlocaSandbox: true;
  kind: 'render';
  mode: 'html';
  /** Sanitized HTML. */
  payload: string;
  /** Optional stylesheet text injected into the frame for preview fidelity. */
  styles?: string;
  /** Data URLs to show instead of an image the frame cannot load itself, keyed by an element's stored `src`. */
  images?: Record<string, string>;
}

export type SandboxOutboundMessage =
  | { __conlocaSandbox: true; k: string; kind: 'ready' }
  | { __conlocaSandbox: true; k: string; kind: 'height'; px: number }
  | { __conlocaSandbox: true; k: string; kind: 'link'; href: string }
  | { __conlocaSandbox: true; k: string; kind: 'interact' }
  | { __conlocaSandbox: true; k: string; kind: 'rendered' }
  | { __conlocaSandbox: true; k: string; kind: 'error'; message: string };

/**
 * The frame entry point. Wires the message listener, height reporting, and
 * link/interaction interception, then announces readiness. It is serialized
 * into the frame document, so it references nothing outside itself.
 */
export function sandboxFrameMain(): void {
  // Preview content runs only where it has no origin of its own: an opaque origin inside a parent frame.
  if (self.origin !== 'null' || window.parent === window) return;
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

  // oxlint-disable-next-line unicorn/consistent-function-scoping -- serialized whole into the frame, so it stays inside.
  const applyStyles = (css: string): void => {
    let style = document.getElementById('__sandbox_styles');
    if (!style) {
      style = document.createElement('style');
      style.id = '__sandbox_styles';
      document.head.appendChild(style);
    }
    style.textContent = css;
  };
  const renderHtml = (html: string, images: Record<string, string> | undefined): void => {
    // Already allowlist-sanitized by the host; the sandbox contains anything
    // that slips through (opaque origin, no privileged globals, strict CSP).
    // Parsed inert first, so nothing loads before a sent src replaces the stored one.
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    if (images) {
      parsed.querySelectorAll('[src]').forEach((el) => {
        // Inherited keys are never strings, so only a src the host sent is swapped.
        const sent = images[el.getAttribute('src') ?? ''];
        if (typeof sent === 'string') el.setAttribute('src', sent);
      });
    }
    // A leading <style> or <link> lands in the parsed head; keep it with the body, as innerHTML did.
    root.replaceChildren(...Array.from(parsed.head.childNodes), ...Array.from(parsed.body.childNodes));
    post({ __conlocaSandbox: true, kind: 'rendered' });
    postHeight();
  };

  window.addEventListener('message', (event) => {
    // Brand + kind only. Requiring event.source === parent drops legitimate
    // host posts under some nested/opaque-origin Chromium cases.
    const data = event.data as SandboxRenderMessage | undefined;
    // Only HTML renders here; a message in any other mode (an old host's `mdx`) is ignored.
    // oxlint-disable-next-line no-underscore-dangle -- `__conlocaSandbox` is the protocol's message brand.
    if (data?.__conlocaSandbox !== true || data.kind !== 'render' || data.mode !== 'html') return;
    if (typeof data.styles === 'string') applyStyles(data.styles);
    try {
      renderHtml(data.payload, data.images);
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
 * The frame's own Content-Security-Policy. Inline scripts run (the frame's own
 * bootstrap and whatever sanitized HTML slips through), but nothing evals. What it does and does NOT
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
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https: blob:; font-src data: https:";

/**
 * The policy a server sends with the frame document. It adds what a meta
 * policy cannot carry: `sandbox allow-scripts` (an opaque origin even when the
 * document is not loaded by a sandboxed iframe) and `frame-ancestors`.
 */
export const MDX_SANDBOX_FRAME_POLICY = `${SANDBOX_FRAME_CSP}; sandbox allow-scripts; frame-ancestors 'self'`;

/**
 * esbuild-style bundlers inject `/* @__PURE__ *\/ __name(fn, "id")` around
 * function expressions when keepNames is on. That helper exists in the bundle
 * scope but NOT inside the iframe document after Function#toString() copy.
 * Provide a no-op so the serialized bootstrap can run in isolation.
 */
const SANDBOX_BUNDLE_HELPERS = 'var __name=function(fn){return fn};';

/**
 * Assemble the sandbox frame document. `sandboxFrameMain` is serialized whole
 * and called with no arguments, so no identifier has to survive minification by name.
 *
 * The editor loads this from `GET /api/v1/mdx/sandbox-frame` (own response CSP).
 * Do NOT use srcdoc/blob from the parent document: those inherit the parent CSP,
 * which forbids unsafe-inline and leaves previews as empty white boxes.
 */
export function buildSandboxSrcdoc(): string {
  const bootstrap = `${SANDBOX_BUNDLE_HELPERS}(${sandboxFrameMain.toString()})()`;
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
