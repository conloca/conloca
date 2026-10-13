/**
 * User-facing copy for "this site cannot show a preview".
 *
 * A LEAF module on purpose: no imports, so tests and header components can
 * read the wording without pulling in the editor's module graph. Importing
 * `PageEditor` just to read a string was enough to change module
 * initialization order and trip a pre-existing circular dependency inside
 * `@lexical`.
 */

/** Toast heading when the site cannot show a preview. */
export const PREVIEW_UNAVAILABLE_TITLE = 'Preview is not available for this site';

/**
 * The explanation, used both as the toast body and as the disabled control's
 * reason. States the fact about the site, reassures that nothing they
 * did is broken, and never implies user error.
 */
export const PREVIEW_UNAVAILABLE_DETAIL =
  'This site does not serve draft previews, so there is no preview page to open. Your draft is still saved, and publishing and the live site are unaffected.';
