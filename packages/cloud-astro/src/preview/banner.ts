import type { PreviewContext } from './middleware.js';

/**
 * Returns the body of the script tag that renders the floating preview
 * banner inside the rendered page. Exported separately so the script
 * source can be unit-tested without parsing surrounding HTML.
 *
 * The script is intentionally framework-free vanilla JS: it has to run
 * inside whatever HTML the site's Astro renderer produced, with no
 * assumption about React/preact/svelte runtime presence. The collapse-state
 * persistence uses localStorage with a fixed key so opening multiple
 * previews on the same origin gives a consistent UX.
 *
 * The preview context is embedded as a JSON literal — `JSON.stringify`
 * encodes both `"` and `</script>` sequences safely, which is the
 * canonical way to embed server data in a same-origin inline script.
 */
export function getBannerScriptText(ctx: PreviewContext, endpoint?: string, exitPath?: string): string {
  // Serialize then patch the `<` character that JSON.stringify does NOT
  // escape. Browsers terminate inline scripts on `</script>` regardless of
  // string-literal context, so a branch name containing `</script>` would
  // break out of the script tag. Replacing `</` with `<\/` is the standard
  // mitigation (also done by ASP.NET's Json.Encode, Rails' j helper, etc.).
  //
  // The endpoint rides the envelope alongside the preview ctx so the
  // "Share Preview" button can call `GET {endpoint}/preview/share` from the
  // browser with the preview JWT (the same credential the cookie carries; the
  // cookie is HttpOnly, so the button reads the JWT from here). Absent an
  // endpoint the button is inert. `endpoint: undefined` drops out of the JSON.
  //
  // `exitPath` is the server-side exit route, the fixed public
  // `<base>/_conloca/preview/__exit`; it reveals nothing.
  const ctxJson = JSON.stringify({ ...ctx, endpoint, exitPath }).replace(/</g, '\\u003c');
  return [
    `var __conlocaPreview = ${ctxJson};`,
    "var __conlocaCollapseKey = 'conloca.preview.collapsed';",
    "var __conlocaIsCollapsed = function () { try { return localStorage.getItem(__conlocaCollapseKey) === '1'; } catch (e) { return false; } };",
    "var __conlocaSetCollapsed = function (v) { try { localStorage.setItem(__conlocaCollapseKey, v ? '1' : '0'); } catch (e) {} };",
    'var __conlocaRender = function () {',
    "  var host = document.createElement('div');",
    "  host.id = 'conloca-preview-banner';",
    "  host.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;font-family:system-ui,sans-serif;background:#111;color:#fff;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.35);padding:8px 12px;font-size:13px;display:flex;gap:12px;align-items:center;';",
    "  var label = document.createElement('span'); label.textContent = 'Preview: ' + __conlocaPreview.branch; host.appendChild(label);",
    // "Edit" reuses the landing page's `/login?return=` contract:
    // the endpoint's login route already knows how to send an authenticated
    // session into the editor for the requested page.
    "  var edit = document.createElement('a'); edit.textContent = 'Edit'; edit.style.color = '#9cf';",
    "  if (__conlocaPreview.endpoint) { edit.href = __conlocaPreview.endpoint + '/login?return=' + encodeURIComponent(location.pathname); host.appendChild(edit); }",
    // "Exit Preview" must round-trip the server: the cookie is HttpOnly, so
    // only a Set-Cookie response can expire it. `to` returns the visitor to
    // this page, now published.
    "  var exitLink = document.createElement('a'); exitLink.textContent = 'Exit Preview'; exitLink.style.color = '#9cf';",
    "  if (__conlocaPreview.exitPath) { exitLink.href = __conlocaPreview.exitPath + '?to=' + encodeURIComponent(location.pathname); host.appendChild(exitLink); }",
    "  var share = document.createElement('button'); share.type = 'button'; share.textContent = 'Share Preview'; share.style.cssText = 'background:#333;color:#fff;border:1px solid #555;border-radius:4px;padding:2px 8px;cursor:pointer;'; host.appendChild(share);",
    // "Share Preview": mint a fresh shareable link via GET {endpoint}/preview/share
    // and copy it to the clipboard. Bearer-authenticated with the preview JWT
    // (the route reads Authorization/?token=, never the HttpOnly cookie). The
    // button briefly reflects the outcome, then restores.
    "  share.addEventListener('click', function () {",
    '    if (!__conlocaPreview.endpoint) return;',
    "    var shareUrl = __conlocaPreview.endpoint + '/preview/share?branch=' + encodeURIComponent(__conlocaPreview.branch);",
    '    var previousLabel = share.textContent;',
    '    share.disabled = true;',
    "    fetch(shareUrl, { headers: { authorization: 'Bearer ' + __conlocaPreview.jwt } })",
    "      .then(function (res) { if (!res.ok) throw new Error('share ' + res.status); return res.json(); })",
    "      .then(function (data) { if (!data || typeof data.url !== 'string') throw new Error('missing url'); return navigator.clipboard.writeText(data.url); })",
    "      .then(function () { share.textContent = 'Link copied'; })",
    "      .catch(function () { share.textContent = 'Copy failed'; })",
    '      .then(function () { setTimeout(function () { share.textContent = previousLabel; share.disabled = false; }, 2000); });',
    '  });',
    "  var collapse = document.createElement('button'); collapse.type = 'button'; collapse.textContent = __conlocaIsCollapsed() ? '+' : '-'; collapse.style.cssText = 'background:transparent;color:#fff;border:none;cursor:pointer;font-size:16px;line-height:1;'; host.appendChild(collapse);",
    "  collapse.addEventListener('click', function () { var c = !__conlocaIsCollapsed(); __conlocaSetCollapsed(c); host.style.display = c ? 'none' : ''; });",
    "  if (__conlocaIsCollapsed()) host.style.display = 'none';",
    '  document.body.appendChild(host);',
    '};',
    "if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', __conlocaRender); } else { __conlocaRender(); }",
  ].join(' ');
}

/**
 * Returns `html` with the preview banner script and `<meta robots noindex>`
 * tag injected before the closing `</body>` tag.
 *
 * The injection uses `String.prototype.replace` with a string argument
 * (not a regex), so only the FIRST `</body>` match is rewritten. That
 * matters because a misconfigured renderer can emit malformed HTML with
 * multiple `</body>` tags; we never want to inject the banner more than
 * once per response.
 */
export function injectPreviewBanner(html: string, ctx: PreviewContext, endpoint?: string, exitPath?: string): string {
  const robotsMeta = '<meta name="robots" content="noindex, nofollow">';
  const script = `<script>${getBannerScriptText(ctx, endpoint, exitPath)}</script>`;
  return html.replace('</body>', `${robotsMeta + script}</body>`);
}
