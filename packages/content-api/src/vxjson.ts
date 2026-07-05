import { createHash } from 'crypto';
import sortKeys from 'sort-keys';
import { JsonWhitespaceSkippingView } from './json-whitespace-view';
import type { ContentData, ContentMeta, VXJSONFile } from './types';
import { bigintToUrlSafeBase64, toUrlSafeBase64 } from './url-safe-base64';
import { createXxh64 } from './xxhash';

// Reusable TextDecoder instance - safe to reuse as it's stateless
const textDecoder = new TextDecoder();

// Pre-allocated content marker for efficiency
const CONTENT_MARKER = new TextEncoder().encode('"content":');

/**
 * Calculate metadata ETag using xxHash from buffer view
 * @param buffer - The file buffer view
 * @param start - Start position (inclusive)
 * @param end - End position (exclusive), or -1 for entire buffer
 */
function calculateMetaEtagFromBuffer(buffer: Uint8Array, start = 0, end = -1): string {
  const actualEnd = end === -1 ? buffer.length : end;
  const hasher = createXxh64();
  const jsonView = new JsonWhitespaceSkippingView(hasher);

  jsonView.updateBuffer(buffer, start, actualEnd);

  return bigintToUrlSafeBase64(hasher.digest());
}

/**
 * Calculate both ETags from a VXJSON buffer using views
 * Finds the "content" field position and validates it's the last field
 * @param buffer - The complete file buffer
 * @returns Result with ETags or validation error
 */
