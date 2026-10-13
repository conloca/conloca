import createDOMPurify from 'dompurify';

/** CSS that fetches a URL or (legacy) executes script. `url()`/`image-set()`
 * beacon an external host; `expression()` ran JS in old IE. DOMPurify allowlists
 * the `style` attribute NAME but never inspects its VALUE, so these survive the
 * sanitize pass and fire from whatever document renders the result — including
 * the privileged editor document. */
const NETWORKING_CSS = /url\s*\(|image-set\s*\(|expression\s*\(/i;

/**
 * Lazily bind DOMPurify to the ambient window. DOMPurify's default export is
 * both an instance and a factory; binding at first call (rather than import)
 * keeps it correct when the DOM isn't present at module-evaluation time (test
 * runners register happy-dom after imports resolve).
 *
 * The instance carries a hook that strips network-triggering CSS from inline
 * `style` values and clamps `iframe` sources to `https:` — both apply to every
 * sanitize call this module makes.
 */
let purify: ReturnType<typeof createDOMPurify> | null = null;
function getPurify(): ReturnType<typeof createDOMPurify> {
  if (!purify) {
    purify = createDOMPurify(window);
    purify.addHook('afterSanitizeAttributes', (node) => {
      const el = node as Element;
      const style = el.getAttribute?.('style');
      if (style && NETWORKING_CSS.test(style)) {
        const cleaned = style
          .split(';')
          .filter((decl) => !NETWORKING_CSS.test(decl))
          .join(';');
        if (cleaned.trim()) el.setAttribute('style', cleaned);
        else el.removeAttribute('style');
      }
      // Embeds are always https:; anything else on an iframe src is dropped.
      // (DOMPurify already blocks javascript:/data: schemes; this additionally
      // drops http: and protocol-relative srcs, leaving only real https embeds.)
      if (el.tagName === 'IFRAME') {
        const src = el.getAttribute?.('src');
        if (src && !/^https:\/\//i.test(src.trim())) el.removeAttribute('src');
      }
    });
  }
  return purify;
}

/**
 * Allowlist-sanitize author-controlled HTML before it reaches any innerHTML /
 * `dangerouslySetInnerHTML` sink in the editor.
 *
 * The editor serializes author-controlled mdast (raw `<div>`/`<details>`
 * tag soup, JSX-written lowercase elements) to HTML and injects it into the
 * privileged admin document. Without sanitization an `<img onerror>`, a
 * `<script>`, a `javascript:` href, or a CSS `url()` beacon would run with the
 * signed-in editor's ambient authority. DOMPurify strips
 * scripts, event-handler attributes, and dangerous URL schemes; the module hook
 * strips CSS `url()` beacons while keeping the benign structural markup authors
 * legitimately write.
 *
 * `conloca-slot` is added to the tag allowlist because the inline-editing
 * machinery portals Lexical editors into `<conloca-slot data-slot-id>`
 * elements in the rendered preview; DOMPurify keeps `data-*` attributes by
 * default, so the slot ids survive.
 */
export function sanitizeHtml(html: string): string {
  return getPurify().sanitize(html, { ADD_TAGS: ['conloca-slot'] });
}

/**
 * Sanitize the render-endpoint RESPONSE before GenericBlock's privileged
 * innerHTML sink. Unlike author input, the response is our OWN registered-
 * component output (VideoEmbed's `<iframe>`, icon `<svg><use>`, …) reacting to
 * already-sanitized author props — so it is structurally generous (keeps the
 * `iframe`/`use` that the strict author allowlist drops) but stays strict on
 * execution and egress: DOMPurify still strips `<script>`, `on*` handlers, and
 * `javascript:`/`data:text/html` URLs, the module hook strips CSS `url()`
 * beacons, and iframe sources are clamped to `https:`.
 */
export function sanitizeComponentHtml(html: string): string {
  return getPurify().sanitize(html, {
    ADD_TAGS: ['conloca-slot', 'iframe', 'use'],
    ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'loading', 'referrerpolicy', 'href', 'xlink:href'],
  });
}
