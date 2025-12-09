import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { UIConfig } from '@conloca/cms-spa';
import type { APIRoute } from 'astro';

// Get the path to the cms-spa package by resolving its package.json
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const cmsSpaPath = dirname(require.resolve('@conloca/cms-spa/package.json'));

// Extended config for internal use
interface SpaHandlerConfig extends UIConfig {
  dataSchemasPath?: string;
}

const defaultConfig: SpaHandlerConfig = {
  basename: '/__cms',
  apiBaseUrl: '/__cms/api',
};

// Config is injected via Vite define in plugin-spa.ts
function getConfig(): SpaHandlerConfig {
  // Vite replaces import.meta.env.CONLOCA_SPA_CONFIG at build/dev time
  const injectedConfig = import.meta.env.CONLOCA_SPA_CONFIG as SpaHandlerConfig | undefined;
  return injectedConfig ?? defaultConfig;
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

export const GET: APIRoute = async ({ params }) => {
  // The path parameter is an array for [...path] routes
  const pathArray = params.path;
  const path = Array.isArray(pathArray) ? pathArray.join('/') : pathArray || '';

  // For the root path or any path without an extension, serve the HTML
  if (!path || !path.includes('.')) {
    try {
      let html = await loadIndexHtml();
      const uiConfig = getConfig();

      // Inject CMS configuration and load virtual modules
      const configScript = `
        <script>
          // Configure UI with plugin options
          window.__UI_CONFIG__ = ${JSON.stringify(uiConfig)};
        </script>
        ${uiConfig.dataSchemasPath ? `<script type="module" src="${uiConfig.basename}/data-schemas-entry.js"></script>` : ''}
        <script type="module" src="${uiConfig.basename}/puck-entry.js"></script>
        <script type="module" src="${uiConfig.basename}/content-listener.js"></script>
      `;

      // Inject the script at the top to ensure config is available first
      html = html.replace('<head>', `<head>${configScript}`);

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