function calculateEtagsFromVXJSONBuffer(
  buffer: Uint8Array,
  allowTruncated = false,
):
  | { success: true; metaEtag: string; contentEtag?: string; contentStartPos: number }
  | { success: false; error: 'content_not_last' | 'invalid_json' } {
  let pos = 0;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let contentStartPos = -1;
  let foundContentAtRoot = false;
  let expectingKey = false; // At root level, are we expecting a key?
  let expectingValue = false; // At root level, are we expecting a value?
  let keyStart = -1;

  // Skip whitespace and find opening brace
  while (
    pos < buffer.length &&
    (buffer[pos] === 0x20 || buffer[pos] === 0x09 || buffer[pos] === 0x0a || buffer[pos] === 0x0d)
  ) {
    pos++;
  }

  if (pos >= buffer.length || buffer[pos] !== 0x7b) {
    // {
    return { success: false, error: 'invalid_json' };
  }

  depth = 1;
  expectingKey = true; // After { we expect a key
  pos++;

  // Parse JSON structure
  while (pos < buffer.length && depth > 0) {
    const byte = buffer[pos];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (byte === 0x5c) {
        // backslash
        escaped = true;
      } else if (byte === 0x22) {
        // quote
        inString = false;

        // If we were in a root key, check if it's "content"
        if (depth === 1 && expectingKey && keyStart >= 0) {
          const keyLength = pos - keyStart + 1; // +1 to include current quote

          // First check if we already found content and this is any key after it
          if (foundContentAtRoot) {
            // Check if this is another "content" key (duplicate)
            if (keyLength === 9) {
              let isContent = true;
              for (let i = 0; i < 7; i++) {
                if (buffer[keyStart + 1 + i] !== CONTENT_MARKER[i + 1]) {
                  isContent = false;
                  break;
                }
              }
              if (isContent) {
                // Duplicate content key
                return { success: false, error: 'invalid_json' };
              }
            }
            // Any other key after content is an error
            return { success: false, error: 'content_not_last' };
          }

          // Check if this key is "content" (7 chars + 2 quotes = 9 total)
          if (keyLength === 9) {
            let isContent = true;
            // Compare "content" part (skip opening quote)
            for (let i = 0; i < 7; i++) {
              if (buffer[keyStart + 1 + i] !== CONTENT_MARKER[i + 1]) {
                isContent = false;
                break;
              }
            }

            if (isContent) {
              // Found "content" at root level for the first time
              foundContentAtRoot = true;
              contentStartPos = keyStart; // Start of the quoted key
            }
          }

          expectingKey = false;
          expectingValue = true; // After a key, we expect : then value
          keyStart = -1;
        }
      }
    } else {
      // Not in string
      if (byte === 0x22) {
        // quote
        inString = true;

        // Check if this is a root-level key
        if (depth === 1 && expectingKey) {
          keyStart = pos;
        }
      } else if (byte === 0x7b || byte === 0x5b) {
        // { or [
        depth++;
        if (depth === 1 && expectingValue) {
          expectingValue = false; // We got our value
        }
      } else if (byte === 0x7d || byte === 0x5d) {
        // } or ]
        depth--;
        if (depth === 0) {
          break; // Done parsing
        }
      } else if (byte === 0x3a && depth === 1) {
        // : at root level
        if (!expectingValue) {
          return { success: false, error: 'invalid_json' };
        }
        // After : we're still expecting a value
      } else if (byte === 0x2c && depth === 1) {
        // , at root level
        expectingKey = true;
        expectingValue = false;
      } else if (depth === 1 && expectingValue && byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
        // Non-whitespace at root level when expecting value
        // Could be number, true, false, null
        expectingValue = false; // We're consuming the value
      }
    }

    pos++;
  }

  // For truncated JSON (4KB parsing), we can still succeed if we found the content position
  const isTruncated = depth !== 0;

  // If JSON is truncated but we don't allow it, return invalid_json
  if (isTruncated && !allowTruncated) {
    return { success: false, error: 'invalid_json' };
  }

  if (contentStartPos === -1) {
    // No content field found - this is valid for both complete and truncated JSON
    return {
      success: true,
      metaEtag: calculateMetaEtagFromBuffer(buffer),
      contentStartPos: -1,
    };
  }

  // Found content field - proceed with ETag calculation
  if (isTruncated) {
    // For truncated JSON, we can still calculate metadata ETag up to content position
    return {
      success: true,
      metaEtag: calculateMetaEtagFromBuffer(buffer, 0, contentStartPos),
      contentStartPos,
      // Don't calculate contentEtag for truncated content
    };
  }

  // Find the end of metadata (before "content":)
  let metaEnd = contentStartPos - 1;
  while (metaEnd > 0) {
    const byte = buffer[metaEnd];
    if (byte === 0x2c || byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) {
      metaEnd--;
    } else {
      break;
    }
  }

  // Hash metadata section: wrap in { } and exclude content field
  const metaHasher = createXxh64();
  const metaView = new JsonWhitespaceSkippingView(metaHasher);
  const openBrace = new Uint8Array([0x7b]); // {
  const closeBrace = new Uint8Array([0x7d]); // }

  metaHasher.update(openBrace);
  metaView.updateBuffer(buffer, 1, metaEnd); // Skip opening brace, stop before content
  metaHasher.update(closeBrace);

  const metaEtag = bigintToUrlSafeBase64(metaHasher.digest());

  // Hash content section: wrap as {"content": ... }
  const contentHasher = createHash('sha256');
  const contentView = new JsonWhitespaceSkippingView(contentHasher);

  contentHasher.update(openBrace); // {
  contentView.updateBuffer(buffer, contentStartPos, buffer.length - 1); // content field to end, exclude final }
  contentHasher.update(closeBrace); // }

  const contentEtag = toUrlSafeBase64(contentHasher.digest() as Uint8Array);

  return {
    success: true,
    metaEtag,
    contentEtag,
    contentStartPos,
  };
}

/**
 * VXJSON (Variant JSON) module for parsing and serializing VXJSON files
 *
 * VXJSON is a specialized JSON format that guarantees:
 * 1. The root is always an object (never an array or primitive)
 * 2. The "content" field always comes last in the object
 * 3. Field order is deterministic for consistent ETag calculation
 * 4. Metadata fits within 4085 bytes, ensuring "content" field is found within first 4KB
 * 5. First 4KB must either be complete JSON OR end exactly with '"content":'
 *
 * This format enables efficient 4KB parsing where only the first 4KB of a file
 * needs to be read to extract all metadata and locate the content position.
 * The constraint that 4KB reads must end with '"content":' ensures reliable parsing.
 *
 * This module centralizes all VXJSON-specific logic including:
 * - Parsing partial buffers (first 4KB for indexing)
 * - Finding content position for ETag calculation
 * - Serializing with proper field ordering and size validation
 * - Calculating ETags from buffers
 */

