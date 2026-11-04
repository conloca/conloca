/**
 * A local stand-in for the Conloca endpoints a preview server calls: the keys, the code exchange, page-status, draft
 * content and the branch's page listing. Every page-status verdict and every ended share link is one setting away, so
 * the D3 Cloudflare Worker and each d8 host run the same verdict table.
 */

import { randomBytes } from 'node:crypto';
import type { ContentManifest, LocalizedEntry } from '@conloca/content-api';
import { FileSystemContentAPI } from '@conloca/content-api/node';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { PNG_1X1 } from '../test-editor-build/fixture-site.js';

/** Who the fixtures are built for: the audience is the repository, as the build bakes it. */
export const FIXTURE = { org: 'acme', repo: 'acme/fixture', siteId: 'default', branch: 'main' } as const;

export type ShareEnded = 'grant-expired' | 'grant-revoked' | 'draft-published' | 'draft-discarded';
export const SHARE_ENDED: readonly ShareEnded[] = [
  'grant-expired',
  'grant-revoked',
  'draft-published',
  'draft-discarded',
];

/** Page-status answers: 304, 200, 404, 302, 410 naming the ended link, and a 503. */
export type Verdict = 'unchanged' | 'changed' | 'deleted' | 'redirect' | ShareEnded | '5xx';

/** What the exchange answers for a code: a pass, an ended link, or a 503. */
export type CodeOutcome = { pass: string } | { ended: ShareEnded } | 'unavailable';

/** Where page-status sends a `redirect` verdict. */
export const REDIRECT_TARGET = '/contact/';
export const SHARED_BY = 'Ada';

/** The heading of the page each ended link and a failed page-status answer with. */
export const HEADINGS = {
  'grant-expired': 'This preview link has expired',
  'grant-revoked': 'This preview link was turned off',
  'draft-published': 'This draft was published',
  'draft-discarded': 'This draft was discarded',
  '5xx': "Preview couldn't load the draft",
} satisfies Record<ShareEnded | '5xx', string>;

/** What the draft of a CMS page says (`draftOf`): no published page holds it. */
export const DRAFT_TEXT = 'Draft words from the branch';

/**
 * What a draft page answers under each verdict: `location` is under the preview route and slug, `shows` text the page
 * holds. A deleted page is missing from the branch's listing too, so the site's own not-found answers.
 */
export const VERDICT_TABLE: {
  verdict: Verdict;
  status: number;
  banner: boolean;
  location?: string;
  shows?: string;
}[] = [
  { verdict: 'unchanged', status: 200, banner: false },
  { verdict: 'changed', status: 200, banner: true, shows: DRAFT_TEXT },
  { verdict: 'deleted', status: 404, banner: false },
  { verdict: 'redirect', status: 302, banner: false, location: REDIRECT_TARGET },
  ...SHARE_ENDED.map((verdict) => ({ verdict, status: 410, banner: false, shows: HEADINGS[verdict] })),
  { verdict: '5xx', status: 503, banner: false, shows: HEADINGS['5xx'] },
];

/** The draft of the CMS page `id` in `contentRoot`: its published entry with every Hero saying {@link DRAFT_TEXT}. */
export async function draftOf(contentRoot: string, id: string, locale = 'en'): Promise<LocalizedEntry> {
  const entry = await (await FileSystemContentAPI.create({ contentRoot })).getLocalized(id, locale);
  if (entry === null) throw new Error(`no ${id} ${locale} in ${contentRoot}`);
  const content = structuredClone(entry.localized.content);
  const puck: unknown = content.puckData;
  const items = typeof puck === 'object' && puck !== null && 'content' in puck ? puck.content : undefined;
  if (!Array.isArray(items) || items.length === 0) throw new Error(`${id} holds no Puck block to change`);
  for (const item of items) Object.assign(item.props, { text: DRAFT_TEXT });
  return { ...entry, localized: { ...entry.localized, etag: `${entry.localized.etag}-draft`, content } };
}

