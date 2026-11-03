/**
 * Astro middleware entrypoint for a d8 site: `addMiddleware({ entrypoint: '@conloca/cloud-astro/d8-middleware' })`
 * resolves here, so it exports `onRequest`. No static import of `astro:content`: the draft render (`./d8-render.ts`)
 * loads only when a request needs it, so every other request runs nothing but the prefix check.
 */

import baked from 'virtual:conloca-preview-opts';
import { createD8Middleware } from './preview/d8-middleware.js';
import { untagWorkerdProcess } from './preview/workerd-shim.js';

// Before any render on Cloudflare Workers: see the shim's doc.
untagWorkerdProcess();

export const onRequest = createD8Middleware(baked, {
  loadRender: () => import('./d8-render.js'),
  env: (name) => process.env[name],
});
