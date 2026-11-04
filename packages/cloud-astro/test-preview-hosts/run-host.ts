/**
 * Runs a built fixture the way its host serves it, on this machine. Node: the adapter's own standalone server.
 * Cloudflare: `wrangler dev --local`. Vercel and Netlify: a small Node server (this file, run by Node) that answers
 * from the static output first, as their CDNs do, and hands the rest to the deployed function's own handler.
 *
 * Imports only Node's built-ins: Node runs this file as it is, with its types stripped.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer as createHttpServer, type IncomingMessage } from 'node:http';
import { createRequire } from 'node:module';
import { createServer as createNetServer } from 'node:net';
import { resolve as absolute, dirname, extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

type HostAdapter = 'vercel' | 'netlify' | 'node' | 'cloudflare';

export interface Host {
  origin: string;
  /** What the host printed so far. */
  log(): string;
  stop(): void;
}

/** A port nothing listens on right now. */
function freePort(): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const server = createNetServer();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close(() => (typeof address === 'object' && address !== null ? resolve(address.port) : reject()));
  });
  return promise;
}

/**
 * Starts `dir`'s host with `env` (the deployment's variables) on a free port and waits until it answers. The child
 * gets only what a process needs, so no key from this machine reaches the fixture.
 */
export async function runHost(adapter: HostAdapter, dir: string, env: Record<string, string>): Promise<Host> {
  const port = await freePort();
  const bare = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
  };
  let child: ChildProcess;
  if (adapter === 'cloudflare') {
    const manifest = createRequire(join(dir, 'package.json')).resolve('wrangler/package.json');
    const { bin }: { bin: { wrangler: string } } = JSON.parse(readFileSync(manifest, 'utf8'));
    const vars = Object.entries(env).flatMap(([name, value]) => ['--var', `${name}:${value}`]);
    child = spawn(
      'node',
      [
        join(dirname(manifest), bin.wrangler),
        'dev',
        '--local',
        '--ip',
        '127.0.0.1',
        '--port',
        String(port),
        '--inspector-port',
        String(await freePort()),
        '--show-interactive-dev-session=false',
        ...vars,
      ],
      { cwd: dir, env: bare },
    );
  } else if (adapter === 'node') {
    child = spawn('node', ['dist/server/entry.mjs'], {
      cwd: dir,
      env: { ...bare, ...env, HOST: '127.0.0.1', PORT: String(port) },
    });
  } else {
    child = spawn('node', [fileURLToPath(import.meta.url), adapter, absolute(dir), String(port)], {
      cwd: dir,
      env: { ...bare, ...env },
    });
  }
  let log = '';
  child.stdout?.on('data', (chunk) => (log += chunk));
  child.stderr?.on('data', (chunk) => (log += chunk));
  const origin = `http://127.0.0.1:${port}`;
  const host = { origin, log: () => log, stop: () => void child.kill() };
  for (let attempt = 0; attempt < 240; attempt++) {
    if (child.exitCode !== null) break;
    // oxlint-disable-next-line no-await-in-loop -- polling a starting server, one attempt at a time.
    const up = await fetch(`${origin}/`, { redirect: 'manual' }).then(
      () => true,
      () => false,
    );
    if (up) return host;
    // oxlint-disable-next-line no-await-in-loop -- as above.
    await Bun.sleep(250);
  }
  host.stop();
  throw new Error(`${adapter} host for ${dir} never answered:\n${log}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// The Vercel and Netlify host, run by Node: `node run-host.ts <vercel|netlify> <dir> <port>`.
// ---------------------------------------------------------------------------------------------------------------------

const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css'],
  ['.js', 'text/javascript'],
  ['.json', 'application/json'],
  ['.xml', 'application/xml'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
]);

/** The file a CDN serves for `pathname` from `root`: the file itself, or the folder's `index.html`. */
async function staticFile(root: string, pathname: string): Promise<string | null> {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (path.split('/').includes('..')) return null;
  for (const candidate of [join(root, path), join(root, path, 'index.html')]) {
    // oxlint-disable-next-line no-await-in-loop -- in order: the file itself wins over a folder's index.
    if ((await stat(candidate).catch(() => null))?.isFile()) return candidate;
  }
  return null;
}

async function fileResponse(path: string, status: number, headers: Headers): Promise<Response> {
  headers.set('content-type', TYPES.get(extname(path)) ?? 'application/octet-stream');
  return new Response(await readFile(path), { status, headers });
}

interface VercelRoute {
  handle?: string;
  src?: string;
  dest?: string;
  status?: number;
  headers?: Record<string, string>;
  continue?: boolean;
}

/** Vercel: `config.json`'s routes in order, `handle: filesystem` being the static output; `_render` is the function. */
async function vercelHost(dir: string): Promise<(request: Request) => Promise<Response>> {
  const output = join(dir, '.vercel/output');
  const { routes }: { routes: VercelRoute[] } = JSON.parse(await readFile(join(output, 'config.json'), 'utf8'));
  const func = join(output, 'functions/_render.func');
  const { handler }: { handler: string } = JSON.parse(await readFile(join(func, '.vc-config.json'), 'utf8'));
  const entry: { default: { fetch(request: Request): Promise<Response> } } = await import(
    pathToFileURL(join(func, handler)).href
  );
  const root = join(output, 'static');
  return async (request) => {
    const { pathname } = new URL(request.url);
    const headers = new Headers();
    for (const route of routes) {
      if (route.handle !== undefined) {
        // oxlint-disable-next-line no-await-in-loop -- routes run in order.
        const file = route.handle === 'filesystem' ? await staticFile(root, pathname) : null;
        // oxlint-disable-next-line no-await-in-loop -- as above.
        if (file !== null) return fileResponse(file, 200, headers);
        continue;
      }
      if (route.src === undefined || !new RegExp(route.src, 'u').test(pathname)) continue;
      for (const [name, value] of Object.entries(route.headers ?? {})) headers.set(name, value);
      if (route.continue) continue;
      if (route.dest === '_render') {
        // oxlint-disable-next-line no-await-in-loop -- the first matching route answers.
        const response = await entry.default.fetch(request);
        for (const [name, value] of headers) response.headers.set(name, value);
        return response;
      }
      // oxlint-disable-next-line no-await-in-loop -- as above.
      const file = route.dest === undefined ? null : await staticFile(root, route.dest);
      // oxlint-disable-next-line no-await-in-loop -- as above.
      if (file !== null) return fileResponse(file, route.status ?? 200, headers);
      return new Response(null, { status: route.status ?? 404, headers });
    }
    return new Response('not found', { status: 404 });
  };
}

/** Netlify: the publish folder first (`preferStatic`), then the SSR function on `/*`. */
async function netlifyHost(dir: string): Promise<(request: Request) => Promise<Response>> {
  const entry: { default(request: Request, context: { ip: string }): Promise<Response> } = await import(
    pathToFileURL(join(dir, '.netlify/v1/functions/ssr/ssr.mjs')).href
  );
  const root = join(dir, 'dist');
  return async (request) => {
    const file = await staticFile(root, new URL(request.url).pathname);
    return file === null ? entry.default(request, { ip: '127.0.0.1' }) : fileResponse(file, 200, new Headers());
  };
}

// shortcut: no request body is passed on, since every request the suites send is a GET; pass `message` as a stream
// once one posts.
function toRequest(message: IncomingMessage, port: number): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headersDistinct)) {
    for (const item of value ?? []) headers.append(name, item);
  }
  return new Request(`http://127.0.0.1:${port}${message.url ?? '/'}`, { method: message.method ?? 'GET', headers });
}

