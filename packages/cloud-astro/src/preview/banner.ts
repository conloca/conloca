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
export function getBannerScriptText(
  ctx: Pick<PreviewContext, 'branch' | 'grant'>,
  endpoint?: string,
  exitPath?: string,
  shareUrl?: string,
  pagePath?: string,
): string {
  // Serialize then patch the `<` character that JSON.stringify does NOT
  // escape. Browsers terminate inline scripts on `</script>` regardless of
  // string-literal context, so a branch name containing `</script>` would
  // break out of the script tag. Replacing `</` with `<\/` is the standard
  // mitigation (also done by ASP.NET's Json.Encode, Rails' j helper, etc.).
  //
  // Only the branch name and public addresses reach the page, never the pass:
  // every script on the page, third-party tags included, could read it. A
  // share viewer gets who shared the draft and when the link expires instead
  // of the editor links. `undefined` values drop out of the JSON.
  const embedded =
    ctx.grant === undefined
      ? { branch: ctx.branch, endpoint, exitPath, shareUrl, path: pagePath }
      : {
          branch: ctx.branch,
          exitPath,
          path: pagePath,
          viewer: { sharedBy: ctx.grant.sharedBy, expiresAt: ctx.grant.expiresAt },
        };
  const ctxJson = JSON.stringify(embedded).replace(/</g, '\\u003c');
  return [
    `var __conlocaPreview = ${ctxJson};`,
    "var __conlocaCollapseKey = 'conloca.preview.collapsed';",
    "var __conlocaIsCollapsed = function () { try { return localStorage.getItem(__conlocaCollapseKey) === '1'; } catch (e) { return false; } };",
    "var __conlocaSetCollapsed = function (v) { try { localStorage.setItem(__conlocaCollapseKey, v ? '1' : '0'); } catch (e) {} };",
    'var __conlocaRender = function () {',
    "  var host = document.createElement('div');",
    "  host.id = 'conloca-preview-banner';",
    "  host.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;font-family:system-ui,sans-serif;background:#111;color:#fff;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.35);padding:8px 12px;font-size:13px;display:flex;gap:12px;align-items:center;';",
    "  var label = document.createElement('span');",
    '  if (__conlocaPreview.viewer) {',
    '    var days = Math.max(1, Math.ceil((__conlocaPreview.viewer.expiresAt * 1000 - Date.now()) / 86400000));',
    "    label.textContent = 'Draft: ' + __conlocaPreview.branch + (__conlocaPreview.viewer.sharedBy ? ' · Shared by ' + __conlocaPreview.viewer.sharedBy : '') + ' · Expires in ' + days + (days === 1 ? ' day' : ' days');",
    "  } else { label.textContent = 'Preview: ' + __conlocaPreview.branch; }",
    '  host.appendChild(label);',
    // "Edit" reuses the landing page's `/login?return=` contract:
    // the endpoint's login route already knows how to send an authenticated
    // session into the editor for the requested page.
    "  var edit = document.createElement('a'); edit.textContent = 'Edit'; edit.style.color = '#9cf';",
    "  if (__conlocaPreview.endpoint) { edit.href = __conlocaPreview.endpoint + '/login?return=' + encodeURIComponent(__conlocaPreview.path || location.pathname); host.appendChild(edit); }",
    // Share opens the editor's share dialog for this page in a new tab.
    "  if (__conlocaPreview.shareUrl) { var share = document.createElement('a'); share.textContent = 'Share'; share.style.color = '#9cf'; share.href = __conlocaPreview.shareUrl; share.target = '_blank'; share.rel = 'noopener'; host.appendChild(share); }",
    // "Exit Preview" must round-trip the server: the cookie is HttpOnly, so
    // only a Set-Cookie response can expire it. `to` returns the visitor to
    // this page, now published.
    "  var exitLink = document.createElement('a'); exitLink.textContent = 'Exit Preview'; exitLink.style.color = '#9cf';",
    "  if (__conlocaPreview.exitPath) { exitLink.href = __conlocaPreview.exitPath + '?to=' + encodeURIComponent(__conlocaPreview.path || location.pathname); host.appendChild(exitLink); }",
    "  var collapse = document.createElement('button'); collapse.type = 'button'; collapse.textContent = __conlocaIsCollapsed() ? '+' : '-'; collapse.style.cssText = 'background:transparent;color:#fff;border:none;cursor:pointer;font-size:16px;line-height:1;'; host.appendChild(collapse);",
    "  collapse.addEventListener('click', function () { var c = !__conlocaIsCollapsed(); __conlocaSetCollapsed(c); host.style.display = c ? 'none' : ''; });",
    "  if (__conlocaIsCollapsed()) host.style.display = 'none';",
    '  document.body.appendChild(host);',
    '};',
    "if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', __conlocaRender); } else { __conlocaRender(); }",
  ].join(' ');
}

const ROBOTS_META = '<meta name="robots" content="noindex, nofollow">';
// Any `<meta name=robots …>`, whatever the case, quoting or attribute order; `robots-extra` and `googlebot` are other names.
const SITE_ROBOTS_META_RE = /<meta\b[^>]*?\sname\s*=\s*["']?robots(?=["'\s/>])[^>]*>/giu;

/**
 * Returns `html` with the preview banner script (or, on a share pass, the
 * viewer banner) injected before the closing `</body>` tag, and the page's robots metas replaced by one
 * `<meta robots noindex>`. The site's own robots meta (often
 * `index, follow`) must not sit next to the preview's. Ours takes the first
 * one's place, or goes before `</body>` when the page has none.
 *
 * The `</body>` injection uses `String.prototype.replace` with a string
 * argument (not a regex), so only the FIRST `</body>` match is rewritten.
 * That matters because a misconfigured renderer can emit malformed HTML with
 * multiple `</body>` tags; we never want to inject the banner more than once
 * per response.
 */
export function injectPreviewBanner(
  html: string,
  ctx: Pick<PreviewContext, 'branch' | 'grant'>,
  endpoint?: string,
  exitPath?: string,
  shareUrl?: string,
  pagePath?: string,
): string {
  const script = `<script>${getBannerScriptText(ctx, endpoint, exitPath, shareUrl, pagePath)}</script>`;
  let replaced = false;
  const page = html.replace(SITE_ROBOTS_META_RE, () => {
    const first = !replaced;
    replaced = true;
    return first ? ROBOTS_META : '';
  });
  return page.replace('</body>', `${replaced ? '' : ROBOTS_META}${script}</body>`);
}
