import { createHash } from 'crypto';
import { JsonWhitespaceSkippingView } from './json-whitespace-view';
import { bigintToUrlSafeBase64, toUrlSafeBase64 } from './url-safe-base64';
import { createXxh64 } from './xxhash';

/**
 * Dual ETag system for content API
 * - Meta ETag: Based on non-derived LocaleManifest fields (using XXH64)
 * - Content ETag: Based on ContentProp.content (using SHA256)
 * Both skip whitespace to allow pretty-printing without affecting hashes
 *
 * Format: "metaEtag.contentEtag" in query strings
 */


/**
 * Calculate metadata ETag (XXH64) from buffer view
 * @param buffer - The file buffer view
 * @param start - Start position (inclusive)
 * @param end - End position (exclusive), or -1 for entire buffer
 */
export function calculateMetaEtagFromBuffer(buffer: Uint8Array, start = 0, end = -1): string {
  const actualEnd = end === -1 ? buffer.length : end;
  const hasher = createXxh64();
  const jsonView = new JsonWhitespaceSkippingView(hasher);

  jsonView.updateBuffer(buffer, start, actualEnd);

  return bigintToUrlSafeBase64(hasher.digest());
}

/**
 * Calculate content ETag using SHA256 from buffer view
 * @param buffer - The file buffer view
 * @param start - Start position (inclusive)
 * @param end - End position (exclusive), or -1 for entire buffer
 */
export function calculateContentEtagFromBuffer(buffer: Uint8Array, start = 0, end = -1): string {
  const actualEnd = end === -1 ? buffer.length : end;
  const hasher = createHash('sha256');
  const jsonView = new JsonWhitespaceSkippingView(hasher);

  jsonView.updateBuffer(buffer, start, actualEnd);

  return toUrlSafeBase64(hasher.digest() as Uint8Array);
}

const dashCode = '-'.charCodeAt(0); // 45
const newlineCode = '\n'.charCodeAt(0); // 10

/**
 * Find the content start position in MDX buffer (after second ---)
 * @param buffer - The MDX content buffer
 * @returns Position where content starts, or -1 if not found
 */
export function findMdxContentStartPosition(buffer: Uint8Array): number {
  let dashCount = 0;
  let i = 0;

  // Look for the second occurrence of "---\n"
  while (i < buffer.length - 4) {
    if (
      buffer[i] === dashCode &&
      buffer[i + 1] === dashCode &&
      buffer[i + 2] === dashCode &&
      buffer[i + 3] === newlineCode
    ) {
      dashCount++;
      if (dashCount === 2) {
        // Found second ---, now look for the following newline to get content start
        i += 4; // Skip past "---\n"
        if (i < buffer.length && buffer[i] === newlineCode) {
          return i + 1; // Return position after the empty line
        }
        return i; // Return position right after "---\n"
      }
      i += 4; // Skip this "---\n" and continue looking
    } else {
      // Use indexOf to skip ahead faster instead of incrementing by 1
      const nextDashPos = buffer.indexOf(dashCode, i + 1);
      if (nextDashPos === -1) {
        break; // No more dashes found
      }
      i = nextDashPos;
    }
  }

  return -1; // Not found
}

/**
 * Calculate both ETags from an MDX buffer
 *
 * MDX files use YAML frontmatter which has different characteristics than JSON:
 * - YAML does not require quotes around keys or string values
 * - YAML allows multiple formatting styles (flow vs block style)
 * - YAML field order is not significant for parsing
 *
 * Unlike VXJSON which requires "content" to be the last field and needs special
 * parsing to validate structure, YAML frontmatter can be hashed as-is because:
 * 1. The frontmatter boundaries are clearly delimited by ---
 * 2. Different YAML formatting of the same data SHOULD produce different hashes
 *    (e.g., flow style [a,b] vs block style with dashes)
 * 3. There's no requirement to validate field ordering
 *
 * This means we can directly hash the YAML bytes without any whitespace
 * normalization or parsing, which is both simpler and more correct.
 *
 * @param buffer - The complete file buffer
 * @param contentStartPos - Position where content starts (after second ---), or -1 if no content
 */
export function calculateEtagsFromMdxBuffer(
  buffer: Uint8Array,
  contentStartPos: number,
): {
  metaEtag: string;
  contentEtag: string;
} {
  if (contentStartPos === -1) {
    // No content, only frontmatter - hash entire buffer as metadata
    const hasher = createXxh64();
    hasher.update(buffer);
    const metaEtag = bigintToUrlSafeBase64(hasher.digest());

    return {
      metaEtag,
      contentEtag: calculateContentEtagFromBuffer(new Uint8Array(0)), // empty content
    };
  }

  // For MDX, we hash the YAML frontmatter as-is (including the --- markers)
  // This is different from JSON where we need to parse and validate structure
  const metaHasher = createXxh64();
  metaHasher.update(buffer.subarray(0, contentStartPos));
  const metaEtag = bigintToUrlSafeBase64(metaHasher.digest());

  // Content is everything after the second ---
  const contentHasher = createHash('sha256');
  contentHasher.update(buffer.subarray(contentStartPos));
  const contentEtag = toUrlSafeBase64(contentHasher.digest() as Uint8Array);

  return {
    metaEtag,
    contentEtag,
  };
}

/**
 * Combined ETag structure
 */
export interface DualEtag {
  meta: string;
  content: string;
}

/**
 * Format dual ETags for query string: "meta.content"
 */
export function formatDualEtag(etags: DualEtag): string {
  return `${etags.meta}.${etags.content}`;
}

/**
 * Parse dual ETags from query string: "meta.content"
 */
export function parseDualEtag(etag: string): DualEtag | null {
  const parts = etag.split('.');
  if (parts.length !== 2) return null;

  return {
    meta: parts[0],
    content: parts[1],
  };
}

/**
 * Check if etag matches either meta or content
 */
export function matchesEtag(
  providedEtag: string,
  currentMeta: string,
  currentContent: string,
): {
  matches: boolean;
  metaChanged: boolean;
  contentChanged: boolean;
} {
  const parsed = parseDualEtag(providedEtag);
  if (!parsed) {
    return {
      matches: false,
      metaChanged: true,
      contentChanged: true,
    };
  }

  const metaChanged = parsed.meta !== currentMeta;
  const contentChanged = parsed.content !== currentContent;

  return {
    matches: !metaChanged && !contentChanged,
    metaChanged,
    contentChanged,
  };
}
