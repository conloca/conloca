/**
 * User-facing copy for "this site cannot show a preview".
 *
 * A LEAF module on purpose: no imports, so tests and header components can
 * read the wording without pulling in the editor's module graph. Importing
 * `PageEditor` just to read a string was enough to change module
 * initialization order and trip a pre-existing circular dependency inside
 * `@lexical`.
 */

/** Toast heading when the branch cannot show a preview. */
export const PREVIEW_UNAVAILABLE_TITLE = 'Preview is not available for this branch';

/**
 * The explanation, used both as the toast body and as the disabled control's
 * reason. Preview support is checked per branch (one origin can serve one
 * branch's drafts and not another's), so it names the branch, never the whole
 * site; it reassures that nothing they did is broken.
 */
export const PREVIEW_UNAVAILABLE_DETAIL =
  'This branch has no preview server, so there is no preview page to open. Your draft is still saved, and publishing and the live site are unaffected.';
