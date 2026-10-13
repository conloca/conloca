import { buildSiteUrl, extractPathFromUrl } from '../lib/utils.js';
import { getUIConfig } from '../ui-config.js';

/**
 * Hook to access and use the site base URL configuration
 */
export function useSiteBaseUrl() {
  const config = getUIConfig();
  const siteBaseUrl = config.siteBaseUrl || '';

  return {
    siteBaseUrl,
    buildUrl: buildSiteUrl,
    extractPath: extractPathFromUrl,
  };
}
