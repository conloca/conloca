import { createContentAPIRouter, FileSystemContentAPI } from '@conloca/content-api/node';
import type { APIRoute } from 'astro';

// Create a single handler for all content API routes
export const ALL: APIRoute = async ({ request, params }) => {
  const contentRoot = import.meta.env.CONLOCA_CONTENT_ROOT || './content';
  const canvasDir = import.meta.env.CONLOCA_CANVAS_DIR || './canvas';

  // FileSystemContentAPI.create() handles caching internally
  const contentApi = await FileSystemContentAPI.create({ contentRoot, canvasDir });

  // Create the Hono router
  const app = createContentAPIRouter(contentApi);

  // Extract the path after the API base
  const url = new URL(request.url);
  // Find where /api/ appears in the pathname
  const apiIndex = url.pathname.indexOf('/api/');
  if (apiIndex === -1) {
    return new Response('Invalid API path', { status: 400 });
  }
  const basePath = url.pathname.substring(0, apiIndex + 4); // Include '/api'
  const path = url.pathname.substring(basePath.length) || '/';

  // Create a new request with the correct path for Hono
  const honoRequest = new Request(new URL(path + url.search, 'http://localhost').href, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    // Required for Node.js when sending a body
    ...(request.body && { duplex: 'half' as any }),
  });

  // Let Hono handle the request
  const response = await app.fetch(honoRequest);

  // Return the Hono response
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};
