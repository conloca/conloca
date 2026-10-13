import sortKeys from 'sort-keys';
import type { VXJSONFile } from './types.js';

/**
 * The canonical VXJSON serializer: metadata alphabetical, content last so
 * the indexer reads all metadata from the first 4KB, 4KB position enforced.
 *
 * Lives apart from vxjson.ts on purpose: that module's ETag half imports
 * node crypto and WASM-backed xxhash at module level. This file imports only
 * sort-keys and types, so code that must stay free of node/WASM imports can
 * consume it via the dedicated `@conloca/content-api/vxjson-serialize`
 * subpath.
 */
export function serializeVxjson(data: VXJSONFile): string {
  // Extract content to add it last
  const { content, ...metadataFields } = data;

  // Ensure content field exists (required for VXJSON format)
  if (content === undefined || content === null) {
    throw new Error('VXJSON format requires a "content" field');
  }

  // Sort all metadata fields alphabetically and serialize with tab indentation.
  // The replacer drops empty-string FIELDS, so clearing a value removes the key
  // rather than storing '' — deliberate, and covered by vxjson-empty-strings.
  // Array ELEMENTS are exempt: a replacer returning undefined drops an object
  // key but emits null inside an array, so ['a','','b'] used to reach disk as
  // ['a',null,'b'] and crash whatever walked the list later.
  const sortedMetadata = sortKeys(metadataFields, { deep: true });
  const metadataJson = JSON.stringify(
    sortedMetadata,
    function (this: unknown, _key, value) {
      if (value === '' && !Array.isArray(this)) {
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
