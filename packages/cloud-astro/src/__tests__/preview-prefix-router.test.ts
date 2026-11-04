import { describe, expect, it } from 'bun:test';
import { previewLabel } from '../preview/label.js';
import { isEntryCodeShape } from '../preview/middleware.js';
import {
  answerExit,
  holdsPreviewCredential,
  mediaImageRedirect,
  routePrefixed,
  serveDraftMedia,
} from '../preview/prefix-router.js';

const SLUG = 'bWFpbg';
const PASS = 'aaa.bbb.ccc';
const route = (path: string, base = '/') => routePrefixed(new URL(path, 'https://site.test'), base, 'd3');

describe('routePrefixed', () => {
  it('classifies the request', () => {
    expect(route('/x')).toEqual({ kind: 'outside' });
    // D3's `/_image` stays the dispatcher's own; d8 moves the endpoint under the route, never a slug.
    expect(route('/_image')).toEqual({ kind: 'outside' });
    expect(route('/_conloca/preview/_image')).toEqual({ kind: 'image' });
    expect(routePrefixed(new URL('https://site.test/_conloca/preview/_image'), '/', 'd8')).toEqual({ kind: 'image' });
    expect(route('/_conloca/preview/__exit')).toEqual({ kind: 'exit', slug: undefined });
    expect(route(`/_conloca/preview/${SLUG}/__exit`)).toEqual({ kind: 'exit', slug: SLUG });
    expect(route('/_conloca/preview/about')).toEqual({ kind: 'slugless', inner: '/about', entering: false });
    expect(route('/_conloca/preview/about?conloca_code=Z2l0aHViOjc.abcdefghijklmnopqrstuv')).toMatchObject({
      kind: 'slugless',
      entering: true,
    });
  });

  it('takes the slug, the page and the route under a base', () => {
    const got = route(`/docs/_conloca/preview/${SLUG}/fr/about?x=1`, '/docs/');
    expect(got).toMatchObject({
      kind: 'slugged',
      slug: SLUG,
      rest: ['fr', 'about'],
      inner: '/docs/fr/about',
      route: `/docs/_conloca/preview/${SLUG}`,
      entering: false,
    });
    expect(got.kind === 'slugged' && got.page.href).toBe('https://site.test/docs/fr/about?x=1');
  });
});

describe('holdsPreviewCredential', () => {
  it("reads only the slug's pass cookie", () => {
    expect(holdsPreviewCredential(`__Secure-conloca_preview_${SLUG}=p`, 'd3', '/', SLUG)).toBe(true);
    expect(holdsPreviewCredential('other=1', 'd3', '/', SLUG)).toBe(false);
    expect(holdsPreviewCredential(null, 'd3', '/', SLUG)).toBe(false);
  });
});

describe('answerExit', () => {
  const url = new URL('https://site.test/_conloca/preview/__exit?to=%2F');

  it('leaves for the base without a label when there is no preview build', async () => {
    const answer = await answerExit(url, undefined, null, '/', 'https://cms.test', 'd3');
    expect(answer.status).toBe(302);
    expect(answer.headers.get('location')).toBe('/');
    expect(answer.headers.get('conloca-preview')).toBeNull();
    expect(answer.headers.get('cache-control')).toBe('private, no-store');
  });

  it('answers with the label, the protocol and the mode', async () => {
    const exit = { repo: 'acme/site', siteId: 'website', branch: 'main', audience: 'acme/site' };
    const answer = await answerExit(url, undefined, exit, '/', 'https://cms.test', 'd8');
    expect(answer.status).toBe(302);
    expect(answer.headers.get('conloca-preview')).toBe(await previewLabel('acme/site', 'website', 'main'));
    expect(answer.headers.get('conloca-preview-protocol')).toBe('2');
    expect(answer.headers.get('conloca-preview-mode')).toBe('d8');
  });
});

describe('isEntryCodeShape', () => {
  it('accepts `<org token>.<secret>` only', () => {
    expect(isEntryCodeShape('Z2l0aHViOjc.abcdefghijklmnopqrstuv')).toBe(true);
    expect(isEntryCodeShape('x')).toBe(false);
    expect(isEntryCodeShape('a.b')).toBe(false);
    expect(isEntryCodeShape('Z2l0aHViOjc.abcdefghijklmnopqrstuv.x')).toBe(false);
    // `Z2l0aHViOjd` decodes to the same bytes but is not how they encode.
    expect(isEntryCodeShape('Z2l0aHViOjd.abcdefghijklmnopqrstuv')).toBe(false);
  });
});

