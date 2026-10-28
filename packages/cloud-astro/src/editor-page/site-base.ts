import { addressSiteName, type SitesConfig } from '@conloca/content-api';

/** The warning when Astro's base differs from the address site's base in sites.json, else undefined. */
export function baseMismatch(sites: SitesConfig, astroBase: string): string | undefined {
  const name = addressSiteName(sites);
  if (name === null) return undefined;
  const base = astroBase.endsWith('/') ? astroBase : `${astroBase}/`;
  const siteBase = sites.sites[name]?.base ?? '/';
  if (base === siteBase) return undefined;
  return `Astro's base is ${base} but sites.json gives the site "${name}" base ${siteBase}: the workspace editor looks for the editor page under ${siteBase}_conloca/editor/ and will not find it. Make them match.`;
}
