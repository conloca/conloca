import { readFile } from 'node:fs/promises';
// Get the path to the cms-spa package by resolving its package.json
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
// Import config from virtual module (injected by plugin-spa.ts)
import spaConfig from 'virtual:conloca-config';
import { validateCFAccessRequest } from '@conloca/content-api/node';
import type { APIRoute } from 'astro';

const require = createRequire(import.meta.url);
const cmsSpaPath = dirname(require.resolve('@conloca/cms-spa/package.json'));

/**
 * Generate HTML for dev mode that loads cms-spa source through Vite.
 * This ensures React is resolved from Vite's pre-bundled deps, not from the cms-spa bundle.
 */
function generateDevHtml(config: typeof spaConfig): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Conloca CMS</title>
  <link rel="stylesheet" href="${config.basename}/main.css" />
  <script>
    // Configure UI with plugin options
    window.__UI_CONFIG__ = ${JSON.stringify(config)};
  </script>
  <script type="module" src="${config.basename}/data-schemas-entry.js"></script>
  <script type="module" src="${config.basename}/puck-entry.js"></script>
  <script type="module" src="${config.basename}/content-listener.js"></script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${config.basename}/cms-spa-entry.js"></script>
</body>
</html>`;
}

// Load the HTML at runtime (production only)
async function loadIndexHtml(): Promise<string> {
  const spaDir = join(cmsSpaPath, 'dist/spa');
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(spaDir);
  const htmlFile = files.find((f) => f.startsWith('index.') && f.endsWith('.html'));

  if (!htmlFile) {
    throw new Error('No index.html found in @conloca/cms-spa dist/spa');
  }

  const htmlPath = join(spaDir, htmlFile);
  const html = await readFile(htmlPath, 'utf-8');

  return html;
}

export const GET: APIRoute = async ({ params, request }) => {
  // Validate CF Access (reads env vars internally)
  const cfResult = await validateCFAccessRequest(request);

  if (!cfResult.valid && cfResult.required) {
    return new Response('Unauthorized - CF Access required', {
      status: 401,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // The path parameter is an array for [...path] routes
  const pathArray = params.path;
  const path = Array.isArray(pathArray) ? pathArray.join('/') : pathArray || '';
  console.log('[spa-handler] Request for path:', path, 'params:', params, 'URL:', request.url);

  // For the root path or any path without an extension, serve the HTML
  if (!path || !path.includes('.')) {
    try {
      let html: string;

      // In dev mode, generate HTML that loads source through Vite
      // In production, load the pre-built HTML from cms-spa dist
      if (import.meta.env.DEV) {
        html = generateDevHtml(spaConfig);
        console.log('[spa-handler] Dev mode: serving generated HTML with virtual module entry');
      } else {
        html = await loadIndexHtml();
        // Inject CMS configuration and load virtual modules
        const configScript = `
        <script>
          // Configure UI with plugin options
          window.__UI_CONFIG__ = ${JSON.stringify(spaConfig)};
        </script>
        <script type="module" src="${spaConfig.basename}/data-schemas-entry.js"></script>
        <script type="module" src="${spaConfig.basename}/puck-entry.js"></script>
        <script type="module" src="${spaConfig.basename}/content-listener.js"></script>
      `;
        // Inject the script at the top to ensure config is available first
        html = html.replace('<head>', `<head>${configScript}`);
      }

      // Log what JS files are referenced in the HTML
      const scriptMatches = html.match(/<script[^>]+src="([^"]+)"/g);
      console.log('[spa-handler] Script tags in HTML:', scriptMatches);

      return new Response(html, {
        headers: {
          'Content-Type': 'text/html',
          'Cache-Control': 'no-store, must-revalidate',
          'X-HMR': 'spa-page',
        },
      });
    } catch (error) {
      console.error('Error loading CMS HTML:', error);
      return new Response('CMS build not found. Run nx build @conloca/astro-cms', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  }

  // For asset requests, serve them from the cms-spa dist/spa directory
  try {
    const assetPath = join(cmsSpaPath, 'dist/spa', path);
    const content = await readFile(assetPath);

    // Determine content type
    let contentType = 'application/octet-stream';
    if (path.endsWith('.js')) contentType = 'application/javascript';
    else if (path.endsWith('.css')) contentType = 'text/css';
    else if (path.endsWith('.html')) contentType = 'text/html';
    else if (path.endsWith('.json')) contentType = 'application/json';

    return new Response(content as BodyInit, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
};

// Handle all HTTP methods for the SPA
export const ALL = GET;
