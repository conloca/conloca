// Node-only build-hook entry for `@conloca/cloud-astro`. The site wires
// the integration into `astro.config.mjs` via this subpath; every build
// writes your site's editor page to /_conloca/editor/.

export {
  DEFAULT_EDITOR_ENDPOINT,
  EDITOR_HOST_PROTOCOL,
  EDITOR_PAGE_PATH,
  type EditorHostPageData,
  type EditorPageInfo,
} from '@conloca/content-api/editor-host';
// The adapter releases and host rate-limit lines connect and doctor share.
export { D8_TESTED_ADAPTERS, d8RateLimitLines } from './d8-adapters.js';
// The d8 config-text refusals `conloca connect` checks before it writes an adapter's options.
export { d8ConfigRefusal, d8EdgeRefusal } from './d8-guards.js';
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