/**
 * VXJSON static utilities for parsing and validating VXJSON files
 */
export class VXJSON {
  /**
   * Parse first 4KB of VXJSON content from buffer
   * Used during indexing to extract metadata without loading full content
   *
   * VXJSON format requirement: first 4KB must either be complete JSON OR end with '"content":'
   * This ensures reliable parsing and validation.
   */
  static parse4KB(
    buffer: Uint8Array,
    bytesRead: number,
  ): {
    id?: string;
    created?: string;
    modified?: string;
    publishAt?: string;
    unpublishAt?: string;
    previousPathnames?: Record<string, string>;
    pathname?: string;
    name?: string;
    meta: ContentMeta;
    content?: ContentData;
    contentStartPos?: number; // Position where "content": starts in buffer
  } {
    // Complete JSON (either small file or ends with })
    if (bytesRead < 4096 || buffer[bytesRead - 1] === 0x7d) {
      // 0x7D = '}'
      const partialContent = textDecoder.decode(buffer.subarray(0, bytesRead));
      const data = JSON.parse(partialContent);

      // Find content position for ETag calculation
      let contentStartPos = -1;
      if (data.content !== undefined) {
        const etagResult = calculateEtagsFromVXJSONBuffer(buffer.subarray(0, bytesRead));
        if (etagResult.success) {
          contentStartPos = etagResult.contentStartPos;
        }
      }

      return {
        id: data.id,
        created: data.created,
        modified: data.modified,
        publishAt: data.publishAt,
        unpublishAt: data.unpublishAt,
        previousPathnames: data.previousPathnames,
        pathname: data.pathname,
        name: data.name,
        meta: data.meta || {},
        content: data.content,
        contentStartPos,
      };
    }

    // Truncated 4KB read - use calculateETags to validate and find content position
    const etagResult = calculateEtagsFromVXJSONBuffer(buffer.subarray(0, bytesRead), true); // Allow truncated for 4KB parsing

    if (!etagResult.success) {
      throw new Error(`Invalid VXJSON format: ${etagResult.error}. This violates the VXJSON specification.`);
    }

    const contentStartPos = etagResult.contentStartPos;

    // Find end of metadata by working backwards from content position
    let metadataEnd = contentStartPos;
    while (metadataEnd > 0) {
      const byte = buffer[metadataEnd - 1];
      if (byte === 0x2c) {
        // comma
        metadataEnd--;
        break;
      }
      if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) {
        // whitespace
        metadataEnd--;
      } else {
        break;
      }
    }

    // Create metadata-only JSON by adding closing brace
    const metadataBuffer = new Uint8Array(metadataEnd + 1);
    metadataBuffer.set(buffer.subarray(0, metadataEnd));
    metadataBuffer[metadataEnd] = 0x7d; // }

    const partialContent = textDecoder.decode(metadataBuffer);

