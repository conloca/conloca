/**
 * Pick the site to operate on. A hardcoded 'default' silently yields zero
 * pages for any project whose site is named anything else, so prefer the
 * explicit option, then the first site declared in sites.json. Mirrors the
 * fallback chain in FileSystemContentAPI.
 */
export function resolveSiteName(configured: string | undefined, sites: Record<string, unknown>): string {
  if (configured) return configured;
  return Object.keys(sites)[0] ?? 'default';
}
