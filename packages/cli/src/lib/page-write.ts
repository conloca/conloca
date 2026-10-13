import { join } from 'node:path';
import { FileSystemContentAPI, normalizeAndValidatePathname, readSitesConfig } from '@conloca/content-api/node';

/** The canonical empty Puck payload — the exact shape the CMS itself writes for a new page (cms-spa PageList handleCreatePage). */
const EMPTY_PUCK_DATA = { root: {}, content: [], zones: {} };

/** Why a write was refused, so callers can react without matching on message text. */
export type PageWriteReason =
  | 'missing_leading_slash'
  | 'invalid_pathname'
  | 'unknown_site'
  | 'no_sites_configured'
  | 'no_default_locale'
  | 'write_failed';

export interface PageWriteInput {
  contentRoot: string;
  site: string;
  collection: string;
  /** Route, starting with '/'. */
  pathname: string;
  title: string;
  /** Puck payload for the page; defaults to the empty page the CMS creates. */
  puckData?: unknown;
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

  const sitesConfig = await readSitesConfig(input.contentRoot);
  // Own-key only: the site name is caller-supplied, so an inherited key like
  // `constructor` must not pass this gate.
  const siteConfig = Object.hasOwn(sitesConfig.sites, input.site) ? sitesConfig.sites[input.site] : undefined;
  if (!siteConfig) {
    const existing = Object.keys(sitesConfig.sites);
    if (existing.length === 0) {
      throw new PageWriteError(
        'no_sites_configured',
        `Site '${input.site}' is not in sites.json and no sites are configured`,
        'site',
      );
    }
    throw new PageWriteError(
      'unknown_site',
      `Site '${input.site}' is not in sites.json. Existing sites: ${existing.join(', ')}`,
      'site',
    );
  }
  const locale = siteConfig.defaultLocale;
  if (!locale) {
    throw new PageWriteError(
      'no_default_locale',
      `Site '${input.site}' has no defaultLocale in sites.json — add one before creating pages`,
      'site',
    );
  }

  const api = await FileSystemContentAPI.create({ contentRoot: input.contentRoot });
  const result = await api.createContent({
    kind: 'page',
    site: input.site,
    collection: input.collection,
    type: 'puck',
    locales: {
      [locale]: {
        pathname,
        meta: { title: input.title },
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

  // createContent reports only the id, so the file location is derived the
  // way the backend derives it (getFilePath): the normalized pathname becomes
  // path segments under {contentRoot}/{site}/{collection}, and '/' is index.
  const basePath = pathname === '/' ? 'index' : pathname.slice(1);
  const filePath = join(input.contentRoot, input.site, input.collection, `${basePath}.${locale}.vxjson`);
  return { id: result.id, pathname, filePath };
}
