import { mkdir, readdir, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import {
  ASSET_METADATA_DIR,
  type AssetManifestData,
  type AssetMetadata,
  type AssetMetadataPatch,
} from './asset-types.js';
import { applyNullClearPatch } from './content-utils.js';
import type { JsonValue } from './types.js';
import { atomicWriteFile } from './utils/atomic-write.js';

/**
 * The two folders the store works across. One metadata record per asset, so
 * two people annotating two pictures cannot touch each other's work: two
 * pictures are two files. The records live in ASSET_METADATA_DIR under the
 * content root, committed with the content they describe, and never inside the
 * media folder: a site serves that folder as it is, dotfiles included, so a
 * record written there is published. The media folder is read only to find a
 * pre-0.2 manifest.
 */
export interface MetadataRoots {
  assetsPath: string;
  contentRoot: string;
}

/** The pre-0.2 shared manifest, read once by the migration and then moved to the records directory */
const LEGACY_MANIFEST = '.asset-manifest.json';

/** The legacy manifest's copy once migrated. Never deleted: it is the only way back */
const MIGRATED_MANIFEST = `${LEGACY_MANIFEST}.migrated`;

/** The fields a person owns. Anything else on an older entry (cached sizes) is dropped */
const STORED_FIELDS = ['alt', 'tags', 'uploadedAt', 'uploadedBy', 'originalName'] as const;

/**
 * One promise chain per record path, so a read-modify-write on one record is
 * never interleaved with another in this process. Anchored on a global symbol
 * rather than on module identity: a dev server can end up holding two copies of
 * this module, and a module-level Map would then split into two locks — the
 * exact fault this file repairs.
 *
 * Scope claim, stated honestly: this serialises writers INSIDE one process.
 * Across processes, safety comes from the shape of the data — two assets are
 * two files — not from this.
 */
declare global {
  // Shared across duplicate module instances in one dev-server process.
  var conlocaAssetMetadataChains: Map<string, Promise<unknown>> | undefined;
}

function sharedChains(): Map<string, Promise<unknown>> {
  globalThis.conlocaAssetMetadataChains ??= new Map<string, Promise<unknown>>();
  return globalThis.conlocaAssetMetadataChains;
}

const chains = sharedChains();

function isNotFoundError(error: Error): boolean {
  return 'code' in error && error.code === 'ENOENT';
}

async function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  // Run whether or not the previous holder failed, and keep a guarded copy in
  // the map so the chain itself can never reject and strand later arrivals.
  const mine = previous.then(fn, fn);
  const guarded = mine.catch(() => {});
  chains.set(key, guarded);
  try {
    return await mine;
  } finally {
    // Delete only OUR entry. A bare delete lets a finishing writer drop a LATER
    // writer's chain, and the next arrival then runs alongside it.
    if (chains.get(key) === guarded) chains.delete(key);
  }
}

function relativeMetadataFolder(folder: string): string {
  return folder.replace(/^\/+|\/+$/g, '');
}

/** The metadata directory, under the content root */
function recordsRoot(roots: MetadataRoots): string {
  return resolve(roots.contentRoot, ASSET_METADATA_DIR);
}

/**
 * Keep a path inside the metadata directory, or refuse it.
 *
 * Asset paths arrive from an HTTP route, and this store now deletes and
 * overwrites real files rather than keys in one shared document: without this,
 * `../sites` names a file that has nothing to do with the media library.
 */
function containedPath(roots: MetadataRoots, unsafePath: string): string {
  const root = recordsRoot(roots);
  const full = resolve(root, unsafePath);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error(`Path traversal detected: ${unsafePath} is outside the asset metadata directory`);
  }
  return full;
}

/** Where one asset's record lives: the asset's own path, mirrored under the metadata directory */
export function recordPath(roots: MetadataRoots, relativePath: string): string {
  return containedPath(roots, `${relativePath}.json`);
}

/** The serialiser key is the record's own path, already resolved, so two callers configured with different spellings of one directory share a lock */
function lockKey(roots: MetadataRoots, relativePath: string): string {
  return recordPath(roots, relativePath);
}

/**
 * What one record's bytes turned out to be. `damaged` is deliberately distinct
 * from `absent`: reading may treat the two alike, but writing may not — an
 * overwrite of bytes we failed to parse destroys whatever alt text, original
 * name and upload date are still in them, which is the exact defect this store
 * exists to remove.
 */
type StoredRecord = { state: 'ok'; metadata: AssetMetadata } | { state: 'absent' } | { state: 'damaged' };

type ParsedJson = JsonValue | AssetMetadata | AssetManifestData;

/** Validate known fields without dropping forward-compatible extension fields. */
function isAssetMetadata(value: ParsedJson): value is AssetMetadata {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if ('alt' in value && typeof value.alt !== 'string') return false;
  if ('uploadedAt' in value && typeof value.uploadedAt !== 'string') return false;
  if ('uploadedBy' in value && typeof value.uploadedBy !== 'string') return false;
  if ('originalName' in value && typeof value.originalName !== 'string') return false;
  return !('tags' in value) || (Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === 'string'));
}

