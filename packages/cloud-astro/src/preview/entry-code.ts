import { type ShareEndedKind, shareEndedOf } from './_dispatch.js';

/**
 * Trades the single-use code from a preview link for the pass, server to server, so no pass travels in a link,
 * a browser history or an access log. Conloca accepts a code once, within a minute, and only for the origin,
 * repository and site it was issued for. Only `unknown` (a code already used, or never issued) lets the caller fall
 * back to a pass the visitor already holds; an ended link or any other failure must not open some other preview.
 */
export type EntryCodeResult =
  | { ok: true; pass: string }
  | { ok: false; kind: 'unknown' }
  | { ok: false; kind: 'ended'; ended: { verdict: ShareEndedKind; sharedBy: string } }
  | { ok: false; kind: 'unavailable' };

export async function exchangeEntryCode(input: {
  saasEndpoint: string;
  code: string;
  origin: string;
  repo: string;
  siteId: string;
  fetchFn?: typeof fetch;
}): Promise<EntryCodeResult> {
  const fetchImpl = input.fetchFn ?? fetch;
  try {
    const response = await fetchImpl(`${input.saasEndpoint}/preview/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: input.code, origin: input.origin, repo: input.repo, siteId: input.siteId }),
      redirect: 'manual',
    });
    if (response.status === 404) {
      const body: unknown = await response.json().catch(() => null);
      const error = typeof body === 'object' && body !== null && 'error' in body ? body.error : undefined;
      return error === 'code-unknown' ? { ok: false, kind: 'unknown' } : UNAVAILABLE;
    }
    if (response.status === 410) {
      const ended = await shareEndedOf(response);
      return ended === null
        ? UNAVAILABLE
        : { ok: false, kind: 'ended', ended: { verdict: ended.kind, sharedBy: ended.sharedBy } };
    }
    if (response.status !== 200) return UNAVAILABLE;
    const body: unknown = await response.json();
    const pass = typeof body === 'object' && body !== null && 'pass' in body ? body.pass : undefined;
    return typeof pass === 'string' && pass !== '' ? { ok: true, pass } : UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

const UNAVAILABLE: EntryCodeResult = { ok: false, kind: 'unavailable' };
