/**
 * The entry id a complete content file declares, for callers that hold a
 * repository path rather than a content-layout one (a file a commit removed)
 * and must name the entry the index knew it by.
 *
 * Its own subpath, apart from `./indexing`: that chunk evaluates WASM-backed
 * hashing at import time, which a runtime that forbids compiling WASM from
 * bytes refuses. This module imports only the frontmatter parser.
 */
import matter from 'gray-matter';

const textDecoder = new TextDecoder();

/**
 * The id `parseContentHeader` would index the file under, read the same way:
 * YAML frontmatter through gray-matter (fresh options, so no memo cache) for
 * `.mdx`, the top-level `id` of the JSON document for `.json` and `.vxjson`
 * (canonicalizing a complete VXJSON file keeps that field as it is). Null for
 * a non-content file, an unparseable one, or one that declares no id.
 */
export function contentFileId(path: string, bytes: Uint8Array): string | null {
  const text = textDecoder.decode(bytes);
  let id: unknown;
  try {
    if (path.endsWith('.mdx')) id = matter(text, {}).data.id;
    else if (path.endsWith('.json') || path.endsWith('.vxjson')) id = (JSON.parse(text) as { id?: unknown } | null)?.id;
  } catch {
    return null;
  }
  return typeof id === 'string' && id !== '' ? id : null;
}
