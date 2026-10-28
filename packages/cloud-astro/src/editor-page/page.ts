import { createHash } from 'node:crypto';
import {
  EDITOR_HOST_PROTOCOL,
  EDITOR_UI_MODULE_FILES,
  type EditorHostPageData,
} from '@conloca/content-api/editor-host';

/**
 * The editor page's `index.html`: the editor UI from `<editorUiOrigin>/host/v<protocol>/`, its `importmap` script, and
 * the page data as a JSON block that never executes. The meta CSP admits scripts only from the page itself, that path
 * and the `importmap` script's hash; it leaves styles and fonts alone, so the editor UI's stylesheet may load its web
 * font.
 */
export function renderEditorPage(data: EditorHostPageData, editorUiOrigin: string): string {
  const uiPath = `${editorUiOrigin}/host/v${EDITOR_HOST_PROTOCOL}/`;
  const imports = Object.fromEntries(
    Object.entries(EDITOR_UI_MODULE_FILES).map(([specifier, file]) => [specifier, `${uiPath}${file}`]),
  );
  const importMapJson = JSON.stringify({ imports });
  const importMapHash = createHash('sha256').update(importMapJson).digest('base64');
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="robots" content="noindex, nofollow">',
    `<meta http-equiv="Content-Security-Policy" content="script-src 'self' ${uiPath} 'sha256-${importMapHash}'; object-src 'none'; base-uri 'none'">`,
    '<title>Conloca editor</title>',
    `<script type="importmap">${importMapJson}</script>`,
    // `<` escaped so no value can close the element; JSON.parse reads `\u003c` back as `<`.
    `<script type="application/json" id="conloca-editor-host">${JSON.stringify(data).replaceAll('<', '\\u003c')}</script>`,
    `<script type="module" src="${uiPath}entry.js"></script>`,
    '</head>',
    '<body><div id="root"></div></body>',
    '</html>',
  ].join('\n');
}
