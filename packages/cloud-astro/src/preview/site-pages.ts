/**
 * Pages the site itself prerendered (no CMS entry behind them). Under d8 they stay inside the preview: the render
 * serves their published bytes with the banner and links kept under the route. Each adapter supplies its own source.
 */
export interface SitePageSource {
  /** Whether `page` (base included, normalizeTrailingSlash form) is a page the site itself prerendered. */
  has(page: string): Promise<boolean>;
  /** That page's published HTML, or null when it can't be read (the caller sends a 302 out). */
  read(page: string): Promise<Response | null>;
}

/** No site pages known: every path goes to the CMS render. */
export const NO_SITE_PAGES: SitePageSource = {
  has: async () => false,
  read: async () => null,
};
