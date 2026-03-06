/**
 * JSON.stringify replacement that escapes characters dangerous in HTML script contexts.
 *
 * When embedding JSON in `<script>` tags, characters like `<`, `>`, `&`, and `'` can break
 * out of the script context (e.g., `</script>` closes the tag prematurely). This function
 * replaces those characters with their Unicode escape equivalents, which are valid in both
 * JSON and JavaScript string contexts.
 *
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
 */
export function safeJsonStringify(data: Record<string, unknown> | unknown[] | string | number | boolean | null): string;
export function safeJsonStringify(data: unknown): string | undefined;
export function safeJsonStringify(data: unknown): string | undefined {
  const json = JSON.stringify(data);
  if (json === undefined) return undefined;
  return json.replace(/[<>&']/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
