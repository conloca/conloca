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
  'Preview is currently unavailable for this branch. Your draft is still saved, and publishing and the live site are unaffected.';

/** What the Preview control on a docs (MDX) page says until docs pages render drafts. */
export const DOCS_PREVIEW_UNAVAILABLE = "Full-page preview isn't available for docs pages yet";

/**
 * The neutral next step when only an unavailable capability is known. A host's refusal carries its own next step,
 * since confirmation or an upgrade may be needed instead. Names no host button: this editor also runs without one.
 */
export const PREVIEW_UNAVAILABLE_NEXT_STEP = 'Choose Check again to ask the site for the current preview status.';

/** The toast action that asks the site again, instead of making the person reload the editor to find out. */
export const PREVIEW_CHECK_AGAIN = 'Check again';

/** The toast action for a failure that is not about the site's setup. */
export const PREVIEW_TRY_AGAIN = 'Try again';

/** The browser refused the preview tab: the site is fine, the browser needs to be told it may open one. */
export const PREVIEW_BLOCKED_TITLE = 'Your browser blocked the preview tab';
export const PREVIEW_BLOCKED_DETAIL = 'Allow pop-ups for this site, then try again.';

/** A genuine fault, which must not read as though the site is misconfigured. */
export const PREVIEW_FAILED_TITLE = 'Could not open preview';
export const PREVIEW_FAILED_DETAIL = 'Something went wrong creating the preview link. Please try again.';
