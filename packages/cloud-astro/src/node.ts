// Node-only build-hook entry for `@conloca/cloud-astro`. The site wires
// the integration into `astro.config.mjs` via this subpath.

export { conlocaCloud, PACKAGE_NAME, PREVIEW_BUILD_ENV_FLAG } from './integration.js';
export type { ConlocaCloudOptions, PreviewBuildOptions } from './types.js';
