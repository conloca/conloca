import sortKeys from 'sort-keys';
import type { VXJSONFile } from './types';

/**
 * The canonical VXJSON serializer: metadata alphabetical, content last so
 * the indexer reads all metadata from the first 4KB, 4KB position enforced.
 *
 * Lives apart from vxjson.ts on purpose: that module's ETag half imports
 * node crypto and WASM-backed xxhash at module level, which spec 14 §A90
 * bans inside registered functional cores. This file imports only sort-keys
 * and types, so the SaaS Branch DO's commit-plan core can consume it via
 * the dedicated `@conloca/content-api/vxjson-serialize` subpath — the A90
 * checker resolves workspace imports to their built output and scans it.
 */
export function serializeVxjson(data: VXJSONFile): string {
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
