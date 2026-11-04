import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import type { ContentManifest } from '@conloca/content-api';
import { previewBranchSlug } from '@conloca/content-api/editor-host';
import { FileSystemContentAPI } from '@conloca/content-api/node';
import {
  BRANCH_MEDIA,
  DRAFT_TEXT,
  draftOf,
  type FakeConloca,
  HEADINGS,
  mediaSrcs,
  SHARE_ENDED,
  startFakeConloca,
  VERDICT_TABLE,
  withBranchMedia,
} from './fake-conloca.js';
import { type Adapter, buildFixture, type Shape } from './fixtures.js';
import { type Host, runHost } from './run-host.js';

/** One adapter per run (`CONLOCA_FIXTURE_ADAPTER`), as `build.test.ts`. */
const ADAPTERS = ['vercel', 'netlify', 'node', 'cloudflare'] as const;
const named = ADAPTERS.find((adapter) => adapter === process.env.CONLOCA_FIXTURE_ADAPTER);
if (named === undefined) throw new Error(`set CONLOCA_FIXTURE_ADAPTER to one of ${ADAPTERS.join(', ')}`);
const ADAPTER: Adapter = named;

const SUITE_TIMEOUT = 600_000;
const BUILDS_AT_ONCE = 4;
const PREFIX = '/_conloca/preview';
const MAIN = previewBranchSlug('main');
/** The branch `n`: its slug is `bg`, which the i18n fixture also has as a locale. */
const N = previewBranchSlug('n');
/** Vercel and Netlify read the site's own pages from production, which only a production build names. */
const FROM_PRODUCTION = ADAPTER === 'vercel' || ADAPTER === 'netlify';
const PRODUCTION_ENV: Record<string, string> =
  ADAPTER === 'vercel' ? { VERCEL_ENV: 'production' } : { CONTEXT: 'production' };
const SITE = 'https://fixture.example';

interface Run {
  name: string;
  shape: Shape;
  preview: boolean;
  /** Built with the host's production setting, and run with the stub production origin. */
  production?: boolean;
}

/** The hosts this adapter runs, by name: each is a fixture build and its env. */
const RUNS: Run[] = [
  { name: 'static', shape: 'static', preview: true },
  { name: 'i18n', shape: 'server-i18n', preview: true },
  { name: 'hybrid', shape: 'hybrid', preview: true },
  { name: 'hybrid-plain', shape: 'hybrid', preview: false },
  ...(FROM_PRODUCTION
    ? [
        { name: 'static-production', shape: 'static', preview: true, production: true } as const,
        { name: 'nosite-production', shape: 'nosite', preview: true, production: true } as const,
      ]
    : []),
  ...(ADAPTER === 'netlify' ? [{ name: 'static-cache', shape: 'static-cache', preview: true } as const] : []),
];

let fake: FakeConloca;
const hosts = new Map<string, Host>();
const dirs = new Map<string, string>();
const host = (name: string): Host => {
  const found = hosts.get(name);
  if (found === undefined) throw new Error(`${ADAPTER} ${name} is not running`);
  return found;
};

beforeAll(async () => {
  fake = await startFakeConloca();
  let next = 0;
  await Promise.all(
    Array.from({ length: BUILDS_AT_ONCE }, async () => {
      for (let run = RUNS[next++]; run !== undefined; run = RUNS[next++]) {
        const { name } = run;
        // oxlint-disable-next-line no-await-in-loop -- each worker builds and starts one fixture at a time.
        const { dir } = await buildFixture(ADAPTER, run.shape, {
          preview: run.preview,
          copy: `-run${run.production ? '-production' : ''}`,
          env: run.production ? PRODUCTION_ENV : {},
        });
        dirs.set(name, dir);
        // oxlint-disable-next-line no-await-in-loop -- as above.
        const started = await runHost(ADAPTER, dir, {
          CONLOCA_SAAS_ENDPOINT: fake.origin,
          ...(run.production ? { RUN_HOST_SITE: SITE } : {}),
        });
        hosts.set(name, started);
      }
    }),
  );
  // The branch changed `/about`'s Hero: a draft render shows its words, the published page never does.
  const about = await draftOf(join(dirs.get('static') ?? '', 'content'), 'vx-about');
  fake.drafts.set(`${about.id} en`, about);
}, SUITE_TIMEOUT);

