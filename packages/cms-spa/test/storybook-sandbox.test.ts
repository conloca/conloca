import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSandboxSrcdoc, SANDBOX_FRAME_PATH } from '@conloca/mdx/sandbox-frame';
import { build, createServer, type HttpServer, type PreviewServer, preview, type ViteDevServer } from 'vite';
import { sandboxFrameFileName, sandboxFramePlugin } from '../.storybook/sandbox-frame-plugin.js';

/** Vite types its listener as HTTP/1 or HTTP/2; without `https` it is always HTTP/1. */
function http1(server: HttpServer): Server {
  if (!(server instanceof Server)) throw new Error('Expected an HTTP/1 listener');
  return server;
}

function origin(server: Server): string {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected an HTTP TCP listener');
  return `http://127.0.0.1:${address.port}`;
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
}

// These requests go to a real listener. Other cms-spa test files replace the
// shared global fetch with an in-process API stub, so use Bun's own fetch.
describe('Storybook sandbox frame shell', () => {
  it('serves the production sandbox in development, including HEAD requests and query keys', async () => {
    const root = mkdtempSync(join(tmpdir(), 'conloca-storybook-dev-'));
    let server: ViteDevServer | undefined;
    try {
      server = await createServer({
        configFile: false,
        envFile: false,
        root,
        logLevel: 'silent',
        plugins: [sandboxFramePlugin()],
        server: { host: '127.0.0.1', port: 0 },
        optimizeDeps: { noDiscovery: true, include: [] },
      });
      await server.listen();
      if (!server.httpServer) throw new Error('Expected a Vite HTTP server');
      const url = `${origin(http1(server.httpServer))}${SANDBOX_FRAME_PATH}?k=storybook-dev`;
      const response = await Bun.fetch(url);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(await response.text()).toBe(buildSandboxSrcdoc());
      const head = await Bun.fetch(url, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(head.headers.get('content-type')).toContain('text/html');
      expect(await head.text()).toBe('');
    } finally {
      await server?.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);

  it('emits a real static HTML asset and serves the production URL without a backend', async () => {
    const root = mkdtempSync(join(tmpdir(), 'conloca-storybook-static-'));
    const outDir = join(root, 'dist');
    let server: PreviewServer | undefined;
    try {
      const entry = join(root, 'entry.ts');
      writeFileSync(entry, 'export const catalog = true;\n');
      await build({
        configFile: false,
        envFile: false,
        root,
        logLevel: 'silent',
        plugins: [sandboxFramePlugin()],
        build: { outDir, minify: false, lib: { entry, formats: ['es'], fileName: 'entry' } },
      });
      expect(readFileSync(join(outDir, sandboxFrameFileName), 'utf8')).toBe(buildSandboxSrcdoc());
      server = await preview({
        configFile: false,
        envFile: false,
        root,
        logLevel: 'silent',
        plugins: [sandboxFramePlugin()],
        build: { outDir },
        preview: { host: '127.0.0.1', port: 0 },
      });
      const key = 'storybook + / # ?';
      const url = `${origin(http1(server.httpServer))}${SANDBOX_FRAME_PATH}?k=${encodeURIComponent(key)}`;
      const response = await Bun.fetch(url);
      expect(response.status).toBe(200);
      expect(new URL(response.url).pathname).toBe(`${SANDBOX_FRAME_PATH}/`);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(new URL(response.url).searchParams.get('k')).toBe(key);
      expect(await response.text()).toBe(buildSandboxSrcdoc());
    } finally {
      if (server) await closeHttpServer(http1(server.httpServer));
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);
});
