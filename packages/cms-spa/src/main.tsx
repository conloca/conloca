/**
 * SPA boot router.
 *
 * One served entry, two startup paths. When the document is the top
 * window the full CMS SPA boots; when the document is hosted inside
 * an `EditorFrame` iframe (marked via `frameElement.dataset.conlocaEditorFrame`)
 * only the MDX editor surface boots. The parent shell — toolbar,
 * routing, side panel, save state — stays in the outer window.
 *
 * Dynamic imports gate the two trees so the iframe mode never pulls
 * the full App / router / Puck / Tailwind admin chrome into memory,
 * and the SPA mode never pulls the editor-only boot.
 */

function isEditorFrame(): boolean {
  if (typeof window === 'undefined') return false;
  const frame = window.frameElement;
  // Don't use `instanceof HTMLElement` here: the frame element is
  // constructed in the parent window, so `iframeRealm.HTMLElement` is
  // a different constructor and the check always returns false. Read
  // the dataset directly through optional chaining; the parent set
  // `data-conloca-editor-frame="1"` so we just look for that string.
  return (frame as HTMLElement | null)?.dataset?.conlocaEditorFrame === '1';
}

if (isEditorFrame()) {
  import('./main-editor').then((m) => m.mountEditorFrame());
} else {
  import('./main-spa').then((m) => m.mountSpa());
}

// Keep TypeScript treating this file as a module so other `declare global`
// blocks in the package (eg `editor-frame-bridge.ts`) merge correctly.
export {};
