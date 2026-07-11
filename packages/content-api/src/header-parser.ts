import matter from 'gray-matter';
import { calculateEtagsFromMdxBuffer, findMdxContentStartPosition } from './etag-utils';
import type { ContentData, ContentManifest, ContentMeta, LocaleVersion, VXJSONFile } from './types';
import { VXJSON } from './vxjson';

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

/**
 * Result of parsing a content blob's header.
 *
 * `repaired === true` means the bytes parsed but were not in canonical form;
 * the manifest reflects the canonical interpretation. The hydrator never
 * writes back; spec 03 may opt to rewrite the file via the FS API's own
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
    }
  | {
      ok: false;
      reason: 'unknown-format' | 'malformed-vxjson' | 'malformed-mdx' | 'unsupported-locale-path';
      message: string;
    };

interface PathParseSuccess {
  kind: 'block' | 'page' | 'data';
  site?: string;
  collection: string;
  locale: string;
  pathname?: string;
  name?: string;
}

/**
 * Pure path → identity mapper. Returns null when the path doesn't match any
 * supported layout or lacks an explicit locale suffix; the caller maps null
 * to a `unsupported-locale-path` ParseHeaderResult.
 *
 * Layouts honoured here mirror filesystem-content-api.ts:137-144 and
 * 00-overview.md "Commit Flow":
 *
 *   - `blocks/<collection>/<name>.<locale>.{mdx,vxjson}` (collection required;
 *     `blocks/<name>.<locale>.ext` is a legacy form that FileSystemContentAPI
 *     repairs by renaming. The pure parser refuses it.)
 *   - `data/<collection>/<name>.<locale>.json`
 *   - `<site>/<collection>/<path...>/<file>.<locale>.vxjson` (pages; `index`
 *     basename maps to the parent path).
 */
function parsePathLayout(path: string): PathParseSuccess | null {
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 3) return null;

  const filename = parts[parts.length - 1];

  if (parts[0] === 'blocks') {
    // blocks/<collection>/<name>.<locale>.<ext>
    if (parts.length !== 3) return null;
    const match = filename.match(/^(.+)\.([a-zA-Z]{2}(?:-[A-Z]{2})?)\.(mdx|vxjson)$/);
    if (!match) return null;
    return { kind: 'block', collection: parts[1], name: match[1], locale: match[2] };
  }

  if (parts[0] === 'data') {
    // data/<collection>/<name>.<locale>.json
    if (parts.length !== 3) return null;
    const match = filename.match(/^(.+)\.([a-z]{2}(?:-[A-Z]{2})?)\.json$/);
    if (!match) return null;
    return { kind: 'data', collection: parts[1], name: match[1], locale: match[2] };
  }

  // <site>/<collection>/<path...>/<file>.<locale>.{vxjson,mdx}
  // Reads accept .mdx pages even though the OSS filesystem writer emits
  // main-layout pages as .vxjson only (its mdx pages live under the separate
  // mdxPagesRoot): the SaaS commit pipeline derives the extension from the
  // content type, so an mdx-typed page lands here as <site>/pages/<f>.<l>.mdx
  // and must re-parse — dropping it made written pages unreadable.
  const match = filename.match(/^(.+)\.([a-zA-Z]{2}(?:-[A-Z]{2})?)\.(mdx|vxjson)$/);
  if (!match) return null;

  const site = parts[0];
  const collection = parts[1];
  const pathParts = parts.slice(2);
  pathParts[pathParts.length - 1] = match[1];
  const pathname =
    pathParts[pathParts.length - 1] === 'index'
      ? `/${pathParts.slice(0, -1).join('/')}` || '/'
      : `/${pathParts.join('/')}`;

  return { kind: 'page', site, collection, locale: match[2], pathname };
}

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
  // Empty options opt out of gray-matter's module-level memo cache — a plain
  // object keyed by the raw input, so inputs naming an Object.prototype member
  // ('valueOf', 'toString', …) return the inherited member instead of a parse.
  // Errors as data, like the JSON/VXJSON siblings: a leading delimiter with
  // unparseable YAML ('---\n[') makes js-yaml throw, and that used to escape
  // straight through parseContentHeader instead of its malformed-mdx result.
  let frontmatter: ReturnType<typeof matter>['data'];
  try {
    ({ data: frontmatter } = matter(partial, {}));
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

function parseFullContent(path: string, bytes: Uint8Array): ContentData | null {
  try {
    if (path.endsWith('.mdx')) {
      // Empty options: see parseHeaderMetadataMdx on the memo-cache hazard.
      const { content } = matter(textDecoder.decode(bytes), {});
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
 * the caller, not here. The Branch DO never writes-on-read; it just records
 * the canonical form for the next commit.
 */
export function parseContentHeader(input: {
  path: string;
  header: Uint8Array;
  size: number;
  complete: boolean;
}): ParseHeaderResult {
  const { path, header, complete } = input;

  const layout = parsePathLayout(path);
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
  };

  const manifest: ContentManifest = {
    id: parsedMeta.id || '',
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

  return { ok: true, manifest, locale: layout.locale, localeVersion, content, repaired };
}