function isLegacyManifest(value: ParsedJson): value is AssetManifestData {
  return (
    value !== null && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(isAssetMetadata)
  );
}

function parseRecord(raw: string, path: string): StoredRecord {
  if (raw.trim() === '') {
    console.warn(`[asset-metadata] empty record ${path} — reading the asset as having no metadata`);
    return { state: 'damaged' };
  }
  try {
    const metadata: ParsedJson = JSON.parse(raw);
    if (!isAssetMetadata(metadata)) throw new Error('Invalid asset metadata shape');
    return { state: 'ok', metadata };
  } catch {
    console.warn(`[asset-metadata] unreadable record ${path} — reading the asset as having no metadata`);
    return { state: 'damaged' };
  }
}

async function readLegacyManifest(roots: MetadataRoots): Promise<AssetManifestData | undefined> {
  try {
    const manifest: ParsedJson = JSON.parse(await readFile(join(roots.assetsPath, LEGACY_MANIFEST), 'utf-8'));
    return isLegacyManifest(manifest) ? manifest : undefined;
  } catch {
    return undefined;
  }
}

/** Read one record straight off disk, without waiting on the serialiser: a rename is atomic, so no read sees half a file */
async function readRecord(roots: MetadataRoots, relativePath: string): Promise<StoredRecord> {
  const path = recordPath(roots, relativePath);
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (error) {
    // A record that exists but cannot be opened holds bytes nobody has seen;
    // reading it as absent would let the next save replace them
    if (error instanceof Error && isNotFoundError(error)) return { state: 'absent' };
    throw error;
  }
  return parseRecord(raw, path);
}

/**
 * One asset's metadata. Until the first write migrates it, an asset with no
 * record of its own still answers out of the legacy manifest, so upgrading and
 * browsing shows everything it showed before.
 */
export async function read(roots: MetadataRoots, relativePath: string): Promise<AssetMetadata | undefined> {
  const record = await readRecord(roots, relativePath);
  if (record.state === 'ok') return record.metadata;
  // Damaged reads as nothing rather than falling through to the legacy file:
  // showing stale metadata for a record we cannot parse would misrepresent what
  // is on disk, and the warning has already named the file. Writing refuses.
  if (record.state === 'damaged') return undefined;
  return (await readLegacyManifest(roots))?.[relativePath];
}

/** Every record in one folder, keyed by path relative to the assets root */
export async function readFolder(roots: MetadataRoots, folder: string): Promise<Map<string, AssetMetadata>> {
  const prefix = relativeMetadataFolder(folder);
  const records = new Map<string, AssetMetadata>();
  const presentRecords = new Set<string>();

  let dir: string;
  try {
    dir = containedPath(roots, prefix);
  } catch {
    // Nothing outside the metadata directory is ours to read out of
    return records;
  }

  let filenames: string[];
  try {
    filenames = await readdir(dir);
  } catch (error) {
    // Only a missing directory permits legacy fallback; unreadable is not absent.
    if (!(error instanceof Error && isNotFoundError(error))) return records;
    filenames = [];
  }

  const loaded = await Promise.all(
    filenames
      .filter((filename) => filename.endsWith('.json'))
      .map(async (filename) => {
        const assetName = filename.slice(0, -'.json'.length);
        const relativePath = prefix ? `${prefix}/${assetName}` : assetName;
        const path = join(dir, filename);
        try {
          return [relativePath, parseRecord(await readFile(path, 'utf-8'), path)] as const;
        } catch {
          return [relativePath, { state: 'absent' } satisfies StoredRecord] as const;
        }
      }),
  );
  for (const [relativePath, record] of loaded) {
    presentRecords.add(relativePath);
    if (record.state === 'ok') records.set(relativePath, record.metadata);
  }

  const legacy = await readLegacyManifest(roots);
  if (legacy) {
    for (const [relativePath, entry] of Object.entries(legacy)) {
      const slash = relativePath.lastIndexOf('/');
      const entryFolder = slash > 0 ? relativePath.slice(0, slash) : '';
      // An unreadable record is not absent: never revive the older manifest value.
      if (entryFolder === prefix && !presentRecords.has(relativePath)) records.set(relativePath, entry);
    }
  }

  return records;
}