/** The branch's images: an upload not yet published, and a file committed on the branch that no deploy holds. */
export const BRANCH_MEDIA = { upload: 'uploads/branch.png', committed: 'new.png' } as const;
/** How the draft links each: the upload by its draft address, the committed file under the media folder's base. */
export const BRANCH_MEDIA_LINKS = [`/api/v1/assets/serve/${BRANCH_MEDIA.upload}`, `/assets/${BRANCH_MEDIA.committed}`];

/** `entry` with every Hero also showing the branch's images ({@link MEDIA_HERO}). */
export function withBranchMedia(entry: LocalizedEntry): LocalizedEntry {
  const content = structuredClone(entry.localized.content);
  const puck: unknown = content.puckData;
  const items = typeof puck === 'object' && puck !== null && 'content' in puck ? puck.content : undefined;
  if (!Array.isArray(items)) throw new Error(`${entry.id} holds no Puck blocks`);
  for (const item of items) Object.assign(item.props, { images: BRANCH_MEDIA_LINKS });
  return { ...entry, localized: { ...entry.localized, content } };
}

/** A Hero that also renders the `images` a draft gives it, each marked `data-media`. */
export const MEDIA_HERO = [
  "import styles from './hero.module.css';",
  '',
  'export const Hero = {',
  '  fields: {},',
  '  render: ({ text, images }: { text?: string; images?: string[] }) => (',
  '    <section className={styles.hero}>{text ?? \'Hero\'}{images?.map((src) => <img key={src} src={src} alt="" data-media="" />)}</section>',
  '  ),',
  '};',
  '',
].join('\n');

/** Every `data-media` image's src in `html`. */
export const mediaSrcs = (html: string): string[] =>
  [...html.matchAll(/<img src="([^"]+)" alt="" data-media=""/gu)].map((match) => match[1] ?? '');

export interface PassClaims {
  branch?: string;
  /** A share pass: its link's id (22 characters, as Conloca mints them). */
  grant?: string;
}

export interface FakeConloca {
  origin: string;
  /** Every request's path and query, in order. */
  calls: string[];
  /** Page-status verdict by page path (`/about`); `changed` otherwise. */
  verdicts: Map<string, Verdict>;
  /** The branch's page listing; null answers 404, so the reader keeps the build's own. */
  manifests: ContentManifest[] | null;
  /** The branch's changed entries by `"<id> <locale>"`: embedded in every `changed` answer and served as content. */
  drafts: Map<string, LocalizedEntry>;
  pass(claims?: PassClaims): Promise<string>;
  /**
   * A fresh single-use code in Conloca's `<org token>.<secret>` shape, issued for the site at `origin` and answered
   * with `outcome`; as Conloca, the exchange refuses it from another host, repository or site.
   */
  code(outcome: CodeOutcome, origin: string): string;
  stop(): Promise<void>;
}

const ORG_TOKEN = Buffer.from(FIXTURE.org).toString('base64url');

function pageStatus(verdict: Verdict, drafts: ReadonlyMap<string, LocalizedEntry>): Response {
  switch (verdict) {
    case 'unchanged':
      return new Response(null, { status: 304 });
    case 'changed':
      return Response.json({ embedded: Object.fromEntries(drafts) });
    case 'deleted':
      return new Response(null, { status: 404 });
    case 'redirect':
      return new Response(null, { status: 302, headers: { location: REDIRECT_TARGET } });
    case '5xx':
      return new Response('down', { status: 503 });
    default:
      return Response.json({ error: verdict, sharedBy: SHARED_BY }, { status: 410 });
  }
}

