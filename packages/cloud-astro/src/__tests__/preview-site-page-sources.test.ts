import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assetsSitePages, diskSitePages, functionSitePages, serverDirOf } from '../preview/site-page-sources.js';

let tmp = '';
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'site-page-sources-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function put(path: string, body = ''): Promise<void> {
  await mkdir(dirname(join(tmp, path)), { recursive: true });
  await writeFile(join(tmp, path), body);
}
// `exact` names an unlisted page too, which must not count.
const LIST = JSON.stringify({
  pages: ['/docs', '/docs/contact', '/docs/about'],
  exact: ['/docs/contact', '/docs/unlisted'],
});

describe('serverDirOf', () => {
  it('finds the nearest folder holding the server entry', async () => {
    await put('dist/server/entry.mjs');
    await put('dist/server/chunks/x.mjs');
    const dir = await serverDirOf(pathToFileURL(join(tmp, 'dist/server/chunks/x.mjs')).href, 'entry.mjs');
    expect(dir.href).toBe(pathToFileURL(join(tmp, 'dist/server/')).href);
  });
});

describe('diskSitePages', () => {
  it('still reads after dist moves', async () => {
    await put('dist/server/entry.mjs');
    await put('dist/server/chunks/x.mjs');
    await put('dist/server/site-pages.json', LIST);
    await put('dist/client/index.html', '<p>home</p>');
    await put('dist/client/contact/index.html', '<p>contact</p>');
    await put('dist/client/about.html', '<p>about</p>');
    await rename(join(tmp, 'dist'), join(tmp, 'moved'));

    const dir = await serverDirOf(pathToFileURL(join(tmp, 'moved/server/chunks/x.mjs')).href, 'entry.mjs');
    const pages = diskSitePages(dir, '/docs/');
    expect(await pages.has('/docs/contact/')).toBe(true);
    expect(await pages.has('/docs/missing')).toBe(false);
    expect(await pages.exact('/docs/contact/')).toBe(true);
    expect(await pages.exact('/docs/about')).toBe(false);
    expect(await pages.exact('/docs/unlisted')).toBe(false);
    const contact = await pages.read('/docs/contact');
    expect(contact?.status).toBe(200);
    expect(contact?.headers.get('content-type')).toContain('text/html');
    expect(await contact?.text()).toBe('<p>contact</p>');
    expect(await (await pages.read('/docs/about'))?.text()).toBe('<p>about</p>');
    expect(await (await pages.read('/docs'))?.text()).toBe('<p>home</p>');
  });

  it('lists nothing when the list is malformed', async () => {
    await put('dist/server/site-pages.json', '{not json');
    await put('dist/client/contact/index.html', 'x');
    const pages = diskSitePages(pathToFileURL(join(tmp, 'dist/server/')), '/docs/');
    expect(await pages.has('/docs/contact')).toBe(false);
    expect(await pages.read('/docs/contact')).toBeNull();
  });

  it('reads no unlisted page', async () => {
    await put('dist/server/site-pages.json', LIST);
    await put('dist/client/secret/index.html', 'x');
    const pages = diskSitePages(pathToFileURL(join(tmp, 'dist/server/')), '/docs/');
    expect(await pages.read('/docs/secret')).toBeNull();
  });

  it('reads a listed page given with a trailing slash, as has() finds it', async () => {
    await put('dist/server/site-pages.json', LIST);
    await put('dist/client/contact/index.html', '<p>contact</p>');
    const pages = diskSitePages(pathToFileURL(join(tmp, 'dist/server/')), '/docs/');
    expect(await pages.has('/docs/contact/')).toBe(true);
    expect(await (await pages.read('/docs/contact/'))?.text()).toBe('<p>contact</p>');
  });
});

/** A fetch stub recording its calls. */
function stub(answer: () => Promise<Response>) {
  const calls: [string, RequestInit | undefined][] = [];
  const fetchFn = (input: string, init?: RequestInit) => {
    calls.push([input, init]);
    return answer();
  };
  return { calls, fetchFn };
}

