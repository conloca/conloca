/**
 * Reading a failed content-API write.
 *
 * Every write result (`UpdateResult`, `DeleteResult`, `CreateResult`,
 * `MoveResult`) reports failure the same way: a structural `reason` code plus an
 * optional `error`. The `reason` is the reliable signal; the `error` is prose
 * that arrives in three different shapes depending on which route answered, so
 * neither the UI nor a `String.includes` check should be steering off it.
 */

interface ContentFailure {
  reason?: string;
  error?: unknown;
}

/**
 * Whether the write lost to a concurrent edit, so the caller should offer to
 * reload rather than just report a message.
 *
 * Do not sniff the message for the word "modified". Only astro-cms's content
 * router says it; another content API (for example one behind a custom
 * `contentClient`) may send `reason` with no message at all, and a stale
 * delete or rename would then fall through to the generic error and never
 * offer the reload.
 */
export function isStaleWrite(failure: ContentFailure): boolean {
  return failure.reason === 'stale_write';
}

/**
 * Sentence to show for a failed write: our own wording for the reason codes
 * worth explaining, else the server's message, else `fallback`. Same precedence
 * `CreateFragmentDialog` already uses for the create-specific codes.
 */
export function contentFailureMessage(failure: ContentFailure, fallback: string): string {
  return reasonSentence(failure.reason) ?? serverMessage(failure.error) ?? fallback;
}

function reasonSentence(reason: string | undefined): string | undefined {
  switch (reason) {
    case 'not_found':
      return 'This entry no longer exists. It may have already been deleted.';
    case 'already_exists':
      return 'That name is already taken. Please choose a different one.';
    case 'pathname_taken':
      return 'That pathname is already in use. Please choose a different one.';
    case 'pathname_in_redirects':
      return 'That pathname redirects to another page. Please choose a different one.';
    // write_error / delete_error say only "it broke" — the server's own message
    // carries whatever detail there is.
    default:
      return undefined;
  }
}

/**
 * The message out of a result's `error`, whatever survived the wire: a real
 * `Error` in-process, a bare string from a remote route's JSON, or a
 * `{ message }` object. An `Error` that was JSON-serialized before reaching the
 * browser arrives as `{}` and yields nothing — that is the case `fallback`
 * exists for.
 */
function serverMessage(error: unknown): string | undefined {
  if (error instanceof Error) return blankToUndefined(error.message);
  if (typeof error === 'string') return blankToUndefined(error);
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return blankToUndefined(error.message);
  }
  return undefined;
}

function blankToUndefined(value: string): string | undefined {
  return value.trim() === '' ? undefined : value;
}
