export function toDate(value: string | Date | null | undefined) {
  if (!value) {
    return undefined;
  }

  if (value instanceof Date) {
    return value;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

interface PublishSchedule {
  publishAt?: string | Date | null;
  unpublishAt?: string | Date | null;
}

export function isPublished(data: PublishSchedule) {
  const now = new Date();
  const publishAt = toDate(data.publishAt);
  const unpublishAt = toDate(data.unpublishAt);

  if (publishAt && publishAt > now) {
    return false;
  }

  if (unpublishAt && unpublishAt <= now) {
    return false;
  }

  return true;
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
