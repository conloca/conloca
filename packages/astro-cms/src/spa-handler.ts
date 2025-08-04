import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { UIConfig } from '@conloca/cms-spa';
import type { APIRoute } from 'astro';

// Get the path to the cms-spa package by resolving its package.json
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const cmsSpaPath = dirname(require.resolve('@conloca/cms-spa/package.json'));

// Configuration set by the plugin
let uiConfig: UIConfig = {
  basename: '/__cms',
  apiBaseUrl: '/__cms/api',
};

export function configureSpaHandler(config: UIConfig) {
  uiConfig = { ...uiConfig, ...config };
  // Ensure apiBaseUrl is set based on basename if not explicitly provided
  if (!uiConfig.apiBaseUrl && uiConfig.basename) {
    uiConfig.apiBaseUrl = `${uiConfig.basename}/api`;
  }
}

// Load the HTML at runtime
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
  // The path parameter is an array for [...path] routes
  const pathArray = params.path;
  const path = Array.isArray(pathArray) ? pathArray.join('/') : pathArray || '';
  console.log('[spa-handler] Request for path:', path, 'params:', params, 'URL:', request.url);

  // For the root path or any path without an extension, serve the HTML
  if (!path || !path.includes('.')) {
    try {
      let html = await loadIndexHtml();

      // Inject CMS configuration and load puck entry
      const configScript = `
        <script>
          // Configure UI with plugin options
          window.__UI_CONFIG__ = ${JSON.stringify(uiConfig)};
        </script>
        <script type="module" src="${uiConfig.basename}/puck-entry.js"></script>
      `;

      // Inject the script at the top to ensure config is available first
      html = html.replace('<head>', `<head>${configScript}`);

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

    // JavaScript files are transformed by the middleware in plugin-spa.ts

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
