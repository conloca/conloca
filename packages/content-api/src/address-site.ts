import type { SitesConfig } from './types.js';

/** The inner site whose `domains` and `base` give a project its address: `default`, else the only site; null otherwise. */
export function addressSiteName(config: SitesConfig): string | null {
  if (Object.hasOwn(config.sites, 'default')) return 'default';
  const names = Object.keys(config.sites);
  return names.length === 1 ? (names[0] ?? null) : null;
}

const SITE_BASE = /^(\/[A-Za-z0-9._~-]+)*\/$/;

/** True when `base` is a path Astro can serve a site under: `/`-delimited plain segments, never `.` or `..`. */
export function isValidSiteBase(base: string): boolean {
  return (
    base.length <= 256 &&
    SITE_BASE.test(base) &&
    !base.split('/').some((segment) => segment === '.' || segment === '..')
  );
}
