import { isContentPublished } from '@conloca/content-api';

/** The existing public date helper, retaining Date identity for callers that already hold one. */
export function toDate(value: string | Date | null | undefined): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** Preserve the one-argument public predicate, including direct use as an array filter. */
export function isPublished(schedule: Parameters<typeof isContentPublished>[0]): boolean {
  return isContentPublished(schedule);
}

/**
 * Extract slug from pathname given a route pattern.
 *
 * The slug is the portion of the pathname that comes after the
 * static prefix of the pattern.
 *
 * @param pathname - URL pathname (e.g., '/about', '/blog/post-1')
 * @param pattern - Route pattern (e.g., '/[...slug]', '/blog/[...slug]')
 * @returns The extracted slug, or undefined for root paths
 *
 * @example
 * extractSlugFromPathname('/about', '/[...slug]') // 'about'
 * extractSlugFromPathname('/blog/post-1', '/blog/[...slug]') // 'post-1'
 * extractSlugFromPathname('/', '/[...slug]') // undefined
 * extractSlugFromPathname('/blog', '/blog/[...slug]') // undefined
 */
export function extractSlugFromPathname(pathname: string, pattern: string): string | undefined {
  // Pattern: /[...slug] -> prefix: ''
  // Pattern: /blog/[...slug] -> prefix: '/blog'
  // Pattern: /docs/[...path] -> prefix: '/docs'

  const prefixMatch = pattern.match(/^(.*?)\[/);
  const prefix = prefixMatch ? prefixMatch[1].replace(/\/$/, '') : '';

  // Remove prefix from pathname
  const slugPart = pathname.slice(prefix.length);

  // Remove leading slash
  const slug = slugPart.replace(/^\//, '');

  // Empty string means root page (e.g., /blog for /blog/[...slug])
  // Return undefined for root to match [...slug] behavior
  return slug || undefined;
}

/**
 * Convert a slug back to a pathname given a route pattern.
 *
 * The inverse of extractSlugFromPathname.
 *
 * @param slug - The page slug (e.g., 'about', 'post-1'), or undefined for root
 * @param pattern - Route pattern (e.g., '/[...slug]', '/blog/[...slug]')
 * @returns Full URL pathname
 *
 * @example
 * pathnameFromSlug('about', '/[...slug]') // '/about'
 * pathnameFromSlug('post-1', '/blog/[...slug]') // '/blog/post-1'
 * pathnameFromSlug(undefined, '/[...slug]') // '/'
 * pathnameFromSlug(undefined, '/blog/[...slug]') // '/blog'
 */
export function pathnameFromSlug(slug: string | undefined, pattern: string): string {
  // Extract the static prefix before the dynamic segment
  const prefixMatch = pattern.match(/^(.*?)\[/);
  const prefix = prefixMatch ? prefixMatch[1].replace(/\/$/, '') : '';

  if (!slug) {
    // No slug means root of this pattern
    return prefix || '/';
  }

  // Combine prefix and slug
  return `${prefix}/${slug}`;
}

/**
 * The `params` a prerendered path must carry for a route pattern. Astro keys
 * them by the name inside the pattern's brackets, so a `/[...page]` route
 * needs `{ page }`, not `{ slug }`; static patterns carry none.
 */
export function staticPathParams(pathname: string, pattern: string): Record<string, string | undefined> {
  const name = pattern.match(/\[(?:\.\.\.)?([^\]]+)\]/)?.[1];

  return name ? { [name]: extractSlugFromPathname(pathname, pattern) } : {};
}

/**
 * Entry-id factory for Astro content loaders over Conloca-managed markdown.
 *
 * Conloca's read-repair writes a tracking `id: vx-*` into managed frontmatter,
 * and Astro's glob-style loaders prefer a frontmatter `id` over the file path
 * — which silently breaks filename-based slug lookups (a Starlight sidebar
 * entry like `slug: 'getting-started'` stops resolving). Pass this as the
 * loader's `generateId` to pin entry ids to the file path; the Conloca `id`
 * stays available as frontmatter data.
 *
 * @example
 * docsLoader({ generateId: entryIdFromPath })
 */
export function entryIdFromPath({ entry }: { entry: string }): string {
  return entry.replace(/\.(md|mdx|markdown|mdown|mkdn|mkd|mdwn|mdoc)$/, '');
}