/**
 * Serves `dir` on `port`. A fetch to the site's production origin (`RUN_HOST_SITE`) is answered by this same host,
 * as production would answer it: that is the stub origin the function reads the site's own pages from.
 */
async function serve(adapter: 'vercel' | 'netlify', dir: string, port: number): Promise<void> {
  const handle = adapter === 'vercel' ? await vercelHost(dir) : await netlifyHost(dir);
  const site = process.env.RUN_HOST_SITE;
  if (site !== undefined) {
    const realFetch = globalThis.fetch;
    Object.assign(globalThis, {
      fetch(input: string | URL | Request, init?: RequestInit) {
        // Two calls: Bun's typings split the constructor's overloads by the input's type.
        const request = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
        return new URL(request.url).origin === site ? handle(request) : realFetch(request);
      },
    });
  }
  createHttpServer(async (message, reply) => {
    try {
      const response = await handle(toRequest(message, port));
      const raw: string[] = [];
      response.headers.forEach((value, name) => {
        if (name !== 'set-cookie') raw.push(name, value);
      });
      for (const cookie of response.headers.getSetCookie()) raw.push('set-cookie', cookie);
      reply.writeHead(response.status, raw);
      if (response.body === null) reply.end();
      else Readable.fromWeb(response.body).pipe(reply);
    } catch (error) {
      console.error(error);
      reply.writeHead(500).end(String(error));
    }
  }).listen(port, '127.0.0.1');
}

if (import.meta.main) {
  const [adapter, dir, port] = process.argv.slice(2);
  if ((adapter !== 'vercel' && adapter !== 'netlify') || dir === undefined || port === undefined) {
    throw new Error('usage: node run-host.ts <vercel|netlify> <dir> <port>');
  }
  await serve(adapter, dir, Number(port));
}
