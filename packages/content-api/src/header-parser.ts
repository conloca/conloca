import { createHash } from 'node:crypto';
import matter from 'gray-matter';
import { type ContentPathLayout, parseContentPathLayout } from './content-path.js';
import { calculateEtagsFromMdxBuffer, findMdxContentStartPosition } from './etag-utils.js';
import { FRONT_MATTER } from './front-matter.js';
import type { ContentData, ContentManifest, ContentMeta, LocaleVersion, VXJSONFile } from './types.js';
import { toUrlSafeBase64 } from './url-safe-base64.js';
import { VXJSON } from './vxjson.js';

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

/**
 * Result of parsing a content blob's header.
 *
 * `repaired === true` means the bytes parsed but were not in canonical form;
 * the manifest reflects the canonical interpretation. The hydrator never
 * writes back; a caller may opt to rewrite the file via the FS API's own
 * write path, but that decision lives outside this pure parser.
 */
export type ParseHeaderResult =
  | {
      ok: true;
      manifest: ContentManifest;
      locale: string;
      localeVersion: LocaleVersion;
      content?: ContentData;
      repaired: boolean;
      /** The file declares no id, so `manifest.id` comes from its path. */
      idFromPath: boolean;
    }
  | {
      ok: false;
      reason: 'unknown-format' | 'malformed-vxjson' | 'malformed-mdx' | 'unsupported-locale-path';
      message: string;
    };

interface ParsedHeaderMetadata {
  id?: string;
  created?: string;
  modified?: string;
  publishAt?: string;
  unpublishAt?: string;
  previousPathnames?: Record<string, string>;
  meta?: ContentMeta;
  type?: 'puck' | 'mdx' | 'json';
  contentStartPos?: number;
}

function parseHeaderMetadataMdx(bytes: Uint8Array): ParsedHeaderMetadata | null {
  const partial = textDecoder.decode(bytes);
  // FRONT_MATTER keeps dates as written and opts out of gray-matter's memo cache.
  // Errors as data, like the JSON/VXJSON siblings: a leading delimiter with
  // unparseable YAML ('---\n[') makes js-yaml throw, and that used to escape
  // straight through parseContentHeader instead of its malformed-mdx result.
  let frontmatter: ReturnType<typeof matter>['data'];
  try {
    ({ data: frontmatter } = matter(partial, FRONT_MATTER));
  } catch {
    return null;
  }
  const contentStartPos = findMdxContentStartPosition(bytes);
  const { id, created, modified, publishAt, unpublishAt, name: _name, ...rest } = frontmatter;
  return {
    id,
    created,
    modified,
    publishAt,
    unpublishAt,
    meta: rest as ContentMeta,
    contentStartPos,
  };
}

function parseHeaderMetadataJson(bytes: Uint8Array): ParsedHeaderMetadata | null {
  try {
    const data = JSON.parse(textDecoder.decode(bytes));
    return {
      id: data.id,
      type: 'json',
      created: data.created,
      modified: data.modified,
      publishAt: data.publishAt,
      unpublishAt: data.unpublishAt,
      meta: data.meta,
    };
  } catch {
    return null;
  }
}

function parseHeaderMetadataVxjson(bytes: Uint8Array, complete: boolean): ParsedHeaderMetadata | null {
  // VXJSON.parse4KB throws on malformed headers; we want errors-as-data here.
  try {
    return VXJSON.parse4KB(bytes, bytes.length);
  } catch {
    if (!complete) {
      // Could be a thinly truncated header that doesn't yet contain enough
      // metadata to parse. Caller will report malformed-vxjson.
      return null;
    }
    return null;
  }
}