afterAll(async () => {
  for (const running of hosts.values()) running.stop();
  await fake?.stop();
});

/** A code issued for the `static` host, as Conloca issues one for the site it shares. */
const mint = (outcome: Parameters<FakeConloca['code']>[0]) => fake.code(outcome, host('static').origin);

/** A browser's cookie jar, by name: each cookie goes back only under its own path. */
function cookieJar() {
  const cookies = new Map<string, { value: string; path: string }>();
  return {
    take(response: Response) {
      for (const line of response.headers.getSetCookie()) {
        const [pair = '', ...attributes] = line.split(';').map((part) => part.trim());
        const eq = pair.indexOf('=');
        const path = attributes.find((a) => a.startsWith('Path='))?.slice('Path='.length) ?? '/';
        if (attributes.includes('Max-Age=0')) cookies.delete(pair.slice(0, eq));
        else cookies.set(pair.slice(0, eq), { value: pair.slice(eq + 1), path });
      }
    },
    for(pathname: string): string {
      return [...cookies]
        .filter(([, { path }]) => pathname === path || pathname.startsWith(`${path}/`))
        .map(([name, { value }]) => `${name}=${value}`)
        .join('; ');
    },
    names: () => [...cookies.keys()],
  };
}

/** A top-level navigation to `path` on `name`'s host; nothing followed. */
const navigate = (name: string, path: string, cookie = '') =>
  fetch(`${host(name).origin}${path}`, {
    headers: { 'sec-fetch-mode': 'navigate', ...(cookie === '' ? {} : { cookie }) },
    redirect: 'manual',
  });

/** The pass cookie for `branch`, as the entry sets it. */
const passCookie = async (branch = 'main') =>
  `__Secure-conloca_preview_${previewBranchSlug(branch)}=${await fake.pass({ branch })}`;

const PREVIEW_HEADERS = {
  'cache-control': 'private, no-store',
  'cdn-cache-control': 'no-store',
  'vercel-cdn-cache-control': 'no-store',
  'netlify-cdn-cache-control': 'no-store',
};
function expectPreviewHeaders(response: Response, kind: string): void {
  for (const [name, value] of Object.entries(PREVIEW_HEADERS)) {
    expect(`${kind} ${name}: ${response.headers.get(name)}`).toBe(`${kind} ${name}: ${value}`);
  }
  const vary = (response.headers.get('vary') ?? '').split(',').map((token) => token.trim().toLowerCase());
  expect(`${kind} vary ${vary.join(',')}`).toContain('cookie');
}

/** The branch listing the fixture's content folder makes, as Conloca's `/preview/manifests` would answer it. */
async function listing(name: string): Promise<ContentManifest[]> {
  const api = await FileSystemContentAPI.create({ contentRoot: join(dirs.get(name) ?? '', 'content') });
  return [...api.listAllContent()];
}

/** The first `<img>` src in `html`, unescaped. */
const imageSrc = (html: string) => (/<img src="([^"]+)"/u.exec(html)?.[1] ?? '').replaceAll('&amp;', '&');

/**
 * Netlify's image service sends every `<Image>`, draft or live, to Netlify's image CDN, which only Netlify runs: here
 * the check is that the file it names is served.
 */
const NETLIFY_CDN = '/.netlify/images?url=';
const servedImage = (src: string) =>
  src.startsWith(NETLIFY_CDN) ? `/${new URL(src, 'http://host.invalid').searchParams.get('url') ?? ''}` : src;
/** Where a hybrid site's own `<Image>` points: its `/_image`, or Netlify's CDN. */
const SITE_IMAGE = ADAPTER === 'netlify' ? NETLIFY_CDN : '/_image?';

