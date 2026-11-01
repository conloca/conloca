/**
 * One asset's metadata record as committed: where it sits, its exact bytes, and how to read and compare it. The local
 * store and any other writer share these rules, so a record written by one reads back, byte for byte, in the other.
 */
import { ASSET_METADATA_DIR, type AssetMetadata, type AssetMetadataPatch } from './asset-types.js';
import { applyNullClearPatch } from './content-utils.js';

/** The record of the asset at `assetPath` (below the media folder, no leading slash), relative to the content root. */
export function assetMetadataRecordPath(assetPath: string): string {
  return `${ASSET_METADATA_DIR}/${assetPath}.json`;
}

/** The bytes of a record, as the local store writes them. */
export function serializeAssetMetadata(metadata: AssetMetadata): string {
  return JSON.stringify(metadata, null, 2);
}

/** Validate known fields without dropping forward-compatible extension fields. */
export function isAssetMetadata(value: unknown): value is AssetMetadata {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if ('alt' in value && typeof value.alt !== 'string') return false;
  if ('uploadedAt' in value && typeof value.uploadedAt !== 'string') return false;
  if ('uploadedBy' in value && typeof value.uploadedBy !== 'string') return false;
  if ('originalName' in value && typeof value.originalName !== 'string') return false;
  return !('tags' in value) || (Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === 'string'));
}

/** A record's text read as metadata; null when it is empty, not JSON, or not shaped as a record. */
export function parseAssetMetadata(raw: string): AssetMetadata | null {
  if (raw.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isAssetMetadata(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Merge a patch into a record: an absent field keeps its value, null clears it. */
export function patchAssetMetadata(current: AssetMetadata, patch: AssetMetadataPatch): AssetMetadata {
  return applyNullClearPatch(current, patch);
}

/** Whether two records say the same, whatever their key order; an empty record is the same as none. */
export function sameAssetMetadata(a: AssetMetadata | null, b: AssetMetadata | null): boolean {
  return canonical(a ?? {}) === canonical(b ?? {});
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh local array.
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(Reflect.get(value, key))}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