function canonicalizeVxjsonBytes(bytes: Uint8Array): Uint8Array | null {
  try {
    const parsed: VXJSONFile = JSON.parse(textDecoder.decode(bytes));
    const canonical: VXJSONFile = {
      id: parsed.id,
      type: parsed.type,
      created: parsed.created,
      modified: parsed.modified,
      publishAt: parsed.publishAt,
      unpublishAt: parsed.unpublishAt,
      previousPathnames: parsed.previousPathnames,
      meta: parsed.meta || {},
      content: parsed.content || {},
    };
    return textEncoder.encode(VXJSON.serialize(canonical));
  } catch {
    return null;
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function deriveType(path: string, parsed: ParsedHeaderMetadata): 'puck' | 'mdx' | 'json' {
  if (parsed.type) return parsed.type;
  if (path.endsWith('.mdx')) return 'mdx';
  if (path.endsWith('.json')) return 'json';
  return 'puck';
}

/**
 * The id of a file that declares none, from where it sits: its kind, site, collection and pathname or name, the same
 * for every locale. Every read gives the same id, and only a save writes it into the file, so a move or rename made in
 * the editor keeps it. A file moved outside the editor before any save gets the id of its new place: to the index the
 * old page went and a new one came, as for any file that changes its declared id. A header cut off inside its front
 * matter gets none: its `id` may follow the cut.
 * An id-less file later added at a place a saved page has left derives that page's id: the index keeps the page that
 * names it and reports the newcomer as a duplicate id until it is given an `id` of its own.
 */
function idFromPlace(layout: ContentPathLayout): string {
  const place = [layout.kind, layout.site ?? '', layout.collection, layout.pathname ?? layout.name ?? ''].join('\0');
  return `vx-${toUrlSafeBase64(createHash('sha256').update(place).digest()).slice(0, 8)}`;
}

function parseFullContent(path: string, bytes: Uint8Array): ContentData | null {
  try {
    if (path.endsWith('.mdx')) {
      // FRONT_MATTER: see parseHeaderMetadataMdx.
      const { content } = matter(textDecoder.decode(bytes), FRONT_MATTER);
      return { mdx: content };
    }
    const data = JSON.parse(textDecoder.decode(bytes));
    if (path.endsWith('.json')) return { data: data.data || {} };
    return data.content || {};
  } catch {
    return null;
  }
}

function etagFor(path: string, bytes: Uint8Array, contentStartPos?: number): string | null {
  if (path.endsWith('.mdx')) {
    const etags = calculateEtagsFromMdxBuffer(bytes, contentStartPos ?? findMdxContentStartPosition(bytes));
    return `${etags.metaEtag}.${etags.contentEtag}`;
  }
  if (path.endsWith('.json')) {
    return VXJSON.calculateSimpleEtag(bytes);
  }
  const result = VXJSON.calculateETags(bytes);
  if (!result.success) return null;
  return result.contentEtag ? `${result.metaEtag}.${result.contentEtag}` : result.metaEtag;
}

/**
 * Parse a content blob's header bytes (default 4 KB) into a manifest entry.
 *
 * Pure: no I/O, no clock, no FS. The `repaired` flag means "header bytes
 * were not canonical, so we computed the canonical manifest entry from a
 * repaired in-memory copy" — actual writes (e.g., FS rename) happen in
 * the caller, not here; a caller that cannot write keeps the canonical entry
 * as it is.
 */
export function parseContentHeader(input: {
  path: string;
  header: Uint8Array;
  size: number;
  complete: boolean;
}): ParseHeaderResult {
  const { path, header, complete } = input;

  const layout = parseContentPathLayout(path);
  if (!layout) {
    return {
      ok: false,
      reason: 'unsupported-locale-path',
      message: `Path does not match any known content layout: ${path}`,
    };
  }

  let parsedMeta: ParsedHeaderMetadata | null;
  let bytes = header;
  let repaired = false;

  if (path.endsWith('.mdx')) {
    parsedMeta = parseHeaderMetadataMdx(bytes);
    if (!parsedMeta) {
      return { ok: false, reason: 'malformed-mdx', message: `Could not parse MDX header for ${path}` };
    }
  } else if (path.endsWith('.json')) {
    parsedMeta = parseHeaderMetadataJson(bytes);
    if (!parsedMeta) {
      return { ok: false, reason: 'malformed-vxjson', message: `Could not parse JSON header for ${path}` };
    }
  } else if (path.endsWith('.vxjson')) {
    if (complete) {
      // For complete blobs, treat canonical-form serialization as the
      // source of truth for etag stability. Even if VXJSON.calculateETags
      // succeeds on the raw bytes, the meta-etag depends on the alphabetic
      // sort order that VXJSON.serialize enforces — so a file whose
      // metadata fields are in a different order produces a different
      // meta-etag than its canonical form. Re-serialize, compare, mark
      // repaired when bytes diverge.
      const canonical = canonicalizeVxjsonBytes(bytes);
      if (canonical) {
        if (!bytesEqual(canonical, bytes)) {
          bytes = canonical;
          repaired = true;
        }
        parsedMeta = parseHeaderMetadataVxjson(bytes, true);
      } else {
        parsedMeta = null;
      }
    } else {
      // Partial header: parse what we can; no canonicalisation possible
      // without the full blob, and `complete: false` is the caller's
      // signal that the etag will be deferred.
      parsedMeta = parseHeaderMetadataVxjson(bytes, false);
    }
    if (!parsedMeta) {
      return { ok: false, reason: 'malformed-vxjson', message: `Could not parse VXJSON header for ${path}` };
    }
  } else {
    return { ok: false, reason: 'unknown-format', message: `Unknown file extension for ${path}` };
  }

  const type = deriveType(path, parsedMeta);

  const localeVersion: LocaleVersion = {
    locale: layout.locale,
    etag: '',
    created: parsedMeta.created || '',
    modified: parsedMeta.modified || '',
    ...(parsedMeta.publishAt ? { publishAt: parsedMeta.publishAt } : {}),
    ...(parsedMeta.unpublishAt ? { unpublishAt: parsedMeta.unpublishAt } : {}),
    ...(layout.pathname ? { pathname: layout.pathname } : {}),
    ...(parsedMeta.previousPathnames ? { previousPathnames: parsedMeta.previousPathnames } : {}),
    ...(layout.name ? { name: layout.name } : {}),
    meta: parsedMeta.meta || { title: layout.name || 'Untitled' },
    sourcePath: path,
  };

  // An MDX header cut off inside its front matter may hold the id past the cut, so it gets none from its path. The
  // decoder drops a leading BOM, so six bytes hold the opening `---` either way.
  const frontMatterCut =
    !complete && parsedMeta.contentStartPos === -1 && textDecoder.decode(bytes.subarray(0, 6)).startsWith('---');
  // shortcut: path ids only for MDX pages (#563); fragments and data keep id '' until #634 gives every reader the
  // same id, else a saved reference could name an id the built site can't resolve.
  const idFromPath = layout.kind === 'page' && path.endsWith('.mdx') && !parsedMeta.id && !frontMatterCut;
  const manifest: ContentManifest = {
    id: parsedMeta.id || (idFromPath ? idFromPlace(layout) : ''),
    type,
    kind: layout.kind,
    site: layout.site,
    collection: layout.collection,
    locales: { [layout.locale]: localeVersion },
  };

  let content: ContentData | undefined;
  if (complete || repaired) {
    const full = parseFullContent(path, bytes);
    if (full) content = full;
    const etag = etagFor(path, bytes, parsedMeta.contentStartPos);
    if (etag) localeVersion.etag = etag;
  }

  return { ok: true, manifest, locale: layout.locale, localeVersion, content, repaired, idFromPath };
}
