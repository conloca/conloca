// Public surface for `@conloca/cloud-astro` — the site's Astro integration.
// Every `astro build` writes your site's editor page to /_conloca/editor/ from
// `astro:build:done`; the preview modules serve draft pages out of the
// recursive preview build and read their content through `PreviewContentAPI`.

export {
  DEFAULT_EDITOR_ENDPOINT,
  EDITOR_HOST_PROTOCOL,
  EDITOR_PAGE_PATH,
  type EditorHostPageData,
  type EditorPageInfo,
} from '@conloca/content-api/editor-host';
// The /_conloca/editor/ header rules that `conloca connect` writes and doctor checks.
export {
  type FramingBlocker,
  type FramingSnippets,
  findFramingBlockers,
  framingSnippets,
} from './editor-page/framing.js';
// The default export is what `astro add @conloca/cloud-astro` wires in.
export { conlocaCloud as default, conlocaCloud, PACKAGE_NAME, PREVIEW_BUILD_ENV_FLAG } from './integration.js';
export type { ConlocaCloudOptions, PreviewBuildOptions } from './types.js';
