/**
 * Pick the locale to read content in. A hardcoded 'en' silently yields zero
 * pages for any project whose content is not English — `getStaticPaths` drops
 * every entry whose locale does not match — so prefer the explicit routing
 * option, then the framework-level `locales` declaration, then the resolved
 * site's own default, then the first global locale. Mirrors the chain
 * FileSystemContentAPI already uses for its default locale.
 */
export function resolveLocale(
  configured: string | undefined,
  frameworkDefault: string | undefined,
  siteName: string,
  sitesConfig: { sites: Record<string, { defaultLocale?: string } | undefined>; globalLocales?: string[] },
): string {
  return (
    configured ??
    frameworkDefault ??
    sitesConfig.sites[siteName]?.defaultLocale ??
    sitesConfig.globalLocales?.[0] ??
    'en'
  );
}
