import type { LocalizedEntry } from '@conloca/content-api';
import type { PreviewContext } from './middleware.js';

/**
 * Four-verdict response of the endpoint's page-status route.
 *
 * - `unchanged` — page render graph is byte-equivalent to the build this
 *   deployment serves (nothing edited or committed on the branch since that
 *   build's registered commit); serve the ordinary page.
 * - `changed` — page or one of its dependencies has been edited in the
 *   branch; carry the (possibly empty) embedded payload map into the
 *   preview reader so dependency reads short-circuit when the endpoint
 *   bundled them inline.
 * - `deleted` — branch removed the page; the site's own not-found flow
 *   answers.
 * - `redirect` — branch installed a redirect at the page's path; callers
 *   issue a 302 (we deliberately downgrade 301 to 302 — see fetchPageStatus).
 * - an ended share link (`grant-revoked`, `grant-expired`, `draft-published`, `draft-discarded`) — Conloca answers 410 and names who shared the link; the site shows that page, never the published one.
 *
 * The verdict-to-response mapping lives in the site middleware
 * (`./site-middleware.ts`), which renders through the site's own route.
 */
export type PageStatus =
  | { kind: 'unchanged' }
  | { kind: 'changed'; embedded: ReadonlyMap<string, LocalizedEntry> }
  | { kind: 'deleted' }
  | { kind: 'redirect'; target: string }
  | { kind: ShareEndedKind; sharedBy: string };

/** Why a share link no longer opens: turned off, expired, or its draft was published or discarded. */
export type ShareEndedKind = 'grant-revoked' | 'grant-expired' | 'draft-published' | 'draft-discarded';

const SHARE_ENDED: ReadonlySet<string> = new Set([
  'grant-revoked',
  'grant-expired',
  'draft-published',
  'draft-discarded',
]);

export function isShareEndedKind(value: string): value is ShareEndedKind {
  return SHARE_ENDED.has(value);
}

interface FetchPageStatusInput {
  saasEndpoint: string;
  ctx: PreviewContext;
  path: string;
  /** Site/locale the render resolves against. Unset ⇒ the endpoint's defaults
   *  (`default`/`en`) — fine for single-site, wrong for anything else, and the
   *  embedded map is locale-keyed so a mismatch silently never hits. */
  site?: string;
  locale?: string;
  /** The commit this preview artifact was built from; the endpoint compares the branch's latest commit with it. */
  build?: string;
  fetchFn?: typeof fetch;
}

/**
 * Calls `GET {endpoint}/preview/page-status/{path}` with the preview JWT and
 * decodes the four-verdict response into a {@link PageStatus} value.
 *
 * 301 responses are deliberately surfaced as `{ kind: 'redirect' }` with
 * the same target as 302 — the downstream caller always emits 302 so
 * a stale preview redirect cannot be cached by intermediaries.
 */
export async function fetchPageStatus(input: FetchPageStatusInput): Promise<PageStatus> {
  const fetchImpl = input.fetchFn ?? fetch;
  const normalisedPath = input.path.replace(/^\/+/u, '');
  const query = new URLSearchParams();
  if (input.locale !== undefined) query.set('locale', input.locale);
  if (input.site !== undefined) query.set('site', input.site);
  if (input.build !== undefined) query.set('build', input.build);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  const url = `${input.saasEndpoint}/preview/page-status/${normalisedPath}${suffix}`;
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${input.ctx.jwt}` },
    redirect: 'manual',
  });

  if (response.status === 304) return { kind: 'unchanged' };
  if (response.status === 404) return { kind: 'deleted' };
  if (response.status === 301 || response.status === 302) {
    const target = response.headers.get('location') ?? '/';
    return { kind: 'redirect', target };
  }
  if (response.status === 200) {
    const data: unknown = await response.json();
    return { kind: 'changed', embedded: decodeEmbedded(data) };
  }
  if (response.status === 410) {
    const ended = await shareEndedOf(response);
    if (ended !== null) return ended;
  }
  throw new Error(`preview page-status ${input.path}: ${response.status}`);
}

/**
 * Decodes the optional `{ embedded: { "${id} ${locale}": LocalizedEntry } }`
 * payload from a 200 page-status response into the strongly-typed map
 * the {@link import('./content-api.js').PreviewContentAPI} consumes. Unknown
 * fields are ignored; malformed entries are dropped silently rather than
 * throwing — a bad embedded payload should degrade to a network fetch, not
 * 500 the page.
 */
function decodeEmbedded(data: unknown): ReadonlyMap<string, LocalizedEntry> {
  if (typeof data !== 'object' || data === null) return new Map();
  const embedded = (data as { embedded?: unknown }).embedded;
  if (typeof embedded !== 'object' || embedded === null) return new Map();
  const map = new Map<string, LocalizedEntry>();
  for (const [key, value] of Object.entries(embedded as Record<string, unknown>)) {
    if (isLocalizedEntry(value)) {
      map.set(key, value);
    }
  }
  return map;
}

function isLocalizedEntry(value: unknown): value is LocalizedEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { id?: unknown; localized?: unknown };
  if (typeof v.id !== 'string') return false;
  if (typeof v.localized !== 'object' || v.localized === null) return false;
  const l = v.localized as { etag?: unknown; locale?: unknown; content?: unknown };
  return typeof l.etag === 'string' && typeof l.locale === 'string' && typeof l.content === 'object';
}

/** The ended-link verdict a 410 names, or null when the body is not one. */
export async function shareEndedOf(response: Response): Promise<{ kind: ShareEndedKind; sharedBy: string } | null> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null) return null;
  const error = 'error' in body ? body.error : undefined;
  const sharedBy = 'sharedBy' in body ? body.sharedBy : undefined;
  if (typeof error !== 'string' || !isShareEndedKind(error)) return null;
  return { kind: error, sharedBy: typeof sharedBy === 'string' ? sharedBy : '' };
}
