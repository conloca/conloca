import { getUIConfig } from '../ui-config';

/**
 * Build a full URL from the site base URL and a path
 * @param path The path to append (e.g., '/about')
 * @returns The full URL (e.g., 'https://example.com/docs/about' or '/docs/about')
 */
export function buildSiteUrl(path: string): string {
  const config = getUIConfig();
  const siteBaseUrl = config.siteBaseUrl || '';

  if (!siteBaseUrl) return path;

  // Handle absolute URLs (with protocol)
  if (siteBaseUrl.includes('://')) {
    const base = siteBaseUrl.endsWith('/') ? siteBaseUrl.slice(0, -1) : siteBaseUrl;
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${base}${cleanPath}`;
  }

  // Handle relative paths
  const prefix = siteBaseUrl.startsWith('/') ? siteBaseUrl : `/${siteBaseUrl}`;
  const cleanPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  return `${cleanPrefix}${cleanPath}`;
}

/**
 * Extract the path from a full URL, removing the site base URL
 * @param url The full URL (e.g., 'https://example.com/docs/about' or '/docs/about')
 * @returns The path without base URL (e.g., '/about')
 */
export function extractPathFromUrl(url: string): string {
  const config = getUIConfig();
  const siteBaseUrl = config.siteBaseUrl || '';

  if (!siteBaseUrl) return url;

  // Handle absolute URLs
  if (siteBaseUrl.includes('://') && url.startsWith(siteBaseUrl)) {
    const withoutBase = url.slice(siteBaseUrl.length);
    return withoutBase.startsWith('/') ? withoutBase : `/${withoutBase}`;
  }

  // Handle relative paths
  const prefix = siteBaseUrl.startsWith('/') ? siteBaseUrl : `/${siteBaseUrl}`;
  const cleanPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;

  if (url.startsWith(cleanPrefix)) {
    const withoutPrefix = url.slice(cleanPrefix.length);
    return withoutPrefix.startsWith('/') ? withoutPrefix : `/${withoutPrefix}`;
  }

  return url;
}