describe(`${ADAPTER}: the preview round trip`, () => {
  it('points the branch images of the draft at the media route and serves them to the pass holder only', async () => {
    const key = 'vx-about en';
    const plain = fake.drafts.get(key);
    if (plain === undefined) throw new Error('no draft of vx-about');
    fake.drafts.set(key, withBranchMedia(plain));
    try {
      const pass = await passCookie();
      const html = await (await navigate('static', `${PREFIX}/${MAIN}/about/`, pass)).text();
      const route = `${PREFIX}/${MAIN}/__media/`;
      const srcs = mediaSrcs(html);
      expect(srcs).toEqual([`${route}${BRANCH_MEDIA.upload}`, `${route}${BRANCH_MEDIA.committed}`]);
      const image = (src: string, cookie?: string) =>
        fetch(`${host('static').origin}${src}`, {
          headers: { 'sec-fetch-dest': 'image', ...(cookie === undefined ? {} : { cookie }) },
          redirect: 'manual',
        });
      for (const answer of await Promise.all(srcs.map((src) => image(src, pass)))) {
        expect(answer.status).toBe(200);
        expect(answer.headers.get('content-type')).toBe('image/png');
        expect(answer.headers.get('x-content-type-options')).toBe('nosniff');
        expect(answer.headers.get('content-security-policy')).toContain("default-src 'none'; sandbox");
        expect(answer.headers.get('cache-control')).toBe('private, no-store');
      }
      const bodies = await Promise.all(
        srcs.map(async (src) => (await (await image(src, pass)).arrayBuffer()).byteLength),
      );
      expect(bodies.every((bytes) => bytes > 0)).toBe(true);
      // What a draft's `<Image>` of that image asks for: the image endpoint sends it to the route, which reads it.
      const viaImage = await Promise.all(
        srcs.map((src) => image(`${PREFIX}/_image?href=${encodeURIComponent(src)}&w=1&h=1&f=png`, pass)),
      );
      expect(viaImage.map((answer) => [answer.status, answer.headers.get('location')])).toEqual(
        srcs.map((src) => [302, src]),
      );
      const followed = await Promise.all(viaImage.map((answer) => image(answer.headers.get('location') ?? '', pass)));
      expect(followed.map((answer) => answer.headers.get('content-type'))).toEqual(['image/png', 'image/png']);
      const mediaReads = () => fake.calls.filter((call) => call.startsWith('/preview/media/')).length;
      const before = mediaReads();
      const refused = await Promise.all(srcs.map((src) => image(src)));
      expect(refused.map((answer) => answer.status)).toEqual([404, 404]);
      expect(mediaReads()).toBe(before);
    } finally {
      fake.drafts.set(key, plain);
    }
  });

  it('opens a draft from a minted code, serves it with the banner, and exits', async () => {
    const jar = cookieJar();
    const code = mint({ pass: await fake.pass() });
    const entered = await navigate('static', `${PREFIX}/${MAIN}/about/?conloca_code=${code}`);
    expect(entered.status).toBe(302);
    expect(entered.headers.get('location')).toBe(`${host('static').origin}${PREFIX}/${MAIN}/about/`);
    jar.take(entered);
    expect(jar.names()).toEqual([`__Secure-conloca_preview_${MAIN}`]);

    const draft = await navigate('static', `${PREFIX}/${MAIN}/about/`, jar.for(`${PREFIX}/${MAIN}/about/`));
    expect(draft.status).toBe(200);
    const html = await draft.text();
    expect(html).toContain('conloca-preview-banner');
    // The branch's own words, which no published page holds.
    expect(html).toContain(DRAFT_TEXT);

    const exit = await navigate(
      'static',
      `${PREFIX}/${MAIN}/__exit?to=%2Fabout%2F`,
      jar.for(`${PREFIX}/${MAIN}/__exit`),
    );
    expect(exit.status).toBe(302);
    expect(exit.headers.get('location')).toBe('/about/');
    jar.take(exit);
    expect(jar.names()).toEqual([]);
  });

  for (const ended of SHARE_ENDED) {
    it(`answers a link whose share ended (${ended}) with its page, never the draft`, async () => {
      const answer = await navigate('static', `${PREFIX}/${MAIN}/about/?conloca_code=${mint({ ended })}`);
      expect(answer.status).toBe(410);
      const html = await answer.text();
      expect(html).toContain(HEADINGS[ended]);
      expect(html).toContain(`${PREFIX}/${MAIN}/__exit?to=%2Fabout%2F`);
    });
  }

  for (const row of VERDICT_TABLE) {
    it(`answers page-status ${row.verdict} with ${row.status}`, async () => {
      fake.verdicts.set('/about', row.verdict);
      if (row.verdict === 'deleted') fake.manifests = (await listing('static')).filter((m) => m.id !== 'vx-about');
      try {
        const answer = await navigate('static', `${PREFIX}/${MAIN}/about/`, await passCookie());
        expect(answer.status).toBe(row.status);
        const html = await answer.text();
        expect(html.includes('conloca-preview-banner')).toBe(row.banner);
        if (row.location !== undefined) {
          expect(answer.headers.get('location')).toBe(`${PREFIX}/${MAIN}${row.location}`);
        }
        if (row.shows !== undefined) expect(html).toContain(row.shows);
      } finally {
        fake.verdicts.clear();
        fake.manifests = null;
      }
    });
  }

  it('renews an expired share pass through the share link', async () => {
    const grant = 'G'.repeat(22);
    const entered = await navigate(
      'static',
      `${PREFIX}/${MAIN}/about/?conloca_code=${mint({ pass: await fake.pass({ grant }) })}`,
    );
    const jar = cookieJar();
    jar.take(entered);
    expect(jar.names()).toEqual([`__Secure-conloca_preview_${MAIN}`, `__Secure-conloca_grant_${MAIN}`]);
    // The pass cookie has expired; the grant cookie outlives it.
    const grantOnly = jar
      .for(`${PREFIX}/${MAIN}/about/`)
      .split('; ')
      .filter((c) => c.startsWith('__Secure-conloca_grant_'));
    const renewal = await navigate('static', `${PREFIX}/${MAIN}/about/`, grantOnly.join('; '));
    expect(renewal.status).toBe(302);
    expect(renewal.headers.get('location')).toBe(
      `${fake.origin}/preview/redeem/YWNtZQ/${grant}?renew=1&to=%2Fabout%2F`,
    );
  });

  it('keeps two passes for two branches in one cookie jar', async () => {
    const jar = cookieJar();
    for (const branch of ['main', 'n']) {
      const slug = previewBranchSlug(branch);
      // oxlint-disable-next-line no-await-in-loop -- one entry after the other, into the same jar.
      const code = mint({ pass: await fake.pass({ branch }) });
      // oxlint-disable-next-line no-await-in-loop -- one entry after the other, into the same jar.
      jar.take(await navigate('static', `${PREFIX}/${slug}/about/?conloca_code=${code}`));
    }
    expect(new Set(jar.names())).toEqual(
      new Set([`__Secure-conloca_preview_${MAIN}`, `__Secure-conloca_preview_${N}`]),
    );
    for (const [slug, branch] of [
      [MAIN, 'main'],
      [N, 'n'],
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- one page after the other.
      const page = await navigate('static', `${PREFIX}/${slug}/about/`, jar.for(`${PREFIX}/${slug}/about/`));
      expect(page.status).toBe(200);
      // oxlint-disable-next-line no-await-in-loop -- as above.
      expect(await page.text()).toContain(`"branch":"${branch}"`);
    }
  });

  it('never calls Conloca for a request under the prefix without a cookie', async () => {
    const before = fake.calls.length;
    const landing = await navigate('static', `${PREFIX}/${MAIN}/about/`);
    expect(landing.status).toBe(200);
    expect(await landing.text()).toContain('This is a Conloca preview environment');
    expect(fake.calls.length).toBe(before);
  });
});

describe(`${ADAPTER}: the draft render`, () => {
  it('Astro 7.4 clean Astro.url under the prefix', async () => {
    const page = await navigate('i18n', `${PREFIX}/${N}/fr/about/`, await passCookie('n'));
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('conloca-preview-banner');
    const root = /<html([^>]*)>/u.exec(html)?.[1] ?? '';
    const attribute = (name: string) => new RegExp(` data-${name}="([^"]*)"`, 'u').exec(root)?.[1];
    expect({
      pathname: attribute('pathname'),
      locale: attribute('locale'),
      switcher: attribute('switcher'),
      origin: attribute('origin'),
    }).toEqual({
      pathname: '/fr/about/',
      locale: 'fr',
      switcher: '/fr/about/',
      origin: `${PREFIX}/${N}/fr/about/`,
    });
  });
});

describe(`${ADAPTER}: site pages under the prefix`, () => {
  const sitePages = ['/contact/', '/blog/hello/'];
  const unchanged = () => {
    for (const page of sitePages) fake.verdicts.set(page.replace(/\/$/u, ''), 'unchanged');
  };

  for (const page of sitePages) {
    it(
      FROM_PRODUCTION ? `${page}: built for production, served with the banner` : `${page}: served with the banner`,
      async () => {
        unchanged();
        try {
          const answer = await navigate(
            FROM_PRODUCTION ? 'static-production' : 'static',
            `${PREFIX}/${MAIN}${page}`,
            await passCookie(),
          );
          expect(answer.status).toBe(200);
          expect(answer.headers.get('content-type')).toContain('text/html');
          expect(await answer.text()).toContain('conloca-preview-banner');
        } finally {
          fake.verdicts.clear();
        }
      },
    );
  }

  if (FROM_PRODUCTION) {
    it('/contact/: built without production, leaves for the published page', async () => {
      unchanged();
      try {
        const answer = await navigate('static', `${PREFIX}/${MAIN}/contact/`, await passCookie());
        expect(answer.status).toBe(302);
        expect(answer.headers.get('location')).toBe('/contact/');
      } finally {
        fake.verdicts.clear();
      }
    });

    it('no site → 302 out, with the preview headers, never the not-found page; a CMS page still renders', async () => {
      unchanged();
      try {
        const out = await navigate('nosite-production', `${PREFIX}/${MAIN}/contact/`, await passCookie());
        expect(out.status).toBe(302);
        expect(out.headers.get('location')).toBe('/contact/');
        expectPreviewHeaders(out, 'site page out');
        const cms = await navigate('nosite-production', `${PREFIX}/${MAIN}/about/`, await passCookie());
        expect(cms.status).toBe(200);
        expect(await cms.text()).toContain('conloca-preview-banner');
      } finally {
        fake.verdicts.clear();
      }
    });
  }

  it('shows an ended share before serving a site page', async () => {
    fake.verdicts.set('/contact', 'grant-revoked');
    try {
      const answer = await navigate(
        FROM_PRODUCTION ? 'static-production' : 'static',
        `${PREFIX}/${MAIN}/contact/`,
        await passCookie(),
      );
      expect(answer.status).toBe(410);
      expect(await answer.text()).toContain(HEADINGS['grant-revoked']);
    } finally {
      fake.verdicts.clear();
    }
  });
});

describe(`${ADAPTER}: images`, () => {
  const endpoint = `${PREFIX}/_image`;
  /** Cloudflare's endpoint is the adapter's passthrough: it answers with the original's bytes, not a redirect. */
  const PASSTHROUGH = ADAPTER === 'cloudflare';

  it('a draft <Image> on a static site goes through the endpoint under the prefix, to the original', async () => {
    const html = await (await navigate('static', `${PREFIX}/${MAIN}/about/`, await passCookie())).text();
    const src = imageSrc(html);
    if (ADAPTER === 'netlify') {
      expect(src.startsWith(NETLIFY_CDN)).toBe(true);
      const image = await navigate('static', servedImage(src));
      expect(image.status).toBe(200);
      expect(image.headers.get('content-type') ?? '').toStartWith('image/');
      return;
    }
    expect(src.startsWith(`${endpoint}?href=`)).toBe(true);
    const answer = await navigate('static', src);
    expectPreviewHeaders(answer, 'draft image');
    if (PASSTHROUGH) {
      expect(answer.status).toBe(200);
      expect(answer.headers.get('content-type') ?? '').toStartWith('image/');
      return;
    }
    expect(answer.status).toBe(302);
    expect(answer.headers.get('location') ?? '').toMatch(/^\/_astro\/dot\.[^/]+\.png$/u);
  });

  it('answers an allow-listed remote image and refuses any other', async () => {
    // The fixtures allow 127.0.0.1, where the fake serves an image: the passthrough fetches it, the others redirect.
    const allowed = `${fake.origin}/image.png`;
    const remote = await navigate('static', `${endpoint}?href=${encodeURIComponent(allowed)}`);
    expectPreviewHeaders(remote, 'remote image');
    if (PASSTHROUGH) {
      expect(remote.status).toBe(200);
      expect(remote.headers.get('content-type') ?? '').toStartWith('image/');
    } else {
      expect(remote.status).toBe(302);
      expect(remote.headers.get('location')).toBe(allowed);
    }
    for (const href of ['https://elsewhere.example/a.png', '//elsewhere.example/a.png', endpoint]) {
      // oxlint-disable-next-line no-await-in-loop -- one refusal after the other.
      const refused = await navigate('static', `${endpoint}?href=${encodeURIComponent(href)}`);
      // The passthrough looks its own path up among the assets, and finds nothing there.
      const status = PASSTHROUGH && href === endpoint ? 404 : 403;
      expect(`${href} ${refused.status}`).toBe(`${href} ${status}`);
    }
  });

  it('answers a bare /_image with 404 on a static site', async () => {
    const answer = await navigate('static', `/_image?href=${encodeURIComponent('/_astro/x.png')}`);
    expect(answer.status).toBe(404);
  });

  it('hybrid live page unchanged', async () => {
    const [preview, plain] = await Promise.all(
      ['hybrid', 'hybrid-plain'].map(async (name) => (await navigate(name, '/live/')).text()),
    );
    expect(preview).toBe(plain ?? '');
    const src = imageSrc(preview ?? '');
    expect(src.startsWith(SITE_IMAGE)).toBe(true);
    for (const name of ['hybrid', 'hybrid-plain']) {
      // oxlint-disable-next-line no-await-in-loop -- one host after the other.
      const image = await navigate(name, servedImage(src));
      expect(`${name} ${image.status}`).toBe(`${name} 200`);
      expect(image.headers.get('content-type') ?? '').toStartWith('image/');
    }
  });

  it("a draft <Image> on a hybrid site uses the site's own image URL, no prefix", async () => {
    const html = await (await navigate('hybrid', `${PREFIX}/${MAIN}/about/`, await passCookie())).text();
    const src = imageSrc(html);
    expect(src.startsWith(SITE_IMAGE)).toBe(true);
    const image = await navigate('hybrid', servedImage(src));
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type') ?? '').toStartWith('image/');
  });
});

describe(`${ADAPTER}: headers on every answer under the prefix`, () => {
  it('marks each kind of answer private and uncached, varying on the cookie', async () => {
    const pass = await passCookie();
    const kinds: [string, () => Promise<Response>][] = [
      ['landing', () => navigate('static', `${PREFIX}/${MAIN}/about/`)],
      [
        'entry',
        async () => navigate('static', `${PREFIX}/${MAIN}/about/?conloca_code=${mint({ pass: await fake.pass() })}`),
      ],
      ['exit', () => navigate('static', `${PREFIX}/${MAIN}/__exit?to=%2F`, pass)],
      ['draft', () => navigate('static', `${PREFIX}/${MAIN}/about/`, pass)],
      // A redirect, or on Cloudflare the passthrough's bytes (its 404 here).
      ['image', () => navigate('static', `${PREFIX}/_image?href=${encodeURIComponent('/_astro/x.png')}`)],
    ];
    for (const [kind, request] of kinds) {
      // oxlint-disable-next-line no-await-in-loop -- one request after the other.
      expectPreviewHeaders(await request(), kind);
    }
    for (const [kind, verdict, path] of [
      ['404', 'deleted', '/about'],
      ['retry 503', '5xx', '/about'],
      ['site page', 'unchanged', '/contact'],
    ] as const) {
      fake.verdicts.set(path, verdict);
      // oxlint-disable-next-line no-await-in-loop -- one verdict after the other.
      if (verdict === 'deleted') fake.manifests = (await listing('static')).filter((m) => m.id !== 'vx-about');
      try {
        const site = FROM_PRODUCTION && kind === 'site page' ? 'static-production' : 'static';
        // oxlint-disable-next-line no-await-in-loop -- as above.
        const answer = await navigate(site, `${PREFIX}/${MAIN}${path}/`, pass);
        expect(`${kind} ${answer.status}`).toBe(`${kind} ${{ '404': 404, 'retry 503': 503, 'site page': 200 }[kind]}`);
        expectPreviewHeaders(answer, kind);
      } finally {
        fake.verdicts.clear();
        fake.manifests = null;
      }
    }
  });

  if (ADAPTER === 'netlify') {
    it('netlify-static-cache: the adapter adds no year-long CDN-Cache-Control to a draft', async () => {
      const draft = await navigate('static-cache', `${PREFIX}/${MAIN}/about/`, await passCookie());
      expect(draft.status).toBe(200);
      expect(draft.headers.get('cdn-cache-control')).toBe('no-store');
      expect(draft.headers.get('netlify-cdn-cache-control')).toBe('no-store');
    });
  }
});
