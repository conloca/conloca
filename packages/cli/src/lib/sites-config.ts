import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SitesConfig } from '@conloca/content-api';

/**
 * A new site's one language. Its routing serves a single locale, `en` unless
 * told otherwise, while the editor offers a version of each page in every
 * language listed here, so any other would collect translations no page shows.
 */
const DEFAULT_LOCALES = ['en'];

/** A sites.json listing only `siteName`, with the locales and default locale a new site gets. */
export function newSitesConfig(siteName: string): SitesConfig {
  return {
    sites: { [siteName]: { locales: [...DEFAULT_LOCALES], defaultLocale: 'en' } },
    globalLocales: [...DEFAULT_LOCALES],
  };
}

export type EnsureSiteResult = {
  /** Path of the sites.json that was read or written. */
  path: string;
  /** Whether a readable sites.json was already there. */
  existed: boolean;
  /** False when the site was already listed, so nothing was written. */
  added: boolean;
};

/**
 * Record `siteName` in `<contentPath>/sites.json`, creating the file when it is
 * missing and migrating the older format that kept site entries at the top
 * level. A site that is already listed is left exactly as it is, so repeated
 * runs never clobber a hand-edited config.
 */
export async function ensureSiteInSitesConfig(contentPath: string, siteName: string): Promise<EnsureSiteResult> {
  const path = join(contentPath, 'sites.json');
  let sitesConfig: SitesConfig = { sites: {}, globalLocales: [...DEFAULT_LOCALES] };
  let existed = false;

  try {
    const parsed = JSON.parse(await readFile(path, 'utf-8'));
    if (parsed.sites) {
      sitesConfig = parsed;
    } else {
      // Old format: the parsed object is the site map itself.
      sitesConfig.sites = parsed;
    }
    existed = true;
  } catch {
    // Missing or unreadable, so start from the defaults above.
  }

  // Own-key only: the site name is caller-supplied, so an inherited key like
  // `constructor` must not read as an already-listed site and skip the write.
  if (Object.hasOwn(sitesConfig.sites, siteName)) {
    return { path, existed, added: false };
  }

  sitesConfig.sites[siteName] = { locales: [...DEFAULT_LOCALES], defaultLocale: 'en' };
  await writeFile(path, `${JSON.stringify(sitesConfig, null, 2)}\n`, 'utf-8');

  return { path, existed, added: true };
}
