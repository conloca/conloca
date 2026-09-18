// Public surface for `@conloca/cloud-astro` — the site's Astro
// integration. The build pipeline (editor-bundle compile + registration POST)
// runs from `astro:build:done`; the preview modules serve draft pages out of
// the recursive preview build and read their content through
// `PreviewContentAPI`.

export { conlocaCloud, PACKAGE_NAME, PREVIEW_BUILD_ENV_FLAG } from './integration.js';
export type { ConlocaCloudOptions, PreviewBuildOptions } from './types.js';
