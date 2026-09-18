// Public `./preview` subpath for `@conloca/cloud-astro`.
//
// Re-exports the preview-middleware + preview-reader surface that the SSR
// catch-all handler (and any site-supplied request-runtime wrapper)
// consumes. Keeping the implementation behind a `./preview/*` directory lets
// the public subpath stay stable while the internals evolve.

export { getBannerScriptText, injectPreviewBanner } from './preview/banner.js';
export {
  embeddedKey,
  PreviewContentAPI,
  type PreviewContentAPIOptions,
} from './preview/content-api.js';
export { applyPreviewHeaders } from './preview/headers.js';
export { renderNoPreviewLanding } from './preview/landing.js';
export {
  handlePreviewRequest,
  type PreviewContext,
  type PreviewMiddlewareOptions,
  type PreviewVerdict,
  previewParamName,
} from './preview/middleware.js';
