import { buildSandboxSrcdoc, MDX_SANDBOX_FRAME_POLICY } from '@conloca/mdx/sandbox-frame';
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
 * (`MDX_SANDBOX_FRAME_POLICY`); any other server of the frame must match them,
 * including the 403 for anything but an iframe load.
 *
 * No auth gate: the document is static boilerplate — content only ever enters
 * the frame via postMessage from the editor.
 */

export const prerender = false;

/** The frame route's answer to a request with these headers. */
export function sandboxFrameResponse(request: Pick<Request, 'headers'>): Response {
  if (request.headers.get('sec-fetch-dest') !== 'iframe') {
    return new Response('The MDX preview frame loads only inside an editor frame.', {
      status: 403,
      headers: { 'cache-control': 'no-store' },
    });
  }
  return new Response(buildSandboxSrcdoc(), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': MDX_SANDBOX_FRAME_POLICY,
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    },
  });
}

export const GET: APIRoute = ({ request }) => sandboxFrameResponse(request);