async function writeRecord(roots: MetadataRoots, relativePath: string, metadata: AssetMetadata): Promise<void> {
  const path = recordPath(roots, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await atomicWriteFile(path, JSON.stringify(metadata, null, 2));
}

/** Replace an asset's record wholesale. Upload uses this: a new file must not inherit the previous occupant's alt text */
export async function write(roots: MetadataRoots, relativePath: string, metadata: AssetMetadata): Promise<void> {
  await serialize(lockKey(roots, relativePath), () => writeRecord(roots, relativePath, metadata));
}

/**
 * Merge a patch into an asset's record and return the merged value, so a caller
 * never has to read back what it just wrote. Read and write happen as one unit.
 */
export async function update(
  roots: MetadataRoots,
  relativePath: string,
  patch: AssetMetadataPatch,
): Promise<AssetMetadata> {
  return serialize(lockKey(roots, relativePath), async () => {
    const record = await readRecord(roots, relativePath);
    if (record.state === 'damaged') {
      // Refusing loudly is the whole point: merging onto `{}` here would write
      // away the alt text and upload date still sitting in the bytes we could
      // not parse, and report success. The file is left untouched so it can be
      // repaired by hand.
      throw new Error(
        `Asset metadata for ${relativePath} is unreadable; refusing to overwrite it. Repair or delete ${recordPath(roots, relativePath)} and try again.`,
      );
    }
    const existing =
      record.state === 'ok' ? record.metadata : ((await readLegacyManifest(roots))?.[relativePath] ?? {});
    const merged: AssetMetadata = applyNullClearPatch(existing, patch);
    await writeRecord(roots, relativePath, merged);
    return merged;
  });
}

/** Drop an asset's record. Already gone counts as done */
export async function remove(roots: MetadataRoots, relativePath: string): Promise<void> {
  await serialize(lockKey(roots, relativePath), async () => {
    try {
      await unlink(recordPath(roots, relativePath));
    } catch (error) {
      if (!(error instanceof Error && isNotFoundError(error))) throw error;
    }
  });
}

/** Carry an asset's record to its new path. Locks are taken in sorted order so two moves cannot deadlock */
export async function move(roots: MetadataRoots, from: string, to: string): Promise<void> {
  const fromKey = lockKey(roots, from);
  const toKey = lockKey(roots, to);
  // Both ends are the same record: there is nothing to carry, and taking that
  // one lock twice would wait on a lock this call is already holding — a wait
  // that never ends, and that strands every later save on the same picture.
  if (fromKey === toKey) return;

  const [first, second] = fromKey < toKey ? [fromKey, toKey] : [toKey, fromKey];
  await serialize(first, () =>
    serialize(second, async () => {
      const target = recordPath(roots, to);
      await mkdir(dirname(target), { recursive: true });
      try {
        await rename(recordPath(roots, from), target);
      } catch (error) {
        if (!(error instanceof Error && isNotFoundError(error))) throw error;
        // ENOENT can also mean the destination disappeared, not that the source is absent.
        if ((await readRecord(roots, from)).state !== 'absent') throw error;
      }
    }),
  );
}

/**
 * Fold a pre-0.2 shared manifest into per-asset records, once, on the first
 * write a person makes. Never on install or start-up: an upgrade that has not
 * been asked to change anything changes nothing.
 *
 * A record that already parses wins — it is newer than the manifest. The
 * manifest leaves the media folder only after every record is on disk, so a
 * crash anywhere above leaves it in place and the next write tries again.
 */
export async function migrateLegacyManifest(roots: MetadataRoots): Promise<void> {
  const legacyPath = join(roots.assetsPath, LEGACY_MANIFEST);

  await serialize(resolve(legacyPath), async () => {
    let raw: string;
    try {
      raw = await readFile(legacyPath, 'utf-8');
    } catch (error) {
      if (error instanceof Error && isNotFoundError(error)) return;
      throw error;
    }

    let legacy: AssetManifestData;
    try {
      const parsed: ParsedJson = JSON.parse(raw);
      if (!isLegacyManifest(parsed)) throw new Error('Invalid asset metadata manifest shape');
      legacy = parsed;
    } catch (error) {
      // Refuse rather than treat it as empty: an unreadable manifest that reads
      // as {} is how every asset's metadata gets written over by the next save.
      throw new Error(
        `Cannot migrate ${LEGACY_MANIFEST}: it is not a valid metadata manifest (${legacyPath}). ` +
          `Fix or remove the file and try again. Cause: ${error instanceof Error ? error.message : 'parse error'}`,
        { cause: error },
      );
    }

    await Promise.all(
      Object.entries(legacy).map(async ([relativePath, entry]) => {
        let key: string;
        try {
          key = lockKey(roots, relativePath);
        } catch {
          // One bad key is not a reason to strand every other picture's metadata.
          console.warn(`[asset-metadata] skipping legacy entry ${relativePath} — it points outside the media library`);
          return;
        }

        await serialize(key, async () => {
          // Each asset has its own lock and record; independent migrations can run together.
          // This migration is the one safe repair window for a damaged record: afterwards the
          // legacy source is removed, and ordinary updates deliberately refuse to overwrite
          // bytes they cannot parse. A record that already parses is newer and always wins.
          if ((await readRecord(roots, relativePath)).state === 'ok') return;
          const metadata: AssetMetadata = {};
          for (const field of STORED_FIELDS) {
            const value = entry[field];
            if (value !== undefined) Object.assign(metadata, { [field]: value });
          }
          await writeRecord(roots, relativePath, metadata);
        });
      }),
    );

    // Copied, then removed, rather than renamed: the content root can sit on
    // another disk than the media folder, and a rename cannot cross disks
    const backup = join(recordsRoot(roots), MIGRATED_MANIFEST);
    await mkdir(dirname(backup), { recursive: true });
    await atomicWriteFile(backup, raw);
    try {
      await unlink(legacyPath);
    } catch (error) {
      // A concurrent first-write may have removed it already; anything else is real
      if (!(error instanceof Error && isNotFoundError(error))) throw error;
    }
  });
}