describe('functionSitePages', () => {
  let dir = new URL('file:///');
  beforeEach(async () => {
    await put('_render.func/apps/web/dist/server/entry.mjs');
    await put('_render.func/apps/web/dist/server/chunks/x.mjs');
    await put('_render.func/apps/web/dist/server/site-pages.json', JSON.stringify({ pages: ['/contact'] }));
    dir = await serverDirOf(
      pathToFileURL(join(tmp, '_render.func/apps/web/dist/server/chunks/x.mjs')).href,
      'entry.mjs',
    );
  });

  it('listed page without site → read null', async () => {
    const { calls, fetchFn } = stub(async () => new Response('x'));
    const pages = functionSitePages(dir, null, fetchFn);
    expect(await pages.has('/contact/')).toBe(true);
    expect(await pages.read('/contact')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('fetches a listed page from the baked origin with no request headers', async () => {
    const { calls, fetchFn } = stub(async () => new Response('<p>c</p>', { headers: { 'content-type': 'text/html' } }));
    const page = await functionSitePages(dir, 'https://www.acme.test', fetchFn).read('/contact');
    expect(await page?.text()).toBe('<p>c</p>');
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0] ?? [];
    expect(url).toBe('https://www.acme.test/contact');
    expect(init?.redirect).toBe('manual');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init?.headers);
    expect(headers.has('cookie')).toBe(false);
    expect(headers.has('authorization')).toBe(false);
  });

  it('follows one same-origin redirect and refuses another origin', async () => {
    const answers = [
      new Response(null, { status: 301, headers: { location: '/contact/' } }),
      new Response('<p>c</p>', { headers: { 'content-type': 'text/html' } }),
    ];
    const same = stub(async () => answers.shift() ?? new Response(null, { status: 500 }));
    expect(await (await functionSitePages(dir, 'https://www.acme.test', same.fetchFn).read('/contact'))?.text()).toBe(
      '<p>c</p>',
    );
    expect(same.calls.map(([url]) => url)).toEqual(['https://www.acme.test/contact', 'https://www.acme.test/contact/']);

    const away = stub(async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/' } }));
    expect(await functionSitePages(dir, 'https://www.acme.test', away.fetchFn).read('/contact')).toBeNull();
    expect(away.calls).toHaveLength(1);
  });

  it('cancels the redirect body before the second hop', async () => {
    let cancelled = false;
    const body = new ReadableStream({
      cancel: () => {
        cancelled = true;
      },
    });
    const answers = [new Response(body, { status: 301, headers: { location: '/contact/' } }), new Response('<p>c</p>')];
    const { fetchFn } = stub(async () => answers.shift() ?? new Response(null, { status: 500 }));
    expect(await (await functionSitePages(dir, 'https://www.acme.test', fetchFn).read('/contact'))?.text()).toBe(
      '<p>c</p>',
    );
    expect(cancelled).toBe(true);
  });

  it('follows no redirect to another path on the same origin', async () => {
    const { calls, fetchFn } = stub(async () => new Response(null, { status: 302, headers: { location: '/login' } }));
    expect(await functionSitePages(dir, 'https://www.acme.test', fetchFn).read('/contact')).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('gives null when the fetch never answers', async () => {
    const { fetchFn } = stub(() => new Promise<Response>(() => undefined));
    const started = Date.now();
    expect(await functionSitePages(dir, 'https://www.acme.test', fetchFn).read('/contact')).toBeNull();
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('gives null on a 401 and on a throw', async () => {
    const denied = stub(async () => new Response('no', { status: 401 }));
    expect(await functionSitePages(dir, 'https://www.acme.test', denied.fetchFn).read('/contact')).toBeNull();
    const broken = stub(async () => {
      throw new Error('down');
    });
    expect(await functionSitePages(dir, 'https://www.acme.test', broken.fetchFn).read('/contact')).toBeNull();
  });

  it('fetches no unlisted page, and a missing list lists nothing', async () => {
    const { calls, fetchFn } = stub(async () => new Response('x'));
    expect(await functionSitePages(dir, 'https://www.acme.test', fetchFn).read('/secret')).toBeNull();
    expect(calls).toHaveLength(0);
    const empty = functionSitePages(pathToFileURL(join(tmp, 'nowhere/')), 'https://www.acme.test', fetchFn);
    expect(await empty.has('/contact')).toBe(false);
  });
});

describe('assetsSitePages', () => {
  it('reads the list and the pages through the assets binding', async () => {
    const seen: string[] = [];
    const files = new Map([
      [
        '/docs/_conloca/editor/site-pages.json',
        Response.json({ pages: ['/docs/contact', '/docs/blog/one'], exact: ['/docs/contact'] }),
      ],
      ['/docs/contact', new Response(null, { status: 307, headers: { location: '/docs/contact/' } })],
      ['/docs/contact/', new Response('<p>c</p>', { headers: { 'content-type': 'text/html' } })],
    ]);
    const pages = assetsSitePages(
      {
        fetch: async (request) => {
          const path = new URL(request.url).pathname;
          seen.push(path);
          return files.get(path) ?? new Response(null, { status: 404 });
        },
      },
      '/docs/',
    );
    expect(await pages.has('/docs/contact/')).toBe(true);
    expect(await pages.has('/docs/other')).toBe(false);
    expect(await pages.exact('/docs/contact/')).toBe(true);
    expect(await pages.exact('/docs/blog/one')).toBe(false);
    expect(await (await pages.read('/docs/contact'))?.text()).toBe('<p>c</p>');
    // The list is read once.
    expect(seen.filter((path) => path.endsWith('site-pages.json'))).toHaveLength(1);
  });
});