export async function startFakeConloca(): Promise<FakeConloca> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  const codes = new Map<string, { outcome: CodeOutcome; origin: string }>();
  // Every pass this fake signed: the branch endpoints answer only those, as Conloca answers only its own.
  const passes = new Set<string>();
  const bearer = (request: Request) =>
    passes.has((request.headers.get('authorization') ?? '').replace(/^Bearer /u, ''));

  const fake: FakeConloca = {
    origin: '',
    calls: [],
    verdicts: new Map(),
    manifests: null,
    drafts: new Map(),
    async pass({ branch = FIXTURE.branch, grant }: PassClaims = {}) {
      const now = Math.floor(Date.now() / 1000);
      return new SignJWT({
        scope: 'preview',
        org: FIXTURE.org,
        repo: FIXTURE.repo,
        site_id: FIXTURE.siteId,
        branch,
        // A branch without a build of its own borrows the default branch's server.
        ...(branch === FIXTURE.branch ? {} : { served_by: FIXTURE.branch }),
        ...(grant === undefined ? {} : { grant, grant_exp: now + 86_400, shared_by: SHARED_BY }),
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuedAt(now)
        .setExpirationTime(now + 600)
        .setAudience(FIXTURE.repo)
        .sign(privateKey)
        .then((jwt) => {
          passes.add(jwt);
          return jwt;
        });
    },
    code(outcome, origin) {
      const code = `${ORG_TOKEN}.${randomBytes(16).toString('base64url')}`;
      codes.set(code, { outcome, origin });
      return code;
    },
    stop: async () => server.stop(true),
  };

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const { pathname } = url;
      fake.calls.push(`${pathname}${url.search}`);
      if (pathname === '/.well-known/jwks.json') return Response.json({ keys: [jwk] });
      if (pathname === '/preview/exchange' && request.method === 'POST') {
        // As the exchange endpoint does: a malformed body 400, an unknown code 404, another host, repository or site 403.
        const body: unknown = await request.json().catch(() => null);
        const field = (name: string) =>
          typeof body === 'object' && body !== null && name in body ? Reflect.get(body, name) : undefined;
        const [code, origin, repo, siteId] = ['code', 'origin', 'repo', 'siteId'].map(field);
        if (![code, origin, repo, siteId].every((value) => typeof value === 'string')) {
          return Response.json({ error: 'invalid-request' }, { status: 400 });
        }
        const record = codes.get(String(code));
        codes.delete(String(code));
        if (record === undefined) return Response.json({ error: 'code-unknown' }, { status: 404 });
        if (
          URL.parse(String(origin))?.host !== new URL(record.origin).host ||
          repo !== FIXTURE.repo ||
          siteId !== FIXTURE.siteId
        ) {
          return Response.json({ error: 'code-mismatch' }, { status: 403 });
        }
        const { outcome } = record;
        if (outcome === 'unavailable') return new Response('down', { status: 503 });
        if ('ended' in outcome) return Response.json({ error: outcome.ended, sharedBy: SHARED_BY }, { status: 410 });
        return Response.json({ pass: outcome.pass });
      }
      const branchRead =
        pathname.startsWith('/preview/page-status/') ||
        pathname.startsWith('/preview/content/') ||
        pathname === '/preview/manifests' ||
        pathname.startsWith('/preview/media/');
      if (branchRead && !bearer(request)) return Response.json({ error: 'unauthorized' }, { status: 401 });
      if (pathname.startsWith('/preview/page-status/')) {
        const page = `/${pathname.slice('/preview/page-status/'.length)}`.replace(/(.)\/+$/u, '$1');
        return pageStatus(fake.verdicts.get(page) ?? 'changed', fake.drafts);
      }
      if (pathname.startsWith('/preview/content/')) {
        const [id = '', locale = ''] = pathname.slice('/preview/content/'.length).split('/');
        const draft = fake.drafts.get(`${id} ${locale}`);
        // An entry the branch did not change is the build's own: the reader falls back to the baseline.
        return draft === undefined ? new Response(null, { status: 304 }) : Response.json(draft);
      }
      if (pathname === '/preview/manifests') {
        return fake.manifests === null ? new Response(null, { status: 404 }) : Response.json(fake.manifests);
      }
      if (pathname.startsWith('/preview/media/')) {
        const path = pathname.slice('/preview/media/'.length);
        if (path !== BRANCH_MEDIA.upload && path !== BRANCH_MEDIA.committed) return new Response(null, { status: 404 });
        return new Response(PNG_1X1, {
          headers: {
            'content-type': 'image/png',
            'x-content-type-options': 'nosniff',
            'content-security-policy': "default-src 'none'; sandbox",
          },
        });
      }
      // The allow-listed remote image the fixtures' image endpoint may answer.
      if (pathname === '/image.png') return new Response(PNG_1X1, { headers: { 'content-type': 'image/png' } });
      return new Response('not found', { status: 404 });
    },
  });
  fake.origin = `http://127.0.0.1:${server.port}`;
  return fake;
}
