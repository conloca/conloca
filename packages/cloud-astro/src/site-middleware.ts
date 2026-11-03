/**
 * Astro middleware entrypoint for the recursive preview build.
 *
 * `addMiddleware({ entrypoint: '@conloca/cloud-astro/site-middleware' })` in
 * the integration resolves to this module, so it must export `onRequest` —
 * Astro's middleware contract. The verdict/render logic lives in
 * `./preview/site-middleware.ts`, which is env-free and unit-testable; this
 * file binds it to the runtime env resolution and to the render seams built
 * from the site's own build graph (`./preview-render-seams.ts`).
 *
 * Mounted ONLY inside the preview build (see `integration.ts`), never in the
 * site's production build.
 */

import baked from 'virtual:conloca-preview-opts';
import { resolveFromBaked } from './preview/_resolve-opts.js';
import {
  createPreviewSiteMiddleware,
  type PreviewMiddlewareContext,
  type PreviewMiddlewareNext,
} from './preview/site-middleware.js';
import { untagWorkerdProcess } from './preview/workerd-shim.js';
import { previewRenderSeams } from './preview-render-seams.js';

// At Cloudflare Worker start-up, before any render: workerd's nodejs_compat
// process can masquerade as Node's, sending Astro down a streaming branch whose
// body the Cloudflare Workers Response cannot consume — every on-demand page then renders as the
// literal string "[object Object]". See the shim's doc for the full chain.
untagWorkerdProcess();

export async function onRequest(context: PreviewMiddlewareContext, next: PreviewMiddlewareNext): Promise<Response> {
  const handler = createPreviewSiteMiddleware(
    () => resolveFromBaked(baked, (name) => process.env[name]),
    await previewRenderSeams(),
  );
  return handler(context, next);
}
