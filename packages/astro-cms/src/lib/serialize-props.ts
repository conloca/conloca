/**
 * Safely serialize props for embedding in HTML data attributes.
 * Escapes < to prevent XSS when JSON is parsed in browser.
 */
export function serializeProps(props: Record<string, unknown>): string {
  return JSON.stringify(props).replace(/</g, '\\u003c')
}
