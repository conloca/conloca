/**
 * Utilities for working with suffix pattern as specified in 04-cms-api.md
 */
export const ContentUtils = {
  /**
   * Extract locale from filename
   * @example
   * - about.en.vxjson → 'en'
   * - about.nl.vxjson → 'nl'
   * - hero-main.mdx → 'en' (default)
   * - hero-main.nl.mdx → 'nl'
   */
  extractLocale(filename: string): string {
    const match = filename.match(/\.([a-z]{2})\.(vxjson|mdx)$/);
    return match?.[1] || 'en';
  },

  /**
   * Get base path without locale and extension
   * @example
   * - about.en.vxjson → 'about'
   * - about.nl.vxjson → 'about'
   * - hero-main.mdx → 'hero-main'
   */
  extractBasePath(filename: string): string {
    return filename.replace(/\.([a-z]{2})?\.(vxjson|mdx)$/, '').replace(/\.(vxjson|mdx)$/, '');
  },

  /**
   * Build filename from base path and locale
   * @example
   * - ('about', 'en') → 'about.en.vxjson'
   * - ('about', 'nl') → 'about.nl.vxjson'
   */
  buildFilename(basePath: string, locale: string, extension = 'vxjson'): string {
    if (locale === 'en' && extension === 'vxjson') {
      return `${basePath}.${extension}`;
    }
    return `${basePath}.${locale}.${extension}`;
  },

  /**
   * Group files by base path for i18n
   */
  groupByContent(filenames: string[]): Map<string, Record<string, string>> {
    const groups = new Map<string, Record<string, string>>();

    for (const filename of filenames) {
      const base = this.extractBasePath(filename);
      const locale = this.extractLocale(filename);

      if (!groups.has(base)) {
        groups.set(base, {});
      }

      const localeFiles = groups.get(base)!;
      localeFiles[locale] = filename;
    }

    return groups;
  },

  /**
   * Check if a file is a content file (vxjson or mdx)
   */
  isContentFile(filename: string): boolean {
    return /\.(vxjson|mdx)$/.test(filename);
  },

  /**
   * Parse filename to get all components
   */
  parseFilename(filename: string): {
    basePath: string;
    locale: string;
    extension: string;
  } {
    const extension = filename.match(/\.(vxjson|mdx)$/)?.[1] || '';
    const locale = this.extractLocale(filename);
    const basePath = this.extractBasePath(filename);

    return { basePath, locale, extension };
  },
};
