import { join } from 'node:path';
import {
  type ContentMetaPatch,
  FileSystemContentAPI,
  type JsonArray,
  type JsonObject,
  type JsonValue,
  normalizeAndValidatePathname,
  normalizePathname,
  readSitesConfig,
} from '@conloca/content-api/node';
import { isRecord } from './is-record.js';

/** The canonical empty Puck payload — the exact shape the CMS itself writes for a new page (cms-spa PageList handleCreatePage). */
const EMPTY_PUCK_DATA = { root: {}, content: [], zones: {} };

/** Why a write was refused, so callers can react without matching on message text. */
export type PageWriteReason =
  | 'missing_leading_slash'
  | 'invalid_pathname'
  | 'unknown_site'
  | 'no_sites_configured'
  | 'no_default_locale'
  | 'write_failed'
  | 'not_found'
  | 'wrong_kind'
  | 'invalid_input';

/**
 * A Puck page's data as the editor stores it in `content.puckData`. A type literal, not an interface, so it stays a
 * JsonValue for the `isPuckData` guard.
 */
export type PuckPayload = { root: JsonObject; content: JsonArray; zones?: JsonObject };

/** Page-settings metadata by meta key, as the editor's page settings name them; '' clears the field. */
export type PageMetaFlags = Partial<Record<'description' | 'ogImage' | 'canonical' | 'robots', string>>;

export interface PageWriteInput {
  contentRoot: string;
  site: string;
  collection: string;
  /** Route, starting with '/'. */
  pathname: string;
  title: string;
  /** Puck payload for the page; defaults to the empty page the CMS creates. */
  puckData?: PuckPayload;
  /** Metadata besides the title; empty values are left out. */
  meta?: PageMetaFlags;
}

export interface PageUpdateInput {
  contentRoot: string;
  site: string;
  /** The page id, or its route starting with '/'. */
  ref: string;
  title?: string;
  /** Replaces the page's Puck payload. */
  puckData?: PuckPayload;
  meta?: PageMetaFlags;
}

export interface PageWriteResult {
  id: string;
  /** The stored pathname, normalized the way the backend stores it. */
  pathname: string;
  filePath: string;
}

/** A refused write: a machine-readable reason, the human message, and the offending input field when there is one. */
export class PageWriteError extends Error {
  constructor(
    public readonly reason: PageWriteReason,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'PageWriteError';
  }
}

/** Whether `value` has the shape of Puck data: a root object, a content list and optional zones. */
export function isPuckData(value: JsonValue): value is PuckPayload {
  return (
    isRecord(value) &&
    isRecord(value.root) &&
    Array.isArray(value.content) &&
    (value.zones === undefined || isRecord(value.zones))
  );
}

/** The metadata patch `flags` ask for: given values are set, an empty one clears the stored field. */
export function metaPatchOf(flags: PageMetaFlags): ContentMetaPatch {
  return Object.fromEntries(
    Object.entries(flags)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, value === '' ? null : value]),
  );
}

/** The default locale of `site` in sites.json, refusing a site that is missing or has none. */
export async function siteLocale(contentRoot: string, site: string): Promise<string> {
  const sitesConfig = await readSitesConfig(contentRoot);
  // Own-key only: the site name is caller-supplied, so an inherited key like
  // `constructor` must not pass this gate.
  const siteConfig = Object.hasOwn(sitesConfig.sites, site) ? sitesConfig.sites[site] : undefined;
  if (!siteConfig) {
    const existing = Object.keys(sitesConfig.sites);
    if (existing.length === 0) {
      throw new PageWriteError(
        'no_sites_configured',
        `Site '${site}' is not in sites.json and no sites are configured`,
        'site',
      );
    }
    throw new PageWriteError(
      'unknown_site',
      `Site '${site}' is not in sites.json. Existing sites: ${existing.join(', ')}`,
      'site',
    );
  }
  const locale = siteConfig.defaultLocale;
  if (!locale) {
    throw new PageWriteError(
      'no_default_locale',
      `Site '${site}' has no defaultLocale in sites.json — add one before creating pages`,
      'site',
    );
  }
  return locale;
}

/**
 * Where the backend stores a page (its getFilePath): the normalized pathname
 * becomes path segments under {contentRoot}/{site}/{collection}, and '/' is index.
 */
