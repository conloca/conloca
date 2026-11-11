import { localesOf } from './content-utils.js';
import type { ContentManifest } from './types.js';

const ALL_LOCALES_PREFIX = 'all-locales-v1:';

interface ContentEtagMatch {
  matches: boolean;
  currentEtag: string;
}

/** A snapshot of existing locale validators; removed locale slots do not participate. */
export function localeEtags(manifest: Pick<ContentManifest, 'locales'> | null): Record<string, string> {
  if (!manifest) return {};
  return Object.fromEntries(Array.from(localesOf(manifest), (version) => [version.locale, version.etag]));
}

/** An opaque precondition for exactly the locale versions the caller saw, including their names. */
export function contentEtag(etags: Readonly<Record<string, string>>): string {
  // Default code-unit order is identical in the browser and server, unlike locale-aware collation.
  const locales: string[] = [];
  for (const locale of Object.keys(etags)) {
    const before = locales.findIndex((existing) => locale < existing);
    locales.splice(before < 0 ? locales.length : before, 0, locale);
  }
  return `${ALL_LOCALES_PREFIX}${encodeURIComponent(JSON.stringify(locales.map((locale) => [locale, etags[locale]])))}`;
}

/** Checks the complete set, or the backend's existing set of legacy locale validators. */
export function matchesContentEtag(
  etag: string,
  etags: Readonly<Record<string, string>>,
  legacyEtags: Readonly<Record<string, string>> = etags,
): ContentEtagMatch {
  const complete = etag.startsWith(ALL_LOCALES_PREFIX);
  const currentEtag = complete ? contentEtag(etags) : (Object.values(legacyEtags)[0] ?? '');
  return {
    matches: complete ? etag === currentEtag : Object.values(legacyEtags).includes(etag),
    currentEtag,
  };
}
