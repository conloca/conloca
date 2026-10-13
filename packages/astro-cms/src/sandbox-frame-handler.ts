import { buildSandboxSrcdoc, SANDBOX_FRAME_CSP } from '@conloca/mdx/sandbox-frame';
import type { APIRoute } from 'astro';

/**
 * GET /api/v1/mdx/sandbox-frame — the opaque-origin iframe document that
 * ContentSandbox loads for MDX fragment previews (canvas chips, fragment
 * editor live preview).
 *
 * The path is root-absolute by contract: `SANDBOX_FRAME_PATH` in
 * `@conloca/mdx` is what the editor requests wherever it runs, so anything
 * that serves the editor must serve this path too. astro-cms routes otherwise
 * live under the cmsRoute prefix, so without this route the frame 404s and
 * chips render the site's 404 page. Response headers are the frame's contract
 * (`SANDBOX_FRAME_CSP`); any other server of the frame must match them.
 *
 * No auth gate: the document is static boilerplate — content only ever enters
 * the frame via postMessage from the editor.
 */

export const prerender = false;

export const GET: APIRoute = () =>
  new Response(buildSandboxSrcdoc(), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': `${SANDBOX_FRAME_CSP}; frame-ancestors 'self'`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    },
  });