function pageFilePath(
  contentRoot: string,
  site: string,
  collection: string,
  pathname: string,
  locale: string,
  ext: string,
): string {
  const basePath = pathname === '/' ? 'index' : pathname.slice(1);
  return join(contentRoot, site, collection, `${basePath}.${locale}.${ext}`);
}

/** Write one Puck page in the site's default locale and return where it landed. */
export async function writePage(input: PageWriteInput): Promise<PageWriteResult> {
  if (!input.pathname.startsWith('/')) {
    throw new PageWriteError(
      'missing_leading_slash',
      `pathname must start with '/' (got '${input.pathname}')`,
      'pathname',
    );
  }
  const pathnameCheck = normalizeAndValidatePathname(input.pathname);
  if (!pathnameCheck.valid) {
    throw new PageWriteError(
      'invalid_pathname',
      `Invalid pathname '${input.pathname}': ${pathnameCheck.message}`,
      'pathname',
    );
  }
  const pathname = pathnameCheck.value;
  const locale = await siteLocale(input.contentRoot, input.site);

  const api = await FileSystemContentAPI.create({ contentRoot: input.contentRoot });
  const result = await api.createContent({
    kind: 'page',
    site: input.site,
    collection: input.collection,
    type: 'puck',
    locales: {
      [locale]: {
        pathname,
        meta: {
          title: input.title,
          ...Object.fromEntries(Object.entries(input.meta ?? {}).filter(([, value]) => value)),
        },
        content: { puckData: input.puckData ?? EMPTY_PUCK_DATA },
      },
    },
  });
  if (!result.success || !result.id) {
    throw new PageWriteError(
      'write_failed',
      result.error?.message ?? `Create failed (${result.reason ?? 'unknown reason'})`,
      result.field,
    );
  }

  // createContent reports only the id, so the file location is derived the way the backend derives it.
  const filePath = pageFilePath(input.contentRoot, input.site, input.collection, pathname, locale, 'vxjson');
  return { id: result.id, pathname, filePath };
}

/**
 * Update the title, metadata or Puck payload of one page in the site's default
 * locale, found by id or by route. Only the parts given are written.
 */
export async function updatePage(input: PageUpdateInput): Promise<PageWriteResult> {
  const { contentRoot, site, ref, puckData } = input;
  const meta: ContentMetaPatch = {
    ...(input.title === undefined ? {} : { title: input.title }),
    ...metaPatchOf(input.meta ?? {}),
  };
  const writesMeta = Object.keys(meta).length > 0;
  if (!writesMeta && !puckData) {
    throw new PageWriteError('invalid_input', 'nothing to update: pass --content, --title or a metadata flag');
  }
  const locale = await siteLocale(contentRoot, site);

  const api = await FileSystemContentAPI.create({ contentRoot });
  const manifest = ref.startsWith('/')
    ? api.getSite(site)?.getByPathname(normalizePathname(ref), locale)
    : await api.getContent(ref);
  if (manifest && manifest.kind !== 'page') {
    const kind = manifest.kind === 'data' ? 'a data entry' : 'a fragment';
    throw new PageWriteError('wrong_kind', `"${ref}" is ${kind}, not a page`);
  }
  const localized = manifest?.site === site ? manifest.locales[locale] : undefined;
  if (!manifest || !localized?.pathname) {
    throw new PageWriteError('not_found', `no page "${ref}" in site ${site}`);
  }
  if (puckData && manifest.type !== 'puck') {
    throw new PageWriteError('wrong_kind', `"${ref}" is an MDX page; --content writes Puck pages only`);
  }

  const result = await api.updateLocalized({
    id: manifest.id,
    locale,
    etag: localized.etag,
    data: { ...(writesMeta ? { meta } : {}), ...(puckData ? { content: { puckData } } : {}) },
  });
  if (!result.success) {
    throw new PageWriteError(
      'write_failed',
      result.error?.message ?? `Update failed (${result.reason ?? 'unknown reason'})`,
    );
  }

  // shortcut: an MDX page kept in a separate mdxPages folder is reported at its content-root path; upgrade when the content API reports file paths.
  const ext = manifest.type === 'mdx' ? 'mdx' : 'vxjson';
  const filePath = pageFilePath(contentRoot, site, manifest.collection, localized.pathname, locale, ext);
  return { id: manifest.id, pathname: localized.pathname, filePath };
}
