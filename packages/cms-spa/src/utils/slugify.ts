/**
 * Convert text to a URL/filename-safe slug.
 * - Keeps the base letter of an accented letter (Ü → u, é → e)
 * - Converts to lowercase
 * - Replaces spaces and special chars with hyphens
 * - Removes consecutive hyphens
 * - Trims hyphens from start/end
 *
 * @example slugify("My Fragment Name!") // "my-fragment-name"
 * @example slugify("  Hello World  ") // "hello-world"
 * @example slugify("Über uns") // "uber-uns"
 */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
