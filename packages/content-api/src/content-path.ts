/**
 * The ONE locale/path grammar for content files.
 *
 * Every reader that turns a storage path back into content identity parses it
 * here: the pure header parser, the filesystem indexer, and any other reader
 * of content files. Each of those used to carry its own copy of the
 * regex and the copies disagreed — a copy that refused `about.EN.mdx`
 * made content the index had accepted unreadable, and an indexer copy
 * matching `\w+` filed `about.en-US.mdx` under a fallback locale with no
 * pathname at all.
 *
 * Zero imports on purpose: some consumers embed this module where nothing
 * effectful may run at import time.
 */

/**
 * A two-letter language subtag, optionally followed by a two-letter upper-case
 * region (`en`, `nl`, `en-US`). Case is PRESERVED, never normalized: writers
 * splice this exact string back into the filename (`getFilePath`, and any other
 * writer of content files), so lower-casing it here would make a repo holding
 * `about.EN.mdx` save its next edit to `about.en.mdx` and orphan the original.
 *
 * Wider BCP-47 forms (three-letter languages, script subtags like `zh-Hans`,
 * lower-case regions) are deliberately NOT accepted: no spec text defines the
 * grammar, and every writer in the system emits this shape today.
 */
const LOCALE_SUBTAG = '[a-zA-Z]{2}(?:-[A-Z]{2})?';

const LOCALE = new RegExp(`^${LOCALE_SUBTAG}$`);

/**
 * Whether `locale` is one this grammar reads back. A writer checks a new entry's locale with it:
 * the locale is spliced into the file path, so anything else is either unreadable or, like
 * '../x', a path out of the entry's folder.
 */
export function isContentLocale(locale: string): boolean {
  return LOCALE.test(locale);
}

/** `<base>.<locale>.<ext>` — the filename half of every content layout. */
const LOCALE_FILENAME = new RegExp(`^(.+)\\.(${LOCALE_SUBTAG})\\.(mdx|vxjson|json)$`);

export type ContentFileExtension = 'mdx' | 'vxjson' | 'json';

export interface LocaleFilename {
  /** Filename with the `.<locale>.<ext>` suffix removed. */
  base: string;
  /** Locale exactly as written in the filename. */
  locale: string;
  extension: ContentFileExtension;
}

/** Split `<base>.<locale>.<ext>`. Null when the filename carries no locale suffix. */
export function parseLocaleFilename(filename: string): LocaleFilename | null {
  const match = LOCALE_FILENAME.exec(filename);
  if (!match) return null;
  return { base: match[1], locale: match[2], extension: match[3] as ContentFileExtension };
}

export interface ContentPathLayout {
  kind: 'fragment' | 'page' | 'data';
  site?: string;
  collection: string;
  locale: string;
  pathname?: string;
  name?: string;
}

/**
 * Pure path → identity mapper. Returns null when the path doesn't match any
 * supported layout or lacks an explicit locale suffix.
 *
 * Layouts honoured here mirror filesystem-content-api.ts:137-144:
 *
 *   - `fragments/<collection>/<name>.<locale>.{mdx,vxjson}` (collection required;
 *     `fragments/<name>.<locale>.ext` is a legacy form that FileSystemContentAPI
 *     repairs by renaming. The pure parser refuses it.)
 *   - `data/<collection>/<name>.<locale>.json`
 *   - `<site>/<collection>/<path...>/<file>.<locale>.{vxjson,mdx}` (pages; `index`
 *     basename maps to the parent path).
 *
 * Reads accept .mdx pages even though the filesystem writer emits main-layout
 * pages as .vxjson only (its mdx pages live under the separate mdxPagesRoot):
 * another writer may derive the extension from the content type, so an
 * mdx-typed page can land here as <site>/pages/<f>.<l>.mdx and must re-parse —
 * dropping it made written pages unreadable.
 */
export function parseContentPathLayout(path: string): ContentPathLayout | null {
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 3) return null;

  const suffix = parseLocaleFilename(parts[parts.length - 1]);
  if (!suffix) return null;

  if (parts[0] === 'fragments') {
    if (parts.length !== 3 || suffix.extension === 'json') return null;
    return { kind: 'fragment', collection: parts[1], name: suffix.base, locale: suffix.locale };
  }

  if (parts[0] === 'data') {
    if (parts.length !== 3 || suffix.extension !== 'json') return null;
    return { kind: 'data', collection: parts[1], name: suffix.base, locale: suffix.locale };
  }

  if (suffix.extension === 'json') return null;

  const pathParts = parts.slice(2);
  pathParts[pathParts.length - 1] = suffix.base;
  const pathname =
    pathParts[pathParts.length - 1] === 'index' ? `/${pathParts.slice(0, -1).join('/')}` : `/${pathParts.join('/')}`;

  return { kind: 'page', site: parts[0], collection: parts[1], locale: suffix.locale, pathname };
}