describe('routePrefixed — media', () => {
  it('parses the raw media path under the slug, query dropped', () => {
    expect(
      routePrefixed(
        new URL(`https://site.test/docs/_conloca/preview/${SLUG}/__media/uploads/a.webp?x`),
        '/docs/',
        'd8',
      ),
    ).toEqual({
      kind: 'media',
      slug: SLUG,
      path: 'uploads/a.webp',
      route: `/docs/_conloca/preview/${SLUG}`,
    });
  });
});

/** A fake endpoint answering every read alike, recording each. */
function upstream(answer: () => Response) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchFn = Object.assign(
    async (input: Request | string | URL, init?: RequestInit) => {
      calls.push({ url: input instanceof Request ? input.url : input.toString(), init });
      return answer();
    },
    { preconnect: fetch.preconnect },
  );
  return { calls, fetchFn };
}
describe('serveDraftMedia', () => {
  const at = { kind: 'media', slug: SLUG, path: 'uploads/a.webp', route: `/_conloca/preview/${SLUG}` } as const;
  const MEDIA_URL = `https://site.test/_conloca/preview/${SLUG}/__media/uploads/a.webp`;
  const withPass = (slug = SLUG, extra: Record<string, string> = {}) =>
    new Request(MEDIA_URL, { headers: { cookie: `__Secure-conloca_preview_${slug}=${PASS}`, ...extra } });

  it('sends the pass, forwards if-none-match and streams the image with only the forwarded and preview headers', async () => {
    const body = new ReadableStream();
    const up = upstream(
      () =>
        new Response(body, {
          headers: {
            'content-type': 'image/webp',
            etag: '"e1"',
            'content-length': '3',
            'last-modified': 'Mon, 01 Jan 2024 00:00:00 GMT',
            'set-cookie': 'x=1',
          },
        }),
    );
    const answer = await serveDraftMedia(
      withPass(SLUG, { 'if-none-match': '"e0"' }),
      at,
      '/',
      'https://cms.test',
      up.fetchFn,
    );
    expect(up.calls[0]?.url).toBe('https://cms.test/preview/media/uploads/a.webp');
    expect(up.calls[0]?.init?.headers).toEqual({ authorization: `Bearer ${PASS}`, 'if-none-match': '"e0"' });
    expect(up.calls[0]?.init?.redirect).toBe('manual');
    expect(answer.status).toBe(200);
    expect(answer.body).toBe(body);
    expect(answer.headers.get('set-cookie')).toBeNull();
    expect(answer.headers.get('last-modified')).toBeNull();
    expect(answer.headers.get('content-type')).toBe('image/webp');
    expect(answer.headers.get('etag')).toBe('"e1"');
    expect(answer.headers.get('cache-control')).toBe('private, no-store');
  });

  it('locks an image down so a branch SVG runs no script on the site', async () => {
    const up = upstream(() => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }));
    const svg = { ...at, path: 'evil.svg' };
    const answer = await serveDraftMedia(
      withPass(SLUG, { 'sec-fetch-dest': 'document' }),
      svg,
      '/',
      'https://cms.test',
      up.fetchFn,
    );
    expect(answer.status).toBe(200);
    expect(answer.headers.get('x-content-type-options')).toBe('nosniff');
    expect(answer.headers.get('content-security-policy')).toContain("default-src 'none'; sandbox");
  });

  it("another slug's cookie gets nothing", async () => {
    const up = upstream(() => new Response('x'));
    const answer = await serveDraftMedia(withPass('ZGV2'), at, '/', 'https://cms.test', up.fetchFn);
    expect(answer.status).toBe(404);
    expect(answer.headers.get('cache-control')).toBe('private, no-store');
    expect(up.calls).toHaveLength(0);
  });

  it('a non-image answer is no media', async () => {
    const up = upstream(() => new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    expect((await serveDraftMedia(withPass(), at, '/', 'https://cms.test', up.fetchFn)).status).toBe(404);
  });

  it('revoked grant gets no bytes', async () => {
    const up = upstream(() => new Response('gone', { status: 410 }));
    const answer = await serveDraftMedia(withPass(), at, '/', 'https://cms.test', up.fetchFn);
    expect(answer.status).toBe(404);
    expect(await answer.text()).toBe('');
  });

  it('passes a 304 through with its etag', async () => {
    const up = upstream(() => new Response(null, { status: 304, headers: { etag: '"e1"' } }));
    const answer = await serveDraftMedia(withPass(), at, '/', 'https://cms.test', up.fetchFn);
    expect(answer.status).toBe(304);
    expect(answer.headers.get('etag')).toBe('"e1"');
    expect(answer.headers.get('x-content-type-options')).toBe('nosniff');
    expect(answer.headers.get('content-security-policy')).toContain("default-src 'none'; sandbox");
    expect(answer.headers.get('cache-control')).toBe('private, no-store');
  });

  it('refuses a path that is no image ref, a missing or malformed pass and a write, without fetching', async () => {
    const up = upstream(() => new Response('x', { headers: { 'content-type': 'image/png' } }));
    const badPaths = ['', 'a//b.png', 'page.html', 'noext', '../x.png'].map((path) =>
      serveDraftMedia(withPass(), { ...at, path }, '/', 'https://cms.test', up.fetchFn),
    );
    const badPasses = ['', `__Secure-conloca_preview_${SLUG}=`, `__Secure-conloca_preview_${SLUG}=not-a-jwt`].map(
      (cookie) =>
        serveDraftMedia(new Request(MEDIA_URL, { headers: { cookie } }), at, '/', 'https://cms.test', up.fetchFn),
    );
    for (const answer of await Promise.all([...badPaths, ...badPasses])) {
      expect(answer.status).toBe(404);
      expect(answer.body).toBeNull();
    }
    const post = new Request(MEDIA_URL, { method: 'POST', headers: withPass().headers });
    expect((await serveDraftMedia(post, at, '/', 'https://cms.test', up.fetchFn)).status).toBe(404);
    expect(up.calls).toHaveLength(0);
  });

  it("refuses an image whose type isn't its extension's", async () => {
    const up = upstream(() => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }));
    expect((await serveDraftMedia(withPass(), at, '/', 'https://cms.test', up.fetchFn)).status).toBe(404);
  });

  it('a refused body that fails to cancel is still a 404', async () => {
    const errored = new ReadableStream({
      cancel() {
        throw new Error('stream broke');
      },
    });
    const up = upstream(() => new Response(errored, { status: 500 }));
    expect((await serveDraftMedia(withPass(), at, '/', 'https://cms.test', up.fetchFn)).status).toBe(404);
  });

  it('a thrown fetch is a bodiless 404', async () => {
    const fetchFn = Object.assign(
      async () => {
        throw new Error('down');
      },
      { preconnect: fetch.preconnect },
    );
    const answer = await serveDraftMedia(withPass(), at, '/', 'https://cms.test', fetchFn);
    expect(answer.status).toBe(404);
    expect(answer.body).toBeNull();
    expect(answer.headers.get('cache-control')).toBe('private, no-store');
  });

  it('tries each JWT-shaped pass (at most two) and keeps the first image', async () => {
    const asked: string[] = [];
    const fetchFn = Object.assign(
      async (_input: Request | string | URL, init?: RequestInit) => {
        const auth = new Headers(init?.headers).get('authorization') ?? '';
        asked.push(auth);
        return auth === 'Bearer b.b.b'
          ? new Response('img', { headers: { 'content-type': 'image/webp' } })
          : new Response(null, { status: 401 });
      },
      { preconnect: fetch.preconnect },
    );
    const name = `__Secure-conloca_preview_${SLUG}`;
    const planted = new Request(MEDIA_URL, { headers: { cookie: `${name}=a.a.a; ${name}=b.b.b; ${name}=c.c.c` } });
    expect((await serveDraftMedia(planted, at, '/', 'https://cms.test', fetchFn)).status).toBe(200);
    expect(asked).toEqual(['Bearer a.a.a', 'Bearer b.b.b']);
  });
});

/** The image endpoint of a `/docs/` site asked for `href`. */
const redirectOf = (href: string) =>
  mediaImageRedirect(new URL(`https://site.test/docs/_image?href=${encodeURIComponent(href)}`), '/docs/', 'd3');

describe('mediaImageRedirect', () => {
  it('redirects only a same-origin href under the route media folder, never off the site', () => {
    expect(redirectOf(`/docs/_conloca/preview/${SLUG}/__media/a.png`)?.headers.get('location')).toBe(
      `/docs/_conloca/preview/${SLUG}/__media/a.png`,
    );
    for (const href of [
      `https://evil.test/docs/_conloca/preview/${SLUG}/__media/a.png`,
      `//evil.test/docs/_conloca/preview/${SLUG}/__media/a.png`,
      `/\\evil.test/docs/_conloca/preview/${SLUG}/__media/a.png`,
      `/_conloca/preview/${SLUG}/__media/a.png`,
      '/docs/_conloca/preview/blog/__media/a.png',
      '/docs/x/__media/a.png',
    ]) {
      expect(redirectOf(href)).toBeNull();
    }
  });
});
