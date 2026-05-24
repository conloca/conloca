/**
 * Render a VXJSON field's competing value as plain text for the
 * picker UI. Strings come through verbatim; primitives are
 * String()'d; everything else (objects, arrays) is pretty-printed
 * JSON. This is the universal fallback for Phase 1 — the
 * schema-driven renderer that knows how to display a specific
 * field (e.g. a CTA button with its own card layout) lands when
 * the per-page schema integration is wired.
 *
 * Phase 1 deliberately ships the JSON fallback because it covers
 * every value shape correctly (just unfriendly for nested
 * structures). The picker is still usable — the user sees both
 * sides, picks one, and the merge commit lands either value
 * verbatim.
 *
 * Returns a string the caller can drop into a `<pre>` block. Never
 * returns `null` or `undefined`; those values come through as
 * literal "null" / "undefined" strings so the picker is never blank.
 */
export function formatConflictValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Reverse the formatting: parse a string the user typed in the
 * "Custom" editor back into a value of the same shape as the
 * field's original `yours` / `theirs` sides.
 *
 * - If the original was a primitive string, return the input as-is
 *   (the user typed plain text into a textarea).
 * - If the original was a number/boolean/null, attempt JSON.parse;
 *   fall back to the raw string on parse failure (the resolver
 *   surfaces an inline error in that path).
 * - For objects/arrays, JSON.parse. Same fallback on failure.
 *
 * `referenceValue` is the original "yours" or "theirs" — used to
 * decide whether the input is meant to be a plain string or
 * structured JSON.
 */
export function parseConflictValue(
  input: string,
  referenceValue: unknown,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (typeof referenceValue === 'string') {
    return { ok: true, value: input };
  }
  try {
    return { ok: true, value: JSON.parse(input) };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Could not parse the value.',
    };
  }
}
