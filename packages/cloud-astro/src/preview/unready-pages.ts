import type { ContentManifest } from '@conloca/content-api';

/** A page a push would hold back, as the preview banner names it. */
export type UnreadyPage = { title: string; path?: string; reason: 'conflict' | 'lfs' };
export type UnreadyKey = { id: string; locale: string; reason: 'conflict' | 'lfs' };

function isUnreadyKey(value: unknown): value is UnreadyKey {
  if (typeof value !== 'object' || value === null || !('id' in value && 'locale' in value && 'reason' in value))
    return false;
  return (
    typeof value.id === 'string' &&
    typeof value.locale === 'string' &&
    (value.reason === 'conflict' || value.reason === 'lfs')
  );
}

/** The pages `/preview/unready-pages` names; `[]` on any failure, so the page renders without the banner line. */
export async function fetchUnreadyKeys(fetchImpl: typeof fetch, endpoint: string, jwt: string): Promise<UnreadyKey[]> {
  try {
    const response = await fetchImpl(`${endpoint}/preview/unready-pages`, {
      headers: { authorization: `Bearer ${jwt}` },
    });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const pages = typeof body === 'object' && body !== null && 'pages' in body ? body.pages : undefined;
    return Array.isArray(pages) ? pages.filter(isUnreadyKey) : [];
  } catch {
    return [];
  }
}

export function titleUnreadyPages(keys: readonly UnreadyKey[], manifests: readonly ContentManifest[]): UnreadyPage[] {
  return keys.map(({ id, locale, reason }) => {
    const entry = manifests.find((m) => m.id === id)?.locales[locale];
    const path = entry?.pathname;
    return { title: entry?.meta?.title || entry?.name || id, ...(path === undefined ? {} : { path }), reason };
  });
}

/**
 * The pages a push would hold back, for a page served without a {@link PreviewContentAPI} (one the preview build
 * prerendered). `[]` on any failure.
 */
export async function loadUnreadyPages(fetchImpl: typeof fetch, endpoint: string, jwt: string): Promise<UnreadyPage[]> {
  const listing = fetchImpl(`${endpoint}/preview/manifests`, { headers: { authorization: `Bearer ${jwt}` } })
    .then(async (r) => {
      const data: unknown = r.ok ? await r.json() : [];
      return Array.isArray(data) ? data.filter(isListed) : [];
    })
    .catch((): ContentManifest[] => []);
  const [keys, manifests] = await Promise.all([fetchUnreadyKeys(fetchImpl, endpoint, jwt), listing]);
  return titleUnreadyPages(keys, manifests);
}

/** Enough of a manifest for {@link titleUnreadyPages}: an id and its locales. */
function isListed(value: unknown): value is ContentManifest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'locales' in value &&
    typeof value.locales === 'object' &&
    value.locales !== null
  );
}
