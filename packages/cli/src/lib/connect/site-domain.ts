import { addressSiteName, isValidSiteBase, type SitesConfig } from '@conloca/content-api';
import { isRecord } from '../is-record.js';
import { jsonLike, type StepResult } from './step.js';

function isSitesConfig(value: unknown): value is SitesConfig {
  return (
    isRecord(value) &&
    isRecord(value.sites) &&
    Object.values(value.sites).every(
      (site) =>
        isRecord(site) &&
        Array.isArray(site.locales) &&
        typeof site.defaultLocale === 'string' &&
        (site.domains === undefined || isRecord(site.domains)) &&
        (site.base === undefined || typeof site.base === 'string'),
    )
  );
}

/** Astro's `base` the way sites.json stores it: leading and trailing `/`. */
function siteBase(base: string | null): string {
  const leading = base === null || base.startsWith('/') ? (base ?? '/') : `/${base}`;
  return leading.endsWith('/') ? leading : `${leading}/`;
}

/**
 * Write where the site is served into sites.json: the host of Astro's `site` (without a port) under the default locale
 * of the site `addressSiteName` picks, and Astro's `base` when it is not `/`. A different value already there is kept;
 * the rewrite that would replace it comes back as `replacement`.
 */
export function writeSiteAddress(input: { path: string; text: string; site: string; base: string | null }): StepResult {
  const { path, text, site } = input;
  const url = URL.canParse(site) ? new URL(site) : null;
  if (url?.protocol !== 'https:') {
    return { state: 'needs-you', message: `Astro's site must be an https URL, got ${site}`, edits: [] };
  }
  const base = siteBase(input.base);
  if (!isValidSiteBase(base)) {
    return {
      state: 'needs-you',
      message: `Astro's base ${input.base} is not a path the editor can open`,
      edits: [],
    };
  }
  let config: unknown;
  try {
    config = JSON.parse(text);
  } catch {
    return { state: 'failed', message: `${path} is not valid JSON`, edits: [] };
  }
  if (!isSitesConfig(config)) {
    return { state: 'failed', message: `${path} has no readable sites map`, edits: [] };
  }
  const name = addressSiteName(config);
  const entry = name === null ? undefined : config.sites[name];
  if (name === null || entry === undefined) {
    return {
      state: 'needs-you',
      message: `${path} lists several sites and none is named default; add the domain to the right one yourself`,
      lines: [`"domains": { "<locale>": "${url.hostname}" }`, ...(base === '/' ? [] : [`"base": "${base}"`])],
      edits: [],
    };
  }
  const host = url.hostname;
  const locale = entry.defaultLocale;
  const domain = entry.domains?.[locale];
  const kept = [
    ...(domain !== undefined && domain !== host ? [`domains.${locale} is ${domain}, not ${host}`] : []),
    ...(entry.base !== undefined && entry.base !== base ? [`base is ${entry.base}, not ${base}`] : []),
  ];
  if (kept.length === 0 && domain !== undefined && (entry.base !== undefined || base === '/')) {
    return { state: 'done', message: `site '${name}' already lists ${host}`, edits: [] };
  }
  entry.domains = { ...entry.domains, [locale]: host };
  if (base !== '/' || entry.base !== undefined) entry.base = base;
  const edits = [{ path, before: text, after: jsonLike(text, config) }];
  if (kept.length > 0) {
    return {
      state: 'differs',
      message: `site '${name}' in ${path}: ${kept.join('; ')} (kept yours)`,
      edits: [],
      replacement: edits,
    };
  }
  return {
    state: 'changed',
    message: `wrote ${host}${base === '/' ? '' : ` and base ${base}`} into site '${name}'`,
    edits,
  };
}