    const data = JSON.parse(partialContent);
    return {
      id: data.id,
      created: data.created,
      modified: data.modified,
      publishAt: data.publishAt,
      unpublishAt: data.unpublishAt,
      previousPathnames: data.previousPathnames,
      pathname: data.pathname,
      name: data.name,
      meta: data.meta || {},
      contentStartPos,
    };
  }

  /**
   * Find the position of the "content" field in a VXJSON buffer
   * Returns -1 if not found
   */
  static findContentPosition(buffer: Uint8Array): number {
    const etagResult = calculateEtagsFromVXJSONBuffer(buffer);
    if (etagResult.success) {
      return etagResult.contentStartPos;
    }
    return -1;
  }

  /**
   * Calculate ETags for a VXJSON buffer
   * Returns null if the buffer is not valid VXJSON
   */
  static calculateEtagsOnly(buffer: Uint8Array): { metaEtag: string; contentEtag?: string } | null {
    const result = calculateEtagsFromVXJSONBuffer(buffer);
    if (!result.success) {
      return null;
    }

    return {
      metaEtag: result.metaEtag,
      contentEtag: result.contentEtag,
    };
  }

  /**
   * Create a dual ETag string from a VXJSON buffer
   * Returns null if the buffer is not valid VXJSON
   */
  static createEtag(buffer: Uint8Array): string | null {
    const etags = VXJSON.calculateEtagsOnly(buffer);
    if (!etags) {
      return null;
    }

    return etags.contentEtag ? `${etags.metaEtag}.${etags.contentEtag}` : etags.metaEtag;
  }

  /**
   * Validate that a VXJSON buffer has the correct structure
   * (content field must be last)
   */
  static isValid(buffer: Uint8Array): boolean {
    const result = calculateEtagsFromVXJSONBuffer(buffer);
    return result.success;
  }

  /**
   * Parse a complete VXJSON file from string
   */
  static parse(content: string): VXJSONFile {
    return JSON.parse(content);
  }

  /**
   * Parse a complete VXJSON file from buffer
   */
  static parseBuffer(buffer: Uint8Array): VXJSONFile {
    const content = textDecoder.decode(buffer);
    return VXJSON.parse(content);
  }

  /**
   * Calculate both ETags from a VXJSON buffer using views
   * Finds the "content" field position and validates it's the last field
   * @param buffer - The complete file buffer
   * @returns Result with ETags or validation error
   */
  static calculateETags = calculateEtagsFromVXJSONBuffer;

  /**
   * Calculate a simple single etag from the entire buffer
   * Used for data files that don't follow the content-last convention
   */
  static calculateSimpleEtag(buffer: Uint8Array): string {
    return calculateMetaEtagFromBuffer(buffer);
  }

  /**
   * Serialize a VXJSONFile to VXJSON format string
   * Ensures content field is last and enforces 4KB constraint efficiently
   */
  static serialize(data: VXJSONFile): string {
    // Extract content to add it last
    const { content, ...metadataFields } = data;

    // Ensure content field exists (required for VXJSON format)
    if (content === undefined || content === null) {
      throw new Error('VXJSON format requires a "content" field');
    }

    // Sort all metadata fields alphabetically and serialize with tab indentation
    // Use a replacer function to filter out empty strings
    const sortedMetadata = sortKeys(metadataFields, { deep: true });
    const metadataJson = JSON.stringify(
      sortedMetadata,
      (_key, value) => {
        // Filter out empty strings at any level
        if (value === '') {
          return undefined;
        }
        return value;
      },
      '\t',
    );

    // Serialize content wrapped in an object to get proper indentation
    const wrappedContent = JSON.stringify({ c: sortKeys(content, { deep: true }) }, null, '\t');
    // Extract just the content part, removing the wrapper
    // This transforms: '{\n "c": {\n  "puckData": ...\n }\n}'
    // Into: '{\n  "puckData": ...\n }'
    const contentJson = wrappedContent.slice(wrappedContent.indexOf(': ') + 2, -2);

    // Remove the closing } and newline from metadata
    const metadataWithoutClosing = metadataJson.slice(0, -2); // Remove \n}
    const contentFieldPrefix = ',\n\t"content": ';
    const contentKeyPosition = metadataWithoutClosing.length + 1 + '\n\t'.length; // Position of "content":

    // VXJSON constraint: "content": must appear within first 4KB
    const maxContentKeyPosition = 4096 - '"content":'.length; // 4086
    if (contentKeyPosition > maxContentKeyPosition) {
      throw new Error(
        'VXJSON format violation: metadata too large. ' +
          `"content" field would start at position ${contentKeyPosition}, ` +
          `but must start within ${maxContentKeyPosition} bytes. ` +
          `Reduce metadata size by ${contentKeyPosition - maxContentKeyPosition} bytes.`,
      );
    }

    // Build final JSON string efficiently
    return `${metadataWithoutClosing}${contentFieldPrefix}${contentJson}\n}`;
  }
}
