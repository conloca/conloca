import { createContentAPIRouter, FileSystemContentAPI, validateCFAccessRequest } from '@conloca/content-api/node';
import type { APIRoute } from 'astro';

// Create a single handler for all content API routes
export const ALL: APIRoute = async ({ request }) => {
  // Validate CF Access
  const cfResult = await validateCFAccessRequest(request);

  if (!cfResult.valid && cfResult.required) {
    return new Response(
      JSON.stringify({
        error: { code: 'UNAUTHORIZED', message: 'CF Access required' },
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  const contentRoot = import.meta.env.CONLOCA_CONTENT_ROOT || './content';
  const canvasDir = import.meta.env.CONLOCA_CANVAS_DIR || './canvas';

  // FileSystemContentAPI.create() handles caching internally
  const contentApi = await FileSystemContentAPI.create({ contentRoot, canvasDir });

  // Create the Hono router with optional assets support
  const assetsPath = import.meta.env.CONLOCA_ASSETS_PATH || '';
  const app = createContentAPIRouter(contentApi, assetsPath ? { assetsPath } : undefined);

  // Extract the path after the API base
  const url = new URL(request.url);
  // Find where /api/ appears in the pathname
  const apiIndex = url.pathname.indexOf('/api/');
  if (apiIndex === -1) {
    return new Response('Invalid API path', { status: 400 });
  }
  const basePath = url.pathname.substring(0, apiIndex + 4); // Include '/api'
  const path = url.pathname.substring(basePath.length) || '/';

  // Pass user to Hono via headers for downstream use
  const headers = new Headers(request.headers);
  if (cfResult.user) {
    headers.set('X-CF-User-Email', cfResult.user.email);
    headers.set('X-CF-User-Sub', cfResult.user.sub);
  }

  // Create a new request with the correct path for Hono
  // Note: duplex option is required for Node.js fetch when sending a body
  // but not in the TypeScript RequestInit type
  const honoRequest = new Request(new URL(path + url.search, 'http://localhost').href, {
    method: request.method,
    headers,
    body: request.body,
    ...(request.body && { duplex: 'half' }),
  } as RequestInit);

  // Let Hono handle the request
  const response = await app.fetch(honoRequest);

  // Return the Hono response
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};
