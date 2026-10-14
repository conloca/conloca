import { access, mkdir, open, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import matter from 'gray-matter';
import sortKeys from 'sort-keys';
import type { ContentAPI } from './content-api.interface.js';
import { filterContentWithIndexes } from './content-filters.js';
import { ContentIndex, duplicateIdMessage, type IndexProblem, unknownSiteMessage } from './content-index.js';
import {
  analyzeUpdateScope,
  buildLocaleVersion,
  buildPathnameHistory,
  checkEntryName,
  checkMdxPagesPathname,
  checkPagePathname,
  generateContentId,
  isContentPublished,
  type PathnameRefusal,
  shouldUpdateModifiedTimestamp,
  UPDATE_SCOPE,
  updatePublishDates,
  validateAndPrepareMetadata,
  validateCreateContent,
} from './content-operations.js';
import {
  type ContentPathLayout,
  invalidLocaleMessage,
  isContentLocale,
  parseContentPathLayout,
  parseLocaleFilename,
} from './content-path.js';
import {
  applyMetaPatch,
  localesOf,
  mapSiteNames,
  resolvePublishDate,
  serializeMdxWithFrontmatter,
} from './content-utils.js';
import { Data } from './data.js';
import { calculateEtagsFromMdxBuffer, findMdxContentStartPosition, parseDualEtag } from './etag-utils.js';
import { Fragments } from './fragments.js';
import { Site } from './site.js';
import type {
  BatchOperationResult,
  BatchResult,
  ContentAPIOptions,
  ContentData,
  ContentEntry,
  ContentIdentity,
  ContentManifest,
  ContentMeta,
  ContentProp,
  ContentType,
  CreateContentInput,
  CreateResult,
  DeleteLocaleInput,
  DeleteResult,
  FindOptions,
  GlobalFilters,
  LocaleFileData,
  LocalePathData,
  LocaleVersion,
  LocalizedEntry,
  LocalizedManifest,
  SitesConfig,
  UpdateLocaleInput,
  UpdateResult,
  VXJSONFile,
} from './types.js';
import { atomicWriteFile } from './utils/atomic-write.js';
import { xxh64 } from './xxhash.js';

interface ReindexResult {
  filesProcessed: number;
  filesSkipped: number;
  filesDeleted?: number;
  errors?: number;
  // Return manifests of updated locales (without content)
  updated: LocalizedManifest[];
  deleted?: Array<{ id: string; locale: string; kind: 'page' | 'fragment' | 'data' }>;
}

import { VXJSON } from './vxjson.js';

// Helper to ensure we have an Error object
function ensureError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

// Reusable TextDecoder instance - safe to reuse as it's stateless
const textDecoder = new TextDecoder();

/**
 * Where the read repair moves a fragment saved straight into fragments/: the
 * folder the editor saves new fragments to, which every conlocaFragments(...)
 * call in a site's content config declares, so the moved fragment still builds.
 */
const REPAIRED_FRAGMENT_COLLECTION = 'fragments';

async function readFilePrefix(filePath: string, buffer: Uint8Array): Promise<number> {
  const handle = await open(filePath, 'r');
  try {
    return (await handle.read(buffer, 0, buffer.byteLength, 0)).bytesRead;
  } finally {
    await handle.close();
  }
}

// Parse 4KB MDX content - extracts frontmatter from buffer
function parse4KBMDX(
  buffer: Uint8Array,
  bytesRead: number,
): {
  id?: string;
  created?: string;
  modified?: string;
  publishAt?: string;
  unpublishAt?: string;
  meta: ContentMeta;
  contentStartPos?: number; // Position where content starts (after second ---)
} {
  // Only convert to string what we need
  const partialContent = textDecoder.decode(buffer.subarray(0, bytesRead));
  // Empty options opt out of gray-matter's module-level memo cache — a plain
  // object keyed by the raw input, so inputs naming an Object.prototype member
  // ('valueOf', 'toString', …) return the inherited member instead of a parse.
  // Same at every matter() call below.
  const { data: frontmatter } = matter(partialContent, {});

  // Find where content starts (after second ---)
  const delimiter = new TextEncoder().encode('---');
  let delimiterCount = 0;
  let contentStartPos = -1;

  for (let i = 0; i <= bytesRead - delimiter.length; i++) {
    let match = true;
    for (let j = 0; j < delimiter.length; j++) {
      if (buffer[i + j] !== delimiter[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      delimiterCount++;
      if (delimiterCount === 2) {
        // Skip past --- and newline
        contentStartPos = i + delimiter.length;
        while (contentStartPos < bytesRead && (buffer[contentStartPos] === 0x0a || buffer[contentStartPos] === 0x0d)) {
          contentStartPos++;
        }
        break;
      }
    }
  }

  // Extract special fields and treat the rest as metadata
  const { id, created, modified, publishAt, unpublishAt, name, ...metaFields } = frontmatter;

  return {
    id,
    created,
    modified,
    publishAt,
    unpublishAt,
    meta: metaFields as ContentMeta, // All other fields are metadata
    contentStartPos,
  };
}

/**
 * FileSystem-based Content API Implementation
 *
 * Stores content as files on disk in a git-friendly format:
 * - Pages: /{site}/pages/{filename}.{locale}.vxjson
 * - Fragments: /fragments/{collection}/{filename}.{locale}.{mdx|vxjson}
 *
 * ## Indexing
 *
 * Content is indexed at startup for performance. The index is cached per
 * content root path and cleared when the process restarts.
 *
 * ## Read-Repair
 *
 * Since files can be modified externally (git, editors), this implementation:
 *
 * 1. Repairs invalid VXJSON files (ensures "content" field is last)
 * 2. Adds missing required fields (id, created, modified)
 * 3. Handles files added after initial indexing
 * 4. Updates the index when files are repaired or discovered
 *
 * ## Performance
 *
 * - Initial indexing reads only first 4KB of each file
 * - Full content is loaded on demand
 * - ETags are calculated using streaming for efficiency
 */
/**
 * Read and validate `<contentRoot>/sites.json`. Returns a safe default
 * (`{ sites: {}, globalLocales: ['en'] }`) when the file is missing or
 * has invalid structure, with a warning logged in each case.
 *
 * Exported standalone so the Astro integration (and any other tooling
 * that needs to inspect per-site config at startup time) can read the
 * config without spinning up a full content-api instance.
 */
export async function readSitesConfig(contentRoot: string): Promise<SitesConfig> {
  const absoluteContentRoot = resolve(contentRoot);
  const sitesPath = join(absoluteContentRoot, 'sites.json');
  let content: string;
  try {
    content = await readFile(sitesPath, 'utf-8');
  } catch {
    // A genuinely absent sites.json is a normal starting state.
    console.warn(`Warning: sites.json is missing at ${sitesPath}. Using empty configuration.`);
    return { sites: {}, globalLocales: ['en'] };
  }

  // Tolerating a malformed sites.json is deliberate ("Handle invalid sites.json gracefully"). What
  // was not deliberate is the diagnosis: this used to share the catch above
  // and report the file as MISSING, naming a path where it plainly sits,
  // while every page silently dropped out of every site. Say what is
  // actually wrong; the tolerance itself is unchanged.
  let parsed: SitesConfig;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    console.warn(
      `Warning: sites.json at ${sitesPath} is not valid JSON (${messageOf(error)}). ` +
        'Using empty configuration — every site will be empty until this is fixed.',
    );
    return { sites: {}, globalLocales: ['en'] };
  }
  // Validate the structure. `null` is valid JSON, so `parsed` itself needs
  // the null check before anything reads a property off it.
  if (!parsed?.sites || typeof parsed.sites !== 'object') {
    console.warn(
      `Warning: sites.json has invalid structure at ${sitesPath}. Expected 'sites' property. Using default configuration.`,
    );
    return { sites: {}, globalLocales: ['en'] };
  }
  if (!parsed.globalLocales || !Array.isArray(parsed.globalLocales)) {
    console.warn(`Warning: sites.json is missing 'globalLocales' array at ${sitesPath}. Using default global locales.`);
    warnUnreadableLocales(sitesPath, parsed.sites, []);
    return {
      sites: parsed.sites,
      globalLocales: ['en'],
    };
  }
  warnUnreadableLocales(sitesPath, parsed.sites, parsed.globalLocales);
  return parsed;
}

/**
 * Why a page file's name gives no locale the content grammar reads: either it
 * names one the grammar refuses ('about.pt-br.vxjson') or it names none.
 */
function unreadablePageLocaleMessage(filename: string): string {
  const written = /^.+\.([^.]+)\.(?:mdx|vxjson)$/.exec(filename)?.[1];
  return written === undefined
    ? `Page file ${filename} has no locale in its name (<name>.<locale>.vxjson), so it is not indexed.`
    : `Page file ${filename} is not indexed. ${invalidLocaleMessage(written)}`;
}

// One warning per sites.json and locale for the whole process: the file is
// read again by every content API created and every config reload.
const warnedLocales = new Set<string>();

/**
 * Warn about each locale sites.json declares that content file names cannot
 * carry: its pages can be neither created nor read, and nothing else says so
 * until a save is refused.
 */
function warnUnreadableLocales(sitesPath: string, sites: SitesConfig['sites'], globalLocales: unknown[]): void {
  const declared = [...globalLocales];
  for (const site of Object.values(sites)) {
    if (Array.isArray(site?.locales)) declared.push(...site.locales);
    declared.push(site?.defaultLocale);
  }
  for (const locale of declared) {
    const key = `${sitesPath}\0${locale}`;
    if (typeof locale !== 'string' || isContentLocale(locale) || warnedLocales.has(key)) continue;
    warnedLocales.add(key);
    console.warn(
      `Warning: sites.json at ${sitesPath} declares a locale no content file can carry, so its pages can be neither created nor read. ${invalidLocaleMessage(locale)}`,
    );
  }
}

export type { IndexProblem } from './content-index.js';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class FileSystemContentAPI implements ContentAPI {
  private contentRoot: string;
  private absoluteContentRoot: string;
  private contentIndex: ContentIndex;
  readonly sitesConfig: SitesConfig;
  readonly fragments: Fragments;
  readonly data: Data;
  private readonly sites: Record<string, Site>;

  // mdx-page support: optional second filesystem root for kind:'page'+type:'mdx'.
  // Canonical source is the resolved site's `mdxPages` in sites.json; the
  // ContentAPIOptions.mdxPagesRoot option exists as a test/programmatic
  // override. See ContentAPIOptions.mdxPagesRoot for the design rationale.
  private absoluteMdxPagesRoot?: string;
  private mdxPagesDefaultLocale = 'en';
  private mdxPagesSite = 'default';
  private mdxPagesCollection = 'pages';

  // Resolved locale list used to decide whether a path segment that
  // looks locale-shaped (e.g. `de`, `en-US`) is actually a configured
  // locale. Source-of-truth resolution (option > sites.json) happens in
  // the constructor; parsers read this set directly.
  private readonly availableLocales: ReadonlySet<string>;

  // Getter for testing purposes
  get normalizedContentRoot(): string {
    return this.contentRoot;
  }

  private constructor(
    contentRoot: string,
    sitesConfig: SitesConfig,
    contentIndex: ContentIndex,
    mdxPagesOptions?: {
      root?: string;
      defaultLocale?: string;
      site?: string;
    },
    localeOptions?: {
      availableLocales?: string[];
      defaultLocale?: string;
    },
  ) {
    // Normalize contentRoot: remove ./ prefix for relative paths, keep absolute paths as-is
    if (contentRoot.startsWith('./')) {
      this.contentRoot = contentRoot.slice(2);
    } else if (contentRoot.startsWith('/')) {
      // Absolute path, keep as-is
      this.contentRoot = contentRoot;
    } else {
      // Already normalized relative path
      this.contentRoot = contentRoot;
    }

    // Store absolute path for file operations
    this.absoluteContentRoot = resolve(this.contentRoot);

    this.sitesConfig = sitesConfig;
    this.contentIndex = contentIndex;

    // Resolve which site owns mdx-type pages. Resolution order:
    //   1. Explicit `mdxPagesOptions.site` (test / programmatic override)
    //   2. First site in sites.json that declares an `mdxPages` path
    //   3. First configured site (any)
    //   4. Literal 'default'
    const siteNames = Object.keys(sitesConfig.sites);
    const firstSiteName = siteNames[0];
    const firstSiteWithMdxPages = siteNames.find((name) => sitesConfig.sites[name]?.mdxPages);
    this.mdxPagesSite = mdxPagesOptions?.site ?? firstSiteWithMdxPages ?? firstSiteName ?? 'default';

    // Resolve the mdx-pages path. Option wins over sites.json so tests and
    // programmatic callers can supply a path without writing a sites.json
    // file. When neither is set, .mdx files fall back to living alongside
    // Puck pages under `{contentRoot}/{site}/pages/`.
    const sitesJsonMdxPages = sitesConfig.sites[this.mdxPagesSite]?.mdxPages;
    const resolvedMdxPages = mdxPagesOptions?.root ?? sitesJsonMdxPages;
    if (resolvedMdxPages) {
      const normalizedMdxPages = resolvedMdxPages.startsWith('./') ? resolvedMdxPages.slice(2) : resolvedMdxPages;
      this.absoluteMdxPagesRoot = resolve(normalizedMdxPages);
    }
    // Default locale: top-level option > mdxPages option > resolved-site's
    // defaultLocale > first global locale > 'en'. The top-level option wins
    // because it represents an explicit framework-level declaration (e.g.
    // forwarded from Astro's i18n block via localesFromAstroI18n).
    const siteConfig = sitesConfig.sites[this.mdxPagesSite];
    this.mdxPagesDefaultLocale =
      localeOptions?.defaultLocale ??
      mdxPagesOptions?.defaultLocale ??
      siteConfig?.defaultLocale ??
      sitesConfig.globalLocales[0] ??
      'en';

    // Resolve the available-locales set. The top-level option is
    // authoritative when present; otherwise we merge sites.json's global
    // locales with the resolved-site's per-site locales. The default
    // locale is always added so getFilePath round-trips work.
    const merged = new Set<string>();
    if (localeOptions?.availableLocales && localeOptions.availableLocales.length > 0) {
      for (const loc of localeOptions.availableLocales) merged.add(loc);
    } else {
      for (const loc of sitesConfig.globalLocales) merged.add(loc);
      if (siteConfig?.locales) {
        for (const loc of siteConfig.locales) merged.add(loc);
      }
    }
    merged.add(this.mdxPagesDefaultLocale);
    this.availableLocales = merged;

    // Initialize fragments
    this.fragments = new Fragments(this, this.contentIndex.getFragmentIndex());

    // Initialize data
    this.data = new Data(this, this.contentIndex.getDataIndex());

    // Initialize all sites
    this.sites = mapSiteNames(sitesConfig, (siteName) => {
      const siteIndex = this.contentIndex.getSiteIndex(siteName);
      if (!siteIndex) {
        throw new Error(`Site index not found for ${siteName}`);
      }
      return new Site(siteName, this, siteIndex);
    });
  }

  static async create(options: ContentAPIOptions): Promise<FileSystemContentAPI> {
    // Keep contentRoot as provided (will be normalized in constructor)
    const contentRoot = options.contentRoot;

    // Load sites config (canonical home for per-site fields including mdxPages).
    let sitesConfig = await readSitesConfig(contentRoot);

    // Apply the top-level locales option as the authoritative source.
    // We expand sitesConfig so that the FragmentIndex (which keys on
    // globalLocales) and the resolved SiteIndex (which keys on the
    // site's locales array) both have slots for every option-declared
    // locale. Without this, the parser would correctly identify a file's
    // locale but `addContent` would crash on a missing index bucket.
    // We preserve the resolved site's existing `mdxPages` and `domains`
    // through the rewrite so the locale-override doesn't clobber the
    // per-site content config.
    if (options.availableLocales && options.availableLocales.length > 0) {
      const optionDefaultLocale = options.defaultLocale ?? options.availableLocales[0];
      const optionSite = options.mdxPagesSite ?? Object.keys(sitesConfig.sites)[0] ?? 'default';
      const existingSite = sitesConfig.sites[optionSite];
      sitesConfig = {
        sites: {
          ...sitesConfig.sites,
          [optionSite]: {
            locales: options.availableLocales,
            defaultLocale: optionDefaultLocale,
            ...(existingSite?.domains && { domains: existingSite.domains }),
            ...(existingSite?.mdxPages && { mdxPages: existingSite.mdxPages }),
          },
        },
        globalLocales: Array.from(new Set([...sitesConfig.globalLocales, ...options.availableLocales])),
      };
    }

    // Get cached content index or create new one
    // Use the normalized contentRoot for cache key
    const normalizedContentRoot = contentRoot.startsWith('./') ? contentRoot.slice(2) : contentRoot;
    const contentIndex = await ContentIndex.getCachedOrCreate(normalizedContentRoot, sitesConfig);

    // Create instance (not cached)
    const api = new FileSystemContentAPI(
      contentRoot,
      sitesConfig,
      contentIndex,
      {
        root: options.mdxPagesRoot,
        defaultLocale: options.mdxPagesDefaultLocale,
        site: options.mdxPagesSite,
      },
      {
        availableLocales: options.availableLocales,
        defaultLocale: options.defaultLocale,
      },
    );

    // Index all content files (only if index is empty).
    //
    // FileSystemContentAPI continues to hydrate via parseFileHeaderWithRepair
    // (legacy path), which performs read-repair side effects on disk (renaming
    // missing-locale files, rewriting non-canonical VXJSON, adding missing
    // id/created/modified). ContentIndex.indexAll(backend) is the newer,
    // backend-agnostic hydration path for content that is not on disk;
    // FileSystemContentAPI's behavior must stay identical, so this call site
    // keeps the legacy path until the repair side effects move behind a backend.
    if (contentIndex.entryCount === 0) {
      await api.indexAllContent();
    }

    return api;
  }

  /**
   * Hydrate the content index for this FileSystemContentAPI by scanning the
   * content root and running parseFileHeaderWithRepair on each file. This is
   * the legacy hydration path that preserves the filesystem read-repair
   * behavior (file renames, canonical-form rewrites, id/timestamp backfill).
   *
   * ContentIndex.indexAll(backend) is the backend-agnostic replacement for
   * content that is not on disk; this private method exists so FileSystemContentAPI
   * can keep its repair-on-read side effects until they are lifted onto a
   * dedicated FileSystemReaderBackend field.
   */
  private async indexAllContent(): Promise<void> {
    // Also drops the previous problems: they describe an index that no longer exists.
    this.contentIndex.clear();

    const files = await this.scanContentFiles();
    const OPTIMAL_BATCH_SIZE = 1000;
    console.debug(`Indexing ${files.length} content files...`);

    // Which file claimed each id+locale — same guard ContentIndex.indexAll
    // carries. Without it a duplicated file merges into the first one's
    // locale slot and a page silently stops existing, and this legacy path
    // is the one every local dev server and Astro build hydrates through.
    const claimedBy = new Map<string, string>();

    // One 4KB buffer per file in a batch: the batch is read in parallel, so
    // two files sharing a buffer overwrite each other's bytes mid-parse.
    // parseFileHeaderWithRepair owns the buffer contract (reads up to 4096
    // bytes from offset 0).
    const buffers = Array.from({ length: Math.min(files.length, OPTIMAL_BATCH_SIZE) }, () => new Uint8Array(4096));

    for (let i = 0; i < files.length; i += OPTIMAL_BATCH_SIZE) {
      const batch = files.slice(i, i + OPTIMAL_BATCH_SIZE);
      await Promise.all(
        batch.map(async (filePath, batchIndex) => {
          try {
            const result = await this.parseFileHeaderWithRepair(filePath, buffers[batchIndex]);
            if (result) {
              // Same reason as the shared indexAll loop: a page under a site
              // sites.json does not declare would be filed nowhere and
              // silently vanish from every lookup and build.
              if (
                result.manifest.kind === 'page' &&
                result.manifest.site &&
                !this.contentIndex.hasSite(result.manifest.site)
              ) {
                this.recordIndexProblem(filePath, 'unknown-site', unknownSiteMessage(result.manifest.site));
                return;
              }
              const claim = `${result.manifest.id}::${result.localeVersion.locale}`;
              const claimant = claimedBy.get(claim);
              if (claimant !== undefined && claimant !== filePath) {
                this.recordIndexProblem(
                  filePath,
                  'duplicate-id',
                  duplicateIdMessage(result.manifest.id, result.localeVersion.locale, claimant),
                );
                return;
              }
              claimedBy.set(claim, filePath);
              this.contentIndex.addContent(result.manifest, result.localeVersion, result.content);
            }
          } catch (error) {
            console.error(`Failed to index ${filePath}: ${messageOf(error)}`);
            this.recordIndexProblem(filePath, 'index-error', messageOf(error));
          }
        }),
      );
    }
  }

  /**
   * Record a file the indexer could not read. Signature matches the `onError`
   * callback of ContentIndex.indexAll so it can be handed over unchanged when
   * this class migrates off the legacy repair-on-read hydration path. The
   * problems live on the index itself, not on this instance: the index is
   * cached per content root, and a later instance over the same root reuses it
   * without re-indexing, so instance-local problems would vanish.
   */
  private recordIndexProblem(path: string, reason: string, message: string): void {
    this.contentIndex.recordProblem(path, reason, message);
  }

  /**
   * Files the indexer could not read. They are absent from listAllContent(),
   * so any caller that treats that list as complete — `conloca doctor`, most
   * of all — must consult this to avoid reporting success over broken content.
   */
  getIndexProblems(): readonly IndexProblem[] {
    return this.contentIndex.getProblems();
  }

  /**
   * Clear all caches - useful for testing
   */
  static clearCaches(): void {
    ContentIndex.clearCache();
    // TODO: CanvasIndex.clearCache() when implemented
  }

  private async parseFileHeaderWithRepair(
    originalFilePath: string,
    buffer: Uint8Array,
  ): Promise<{
    manifest: ContentManifest;
    locale: string;
    localeVersion: LocaleVersion;
    bytesRead: number;
    content?: ContentData;
  } | null> {
    let bytesRead = 0;
    let filePath = originalFilePath; // Use a local variable that can be updated if file is renamed

    try {
      bytesRead = await readFilePrefix(filePath, buffer);
    } catch (error) {
      console.error(`Error reading ${filePath}:`, error);
      throw error;
    }

    try {
      // Now parse the buffer content

      // Parse file to extract metadata
      let relativePath = filePath.replace(`${this.absoluteContentRoot}/`, '');
      let parts = relativePath.split('/');

      // Determine site/collection structure
      let site: string | undefined;
      let collection: string;
      let locale = 'en';
      let name: string | undefined;
      let pathname: string | undefined;
      // Type for parsed metadata from files
      interface ParsedMetadata {
        id?: string;
        created?: string;
        modified?: string;
        publishAt?: string;
        unpublishAt?: string;
        pathname?: string;
        name?: string;
        previousPathnames?: Record<string, string>;
        meta?: ContentMeta;
        type?: 'puck' | 'mdx' | 'json';
        contentStartPos?: number;
        data?: Record<string, unknown>; // For data collection entries
      }
      let parsedData: ParsedMetadata = {};
      let kind: 'fragment' | 'page' | 'data';

      // Files under the optional mdxPagesRoot are kind:'page' + type:'mdx',
      // independent of the directory tree rooted at absoluteContentRoot. The
      // leading prefix is stripped here; locale lives as a directory segment
      // ({locale}/{slug}.mdx for non-default locales, {slug}.mdx at the root
      // for the default locale).
      if (this.absoluteMdxPagesRoot && filePath.startsWith(`${this.absoluteMdxPagesRoot}/`)) {
        kind = 'page';
        site = this.mdxPagesSite;
        collection = this.mdxPagesCollection;
        const mdxRelativePath = filePath.replace(`${this.absoluteMdxPagesRoot}/`, '');
        const mdxParts = mdxRelativePath.split('/');
        const mdxFilename = mdxParts[mdxParts.length - 1];

        const noLocaleMatch = mdxFilename.match(/^(.+)\.mdx$/);
        if (!noLocaleMatch) return null;
        mdxParts[mdxParts.length - 1] = noLocaleMatch[1];

        // A leading folder counts as a locale only when it's a configured
        // locale. A two-letter folder like `qa/` or `id/` is therefore
        // left in the slug, not silently classified as a language.
        if (mdxParts.length > 1 && this.availableLocales.has(mdxParts[0])) {
          locale = mdxParts[0];
          const slugParts = mdxParts.slice(1);
          pathname =
            slugParts[slugParts.length - 1] === 'index'
              ? `/${slugParts.slice(0, -1).join('/')}`
              : `/${slugParts.join('/')}`;
        } else {
          locale = this.mdxPagesDefaultLocale;
          pathname =
            mdxParts[mdxParts.length - 1] === 'index'
              ? `/${mdxParts.slice(0, -1).join('/')}`
              : `/${mdxParts.join('/')}`;
        }

        parsedData = parse4KBMDX(buffer, bytesRead);
      } else if (parts[0] === 'fragments') {
        kind = 'fragment';

        // Check if fragment is directly in fragments/ directory (no collection subdirectory)
        if (parts.length === 2) {
          // Keep the direct layout unless the repair move succeeds.
          collection = '';
          const filename = parts[1];

          // Create the repair folder if it doesn't exist
          const repairDir = join(this.absoluteContentRoot, 'fragments', REPAIRED_FRAGMENT_COLLECTION);
          try {
            await mkdir(repairDir, { recursive: true });
          } catch {
            // Directory might already exist, that's fine
          }

          // Move the file to the repair folder
          const newFilePath = join(repairDir, filename);

          try {
            // Check if target file already exists
            try {
              await access(newFilePath);
              console.warn(
                `Cannot move ${filename} to fragments/${REPAIRED_FRAGMENT_COLLECTION}/: target file already exists`,
              );
            } catch {
              // Target doesn't exist, safe to move
              await rename(filePath, newFilePath);
              console.log(`Repaired: Moved ${filename} to fragments/${REPAIRED_FRAGMENT_COLLECTION}/ collection`);

              // The file now uses the repaired collection layout.
              collection = REPAIRED_FRAGMENT_COLLECTION;
              filePath = newFilePath;

              // Update relativePath and parts for the new file path
              relativePath = filePath.replace(`${this.absoluteContentRoot}/`, '');
              parts = relativePath.split('/');

              bytesRead = await readFilePrefix(filePath, buffer);
            }
          } catch (moveError) {
            console.error(`Failed to move ${filename} to fragments/${REPAIRED_FRAGMENT_COLLECTION}/:`, moveError);
            // Continue processing with original file
            bytesRead = await readFilePrefix(filePath, buffer);
          }
        } else {
          // Fragment is in a collection subdirectory
          collection = parts[1];
        }

        const filename = parts[parts.length - 1];
        // Extract name and locale from filename: hero.en.mdx -> name: hero, locale: en
        // Also handle files without locale: hero.mdx -> name: hero, locale: default from sites.json.
        // The locale grammar is the shared one (content-path.ts): a suffix that is not
        // a locale ('hero.v2.mdx') takes the rename repair below instead of being
        // indexed under a made-up locale.
        const localeSuffix = parseLocaleFilename(filename);
        const matchWithoutLocale = filename.match(/^(.+)\.(mdx|vxjson)$/);

        if (localeSuffix && localeSuffix.extension !== 'json') {
          name = localeSuffix.base;
          locale = localeSuffix.locale;
        } else if (matchWithoutLocale) {
          name = matchWithoutLocale[1];
          // Use default locale from sites config instead of hardcoded 'en'
          locale = this.contentIndex.getDefaultLocale('');

          console.log(`Found file without locale suffix: ${filename}`);
          // Rename file to include locale suffix
          const extension = matchWithoutLocale[2];
          const newFilename = `${name}.${locale}.${extension}`;
          const newFilePath = join(dirname(filePath), newFilename);
          console.log(`Will rename to: ${newFilename} at ${newFilePath}`);

          // Check if target file already exists
          try {
            await access(newFilePath);

            // Target file exists, skip renaming to avoid conflict
            console.warn(`Cannot rename ${filename} to ${newFilename}: target file already exists`);
          } catch {
            // Target file doesn't exist, safe to rename
            console.log(`Target file doesn't exist, proceeding with rename`);
            try {
              await rename(filePath, newFilePath);
              console.log(`Successfully renamed ${filename} to ${newFilename}`);

              // Update filePath to the new path for further processing
              filePath = newFilePath;

              // Update relativePath and parts for the new file path
              relativePath = filePath.replace(`${this.absoluteContentRoot}/`, '');
              parts = relativePath.split('/');

              bytesRead = await readFilePrefix(filePath, buffer);
            } catch (renameError) {
              console.error(`Failed to rename ${filename}:`, renameError);
              // Continue processing with original file
              bytesRead = await readFilePrefix(filePath, buffer);
            }
          }
        }

        // Parse content based on file type
        if (filePath.endsWith('.mdx')) {
          parsedData = parse4KBMDX(buffer, bytesRead);
        } else {
          parsedData = VXJSON.parse4KB(buffer, bytesRead);
        }
      } else if (parts[0] === 'data') {
        // Data collection entry: data/{collection}/{name}.{locale}.json
        kind = 'data';
        collection = parts[1];

        const filename = parts[parts.length - 1];
        // Extract name and locale from filename: testimonial.en.json -> name: testimonial, locale: en.
        // The locale grammar is the shared one (content-path.ts).
        const localeSuffix = parseLocaleFilename(filename);
        if (localeSuffix?.extension === 'json') {
          name = localeSuffix.base;
          locale = localeSuffix.locale;
        }

        // Parse JSON to get ID, metadata, and data
        const content = textDecoder.decode(buffer.subarray(0, bytesRead));
        try {
          const jsonData = JSON.parse(content);
          parsedData = {
            id: jsonData.id,
            type: 'json',
            created: jsonData.created,
            modified: jsonData.modified,
            publishAt: jsonData.publishAt,
            unpublishAt: jsonData.unpublishAt,
            meta: jsonData.meta || { title: name || 'Untitled' },
            data: jsonData.data,
            name,
          };
        } catch (error) {
          console.error(`Failed to parse JSON data file ${filePath}: ${messageOf(error)}`);
          this.recordIndexProblem(filePath, 'malformed-json', messageOf(error));
          return null;
        }
      } else {
        kind = 'page';
        site = parts[0];
        collection = parts[1];

        // Build pathname from file path. Accepts both .vxjson (Puck pages) and
        // .mdx (mdx-type pages) so consumers without a separate `mdxPages`
        // path can colocate .mdx docs alongside Puck pages under
        // `{contentRoot}/{site}/{collection}/...`. When `mdxPages` IS set
        // on a site in sites.json, .mdx files are served from that
        // separate path (handled in the `absoluteMdxPagesRoot` branch
        // above) and won't reach this branch.
        const pathParts = parts.slice(2); // Remove site/collection
        const filename = pathParts[pathParts.length - 1];
        // One grammar with the header parser and every other reader (content-path.ts).
        // A page file with no parseable locale suffix is NOT content: indexing it
        // under the fallback locale filed it with no pathname at all, invisible to
        // every pathname lookup while still occupying that locale slot. parseFilePath
        // (the reindex path) has always refused these — now both halves agree.
        const localeSuffix = filename ? parseLocaleFilename(filename) : null;
        if (!localeSuffix || localeSuffix.extension === 'json') {
          const message = unreadablePageLocaleMessage(filename ?? relativePath);
          console.warn(`Skipping ${filePath}: ${message}`);
          this.recordIndexProblem(filePath, 'unsupported-locale-path', message);
          return null;
        }
        locale = localeSuffix.locale;
        // Replace filename with basename
        pathParts[pathParts.length - 1] = localeSuffix.base;
        // index files map to parent: /index -> /, /foo/index -> /foo
        pathname =
          pathParts[pathParts.length - 1] === 'index'
            ? `/${pathParts.slice(0, -1).join('/')}`
            : `/${pathParts.join('/')}`;

        // Parse format-appropriately. parse4KBMDX reads frontmatter from the
        // MDX header; VXJSON.parse4KB reads the leading JSON metadata.
        if (filePath.endsWith('.mdx')) {
          parsedData = parse4KBMDX(buffer, bytesRead);
        } else {
          parsedData = VXJSON.parse4KB(buffer, bytesRead);
        }
      }

      // Check if the file is missing required fields
      const needsRepair = !parsedData.id || !parsedData.created || !parsedData.modified;

      // Extract or generate ID
      const id = parsedData.id || generateContentId();

      // Build LocaleManifest for this specific locale
      const localeVersion: LocaleVersion = {
        locale,
        etag: '', // Will be filled below
        created: parsedData.created || new Date().toISOString(),
        modified: parsedData.modified || new Date().toISOString(),
        ...(parsedData.publishAt && { publishAt: parsedData.publishAt }),
        ...(parsedData.unpublishAt && { unpublishAt: parsedData.unpublishAt }),
        ...(pathname && { pathname }),
        ...(parsedData.previousPathnames && { previousPathnames: parsedData.previousPathnames }),
        ...(name && { name }),
        meta: parsedData.meta || { title: name || 'Untitled' },
        sourcePath: filePath,
      };

      // Build ContentManifest (without content)
      const manifest: ContentManifest = {
        id,
        type: parsedData.type || (filePath.endsWith('.mdx') ? 'mdx' : filePath.endsWith('.json') ? 'json' : 'puck'),
        kind,
        site,
        collection,
        locales: {
          [locale]: localeVersion,
        },
      };

      // If we have full content, parse it and compute etags
      let content: ContentData | undefined;

      // Check if we need to repair the file first (missing required fields)
      if (needsRepair) {
        // Perform repair and get the repaired content
        const repairedData = await this.performReadRepair(filePath, manifest);
        if (repairedData) {
          content = repairedData.content;
          localeVersion.etag = repairedData.etag;
          localeVersion.modified = repairedData.modified;
          return { manifest, locale, localeVersion, bytesRead, content };
        }
        // Repair failed, skip this file
        console.error(`Failed to repair ${filePath}, skipping`);
        this.recordIndexProblem(filePath, 'repair-failed', 'Read-repair failed');
        return null;
      }

      if (
        bytesRead < 4096 ||
        (filePath.endsWith('.vxjson') && buffer[bytesRead - 1] === 0x7d) ||
        (filePath.endsWith('.json') && buffer[bytesRead - 1] === 0x7d)
      ) {
        // We have the full content
        if (filePath.endsWith('.mdx')) {
          const fullContent = textDecoder.decode(buffer.subarray(0, bytesRead));
          const { content: mdx } = matter(fullContent, {});
          content = { mdx };
        } else if (filePath.endsWith('.json')) {
          // Data collection JSON file
          const fullContent = textDecoder.decode(buffer.subarray(0, bytesRead));
          const jsonData = JSON.parse(fullContent);
          content = { data: jsonData.data };
        } else {
          const fullContent = textDecoder.decode(buffer.subarray(0, bytesRead));
          const data = JSON.parse(fullContent);
          content = data.content || {};
        }

        // Calculate etags from the buffer (only use valid bytes)
        const validBuffer = buffer.subarray(0, bytesRead);

        if (filePath.endsWith('.mdx')) {
          const etags = calculateEtagsFromMdxBuffer(validBuffer, parsedData.contentStartPos || -1);
          localeVersion.etag = `${etags.metaEtag}.${etags.contentEtag}`;
        } else if (filePath.endsWith('.json')) {
          // For data files, use simple etag (hash entire buffer)
          // Data files are typically small and don't need separate meta/content etags
          localeVersion.etag = VXJSON.calculateSimpleEtag(validBuffer);
        } else {
          const etagResult = VXJSON.calculateETags(validBuffer);

          if (!etagResult.success) {
            // Content field is not last or invalid JSON - repair immediately

            // Perform repair and get the repaired content
            const repairedData = await this.performReadRepair(filePath, manifest);
            if (repairedData) {
              content = repairedData.content;
              localeVersion.etag = repairedData.etag;
              localeVersion.modified = repairedData.modified;
              return { manifest, locale, localeVersion, bytesRead, content };
            }
            // Repair failed, skip this file
            console.error(`Failed to repair ${filePath}, skipping`);
            this.recordIndexProblem(filePath, 'repair-failed', 'Read-repair failed');
            return null;
          }
          localeVersion.etag = etagResult.contentEtag
            ? `${etagResult.metaEtag}.${etagResult.contentEtag}`
            : etagResult.metaEtag;
        }
      }

      // Return both for indexing
      return { manifest, locale, localeVersion, bytesRead, content };
    } catch (error) {
      console.error(`Error indexing ${originalFilePath}: ${messageOf(error)}`);
      this.recordIndexProblem(originalFilePath, 'parse-failed', messageOf(error));
      return null;
    }
  }

  /**
   * Perform read-repair by writing back the file with missing fields
   * This ensures stable IDs and timestamps across restarts
   */
  private async performReadRepair(
    filePath: string,
    manifest: ContentManifest,
  ): Promise<{
    content: ContentData;
    etag: string;
    modified: string;
  } | null> {
    try {
      const now = new Date().toISOString();
      let needsWrite = false;

      if (manifest.type === 'mdx') {
        // Read the full MDX file
        const content = await readFile(filePath, 'utf-8');
        const parsed = matter(content, {});

        // Check for missing fields
        if (!parsed.data.id) {
          parsed.data.id = manifest.id;
          needsWrite = true;
        }
        if (!parsed.data.created) {
          parsed.data.created = now;
          needsWrite = true;
        }
        if (!parsed.data.modified) {
          parsed.data.modified = now;
          needsWrite = true;
        }

        if (needsWrite) {
          // Write back with updated frontmatter. Pass the parsed file
          // object, not the body string: stringify re-parses string inputs
          // through gray-matter's memo cache, which is a plain object — a
          // body equal to an Object.prototype member name ('toString',
          // 'valueOf', …) reads the prototype function back and crashes.
          // Same cache-opt-out rule as the matter(..., {}) calls above.
          const updatedContent = matter.stringify(parsed, parsed.data);
          await writeFile(filePath, updatedContent);
          console.log(`Repaired MDX file: ${filePath} (added missing fields)`);

          // Calculate ETags for the repaired MDX file
          const repairedBuffer = Buffer.from(updatedContent, 'utf-8') as Uint8Array;
          const contentStartPos = updatedContent.indexOf('\n---\n') + 5; // Position after frontmatter
          const etags = calculateEtagsFromMdxBuffer(repairedBuffer, contentStartPos);
          const etag = `${etags.metaEtag}.${etags.contentEtag}`;

          // Return the repaired data. Strip leading newlines so the
          // body matches what the author wrote — see `readLocaleFile`.
          return {
            content: { mdx: parsed.content.replace(/^\n+/, '') },
            etag,
            modified: parsed.data.modified || now,
          };
        }
      } else {
        // Read the full JSON file
        const content = await readFile(filePath, 'utf-8');
        const data: VXJSONFile = JSON.parse(content);

        // Check for missing fields
        if (!data.id) {
          data.id = manifest.id;
          needsWrite = true;
        }
        if (!data.created) {
          data.created = now;
          needsWrite = true;
        }
        if (!data.modified) {
          data.modified = now;
          needsWrite = true;
        }

        // Always rewrite VXJSON files during repair to ensure correct field order
        needsWrite = true;

        if (needsWrite) {
          // Write back with VXJSON format
          const vxjsonData: VXJSONFile = {
            id: data.id,
            type: data.type,
            created: data.created,
            modified: data.modified,
            publishAt: data.publishAt,
            unpublishAt: data.unpublishAt,
            previousPathnames: data.previousPathnames,
            meta: data.meta || {},
            content: data.content || {},
          };
          const repairedJson = VXJSON.serialize(vxjsonData);
          await writeFile(filePath, repairedJson);
          console.log(`Repaired VXJSON file: ${filePath} (fixed field order or added missing fields)`);
          // Return the repaired data

          // Calculate ETags from the repaired JSON
          const repairedBuffer = Buffer.from(repairedJson, 'utf-8') as Uint8Array;
          const etagResult = VXJSON.calculateETags(repairedBuffer);

          if (!etagResult.success) {
            console.error(`Failed to calculate ETags after repair: ${filePath}`);
            return null;
          }

          const etag = etagResult.contentEtag
            ? `${etagResult.metaEtag}.${etagResult.contentEtag}`
            : etagResult.metaEtag;

          // Return the complete repaired data
          return {
            content: vxjsonData.content,
            etag,
            modified: vxjsonData.modified,
          };
        }
      }

      // For MDX or no repair needed, return null
      return null;
    } catch (error) {
      console.error(`Failed to perform read-repair on ${filePath}:`, error);
      return null;
    }
  }

  private async scanContentFiles(): Promise<string[]> {
    const files: string[] = [];
    const contentRoot = this.absoluteContentRoot;

    async function scan(dir: string, inDataDir = false) {
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            // Check if we're entering the data/ directory
            const isDataDir = dir === contentRoot && entry.name === 'data';
            await scan(fullPath, inDataDir || isDataDir);
          } else if (entry.isFile()) {
            // Include .vxjson and .mdx files everywhere
            // Include .json files only in the data/ directory
            if (entry.name.endsWith('.vxjson') || entry.name.endsWith('.mdx')) {
              files.push(fullPath);
            } else if (inDataDir && entry.name.endsWith('.json')) {
              files.push(fullPath);
            }
          }
        }
      } catch {
        // Directory doesn't exist yet
      }
    }

    await scan(this.absoluteContentRoot);

    // Also scan mdxPagesRoot for .mdx files when the second root is configured.
    // Supports projects that store mdx-type pages outside the main content
    // tree (the rendering pipeline that consumes them is the project's choice).
    //
    // Skip the second scan when mdxPagesRoot is the same as contentRoot OR
    // nested inside it — the first scan already walked those files, and a
    // second pass would push every `.mdx` onto `files` twice. The nested case
    // is the documented Starlight pattern (`contentRoot: './src/content'`,
    // `mdxPagesRoot: './src/content/docs'`), so the prefix check matters in
    // practice.
    if (
      this.absoluteMdxPagesRoot &&
      this.absoluteMdxPagesRoot !== this.absoluteContentRoot &&
      !this.absoluteMdxPagesRoot.startsWith(`${this.absoluteContentRoot}/`)
    ) {
      async function scanMdxPages(dir: string) {
        try {
          const entries = await readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
              await scanMdxPages(fullPath);
            } else if (entry.isFile() && entry.name.endsWith('.mdx')) {
              files.push(fullPath);
            }
          }
        } catch {
          // Directory doesn't exist yet
        }
      }
      await scanMdxPages(this.absoluteMdxPagesRoot);
    }

    return files;
  }

  /**
   * Why a page of `type` cannot have `pathname` in `locale` where `getFilePath` puts it: an mdx
   * page lives in the MDX pages folder when one is configured, where a default-language path may
   * not start with a language folder (see `checkMdxPagesPathname`).
   */
  private mdxPagesPathnameRefusal(type: ContentType, pathname: string, locale: string): PathnameRefusal | null {
    if (type !== 'mdx' || !this.absoluteMdxPagesRoot) return null;
    return checkMdxPagesPathname(pathname, locale, {
      defaultLocale: this.mdxPagesDefaultLocale,
      locales: this.availableLocales,
    });
  }

  private getFilePath(manifest: ContentIdentity, { locale, name, pathname }: LocalePathData): string {
    if (manifest.kind === 'fragment') {
      const ext = manifest.type === 'mdx' ? 'mdx' : 'vxjson';
      return join(this.absoluteContentRoot, 'fragments', manifest.collection, `${name}.${locale}.${ext}`);
    }
    if (manifest.kind === 'data') {
      return join(this.absoluteContentRoot, 'data', manifest.collection, `${name}.${locale}.json`);
    }
    if (manifest.kind === 'page' && pathname) {
      // For pages, derive path from pathname
      const basePath = pathname.replace(/^\//, '').replace(/\/$/, '') || 'index';

      // mdx-type pages live under absoluteMdxPagesRoot when configured.
      // The locale appears as a directory segment for non-default locales;
      // the default locale's files live at the root with no locale prefix.
      if (manifest.type === 'mdx' && this.absoluteMdxPagesRoot) {
        return locale === this.mdxPagesDefaultLocale
          ? join(this.absoluteMdxPagesRoot, `${basePath}.mdx`)
          : join(this.absoluteMdxPagesRoot, locale, `${basePath}.mdx`);
      }

      // Pages live under contentRoot/{site}/{collection}. When type:'mdx'
      // and no `mdxPages` path is configured for the site, the .mdx files
      // sit here alongside the .vxjson Puck pages — the layout chosen
      // when sites.json doesn't declare a separate `mdxPages` path.
      if (manifest.site) {
        const ext = manifest.type === 'mdx' ? 'mdx' : 'vxjson';
        return join(this.absoluteContentRoot, manifest.site, manifest.collection, `${basePath}.${locale}.${ext}`);
      }
    }
    throw new Error(`Invalid manifest: ${JSON.stringify(manifest, null, 2)}`);
  }

  /**
   * Parse a file path back into its components for checking against the path index
   * Returns null if the path doesn't match expected patterns
   */
  parseFilePath(filePath: string): ContentPathLayout | null {
    // Files under mdxPagesRoot are kind:'page' + type:'mdx' regardless of
    // their position relative to absoluteContentRoot. Mirror the parsing
    // performed in parseFileHeaderWithRepair so both code paths agree on
    // the derived (pathname, locale) tuple.
    if (this.absoluteMdxPagesRoot && filePath.startsWith(`${this.absoluteMdxPagesRoot}/`)) {
      const mdxRelativePath = filePath.replace(`${this.absoluteMdxPagesRoot}/`, '');
      const mdxParts = mdxRelativePath.split('/');
      const mdxFilename = mdxParts[mdxParts.length - 1];
      let locale: string;
      let pathname: string;

      const noLocaleMatch = mdxFilename.match(/^(.+)\.mdx$/);
      if (!noLocaleMatch) return null;
      mdxParts[mdxParts.length - 1] = noLocaleMatch[1];

      // Membership-based locale detection — mirrors parseFileHeaderWithRepair
      // so both paths classify the same file identically.
      if (mdxParts.length > 1 && this.availableLocales.has(mdxParts[0])) {
        locale = mdxParts[0];
        const slugParts = mdxParts.slice(1);
        pathname =
          slugParts[slugParts.length - 1] === 'index'
            ? `/${slugParts.slice(0, -1).join('/')}`
            : `/${slugParts.join('/')}`;
      } else {
        locale = this.mdxPagesDefaultLocale;
        pathname =
          mdxParts[mdxParts.length - 1] === 'index' ? `/${mdxParts.slice(0, -1).join('/')}` : `/${mdxParts.join('/')}`;
      }

      return {
        kind: 'page',
        site: this.mdxPagesSite,
        collection: this.mdxPagesCollection,
        pathname,
        locale,
      };
    }

    // Everything under the primary content root shares ONE grammar with the
    // header parser and every other reader (content-path.ts) — including the
    // `index` -> parent-pathname rule this method used to skip. Missing it made
    // reindex look up `/index`, never find the entry the indexer had filed under
    // `/`, and leave a deleted index page in the index forever.
    return parseContentPathLayout(filePath.replace(`${this.absoluteContentRoot}/`, ''));
  }

  async getContent(id: string): Promise<ContentEntry | null> {
    // Get manifest for this ID
    const manifest = this.contentIndex.getManifest(id);
    if (!manifest) {
      return null;
    }

    // Read all locale files in parallel
    const readPromises = Array.from(localesOf(manifest)).map(async (localeVersion) => {
      const filePath = this.getFilePath(manifest, localeVersion);
      const content = await this.readLocaleFile(filePath, localeVersion.locale);
      return { localeVersion, content };
    });

    const results = await Promise.all(readPromises);

    // Build locales with content
    const locales: Record<string, LocaleVersion & ContentProp> = {};
    for (const { localeVersion, content } of results) {
      if (content) {
        locales[localeVersion.locale] = {
          ...localeVersion,
          etag: content.etag, // Use fresh etag from file, not stale manifest etag
          content: content.content,
        };
      }
    }

    return {
      id: manifest.id,
      site: manifest.site,
      collection: manifest.collection,
      type: manifest.type,
      kind: manifest.kind,
      locales,
    };
  }

  async getLocalized(id: string, locale: string): Promise<LocalizedEntry | null> {
    // Get manifest for this ID
    const manifest = this.contentIndex.getManifest(id);
    if (!manifest) {
      // File might have been added after indexing - try reindexing
      await this.reindex();

      // Try again with updated index
      const updatedManifest = this.contentIndex.getManifest(id);
      if (!updatedManifest?.locales[locale]) {
        return null;
      }

      return this.getLocalized(id, locale);
    }

    // Check if this locale exists
    const localeVersion = manifest.locales[locale];
    if (!localeVersion) {
      return null;
    }

    // Read the locale-specific file
    const filePath = this.getFilePath(manifest, localeVersion);
    const localeData = await this.readLocaleFile(filePath, locale);
    if (!localeData) {
      return null;
    }

    // Build LocalizedEntry
    return {
      id: manifest.id,
      site: manifest.site,
      collection: manifest.collection,
      type: manifest.type,
      kind: manifest.kind,
      localized: {
        ...localeVersion,
        etag: localeData.etag, // Use fresh etag from file, not stale manifest etag
        content: localeData.content,
      },
    };
  }

  private async readLocaleFile(filePath: string, locale: string): Promise<LocaleFileData | null> {
    try {
      const buffer = (await readFile(filePath)) as Uint8Array;
      const content = textDecoder.decode(buffer);

      if (filePath.endsWith('.mdx')) {
        const { data: frontmatter, content: rawBody } = matter(content, {});
        // gray-matter leaves the blank line after the closing `---` on
        // the body. Strip leading newlines so the round-trip matches the
        // body the author wrote.
        const body = rawBody.replace(/^\n+/, '');

        // Calculate etags from the file buffer
        const contentPos = findMdxContentStartPosition(buffer);

        const etags = calculateEtagsFromMdxBuffer(buffer, contentPos);
        const etag = `${etags.metaEtag}.${etags.contentEtag}`;

        // Extract special fields from frontmatter, everything else is metadata
        const { id, created, modified, publishAt, unpublishAt, name, ...metaFields } = frontmatter;

        // Body-only — frontmatter is server-owned and surfaced separately
        // via `meta` / `created` / `modified`. Returning the full file here
        // would let the editor round-trip the YAML block as body text, which
        // duplicates the frontmatter on disk when content is inserted above
        // it (proven on assets.mdx, 2026-05-11).
        const result: LocaleFileData = {
          locale,
          etag,
          created: created,
          modified: modified,
          meta: metaFields as ContentMeta,
          content: { mdx: body },
        };

        // Only add publish dates if they exist
        if (frontmatter.publishAt !== undefined) {
          result.publishAt = frontmatter.publishAt;
        }
        if (frontmatter.unpublishAt !== undefined) {
          result.unpublishAt = frontmatter.unpublishAt;
        }

        return result;
      }

      // Parse JSON data first to determine type
      const data = JSON.parse(content);

      // Handle JSON data files (type: 'json') separately - they use simple etag
      if (data.type === 'json') {
        const etag = VXJSON.calculateSimpleEtag(buffer);

        const result: LocaleFileData = {
          locale,
          etag,
          created: data.created,
          modified: data.modified,
          meta: data.meta || {},
          content: { data: data.data || {} },
        };

        // Only add optional fields if they exist
        if (data.publishAt !== undefined) {
          result.publishAt = data.publishAt;
        }
        if (data.unpublishAt !== undefined) {
          result.unpublishAt = data.unpublishAt;
        }

        return result;
      }

      // For VXJSON (puck pages), calculate ETags with meta/content split
      const etagResult = VXJSON.calculateETags(buffer);

      if (!etagResult.success) {
        // File needs repair - parse it and rewrite in correct format
        const repairedData: VXJSONFile = {
          id: data.id,
          type: data.type,
          created: data.created,
          modified: data.modified,
          publishAt: data.publishAt,
          unpublishAt: data.unpublishAt,
          previousPathnames: data.previousPathnames,
          meta: data.meta || {},
          content: data.content || {},
        };

        // Rewrite file with correct format
        const repairedJson = VXJSON.serialize(repairedData);
        await writeFile(filePath, repairedJson);

        // Recalculate ETags from repaired buffer
        const repairedBuffer = Buffer.from(repairedJson, 'utf-8') as Uint8Array;
        const repairedEtagResult = VXJSON.calculateETags(repairedBuffer);

        if (!repairedEtagResult.success) {
          throw new Error(`Failed to repair VXJSON file: ${filePath}`);
        }

        const etag = repairedEtagResult.contentEtag
          ? `${repairedEtagResult.metaEtag}.${repairedEtagResult.contentEtag}`
          : repairedEtagResult.metaEtag;

        console.log(`Repaired VXJSON file: ${filePath}`);

        const result: LocaleFileData = {
          locale,
          etag,
          created: data.created,
          modified: data.modified,
          meta: data.meta || {},
          content: data.content || {},
        };

        // Only add optional fields if they exist
        if (data.publishAt !== undefined) {
          result.publishAt = data.publishAt;
        }
        if (data.unpublishAt !== undefined) {
          result.unpublishAt = data.unpublishAt;
        }
        if (data.previousPathnames !== undefined) {
          result.previousPathnames = data.previousPathnames;
        }

        return result;
      }

      const etag = etagResult.contentEtag ? `${etagResult.metaEtag}.${etagResult.contentEtag}` : etagResult.metaEtag;

      const result: LocaleFileData = {
        locale,
        etag,
        created: data.created,
        modified: data.modified,
        meta: data.meta || {},
        content: data.content || {},
      };

      // Only add optional fields if they exist
      if (data.publishAt !== undefined) {
        result.publishAt = data.publishAt;
      }
      if (data.unpublishAt !== undefined) {
        result.unpublishAt = data.unpublishAt;
      }
      if (data.previousPathnames !== undefined) {
        result.previousPathnames = data.previousPathnames;
      }

      return result;
    } catch {
      return null;
    }
  }

  async createContent(data: CreateContentInput): Promise<CreateResult> {
    // Use shared validation
    const validation = validateCreateContent(data, this.sites, this.fragments, this.data);
    if (!validation.valid) {
      return {
        success: false,
        reason: validation.reason,
        error: validation.error ? new Error(validation.error) : undefined,
        existingId: validation.existingId,
        field: validation.field,
      };
    }

    if (data.kind === 'page') {
      for (const [locale, localeData] of Object.entries(data.locales)) {
        const refused = this.mdxPagesPathnameRefusal(data.type, localeData.pathname ?? '', locale);
        if (refused) {
          return { success: false, reason: refused.reason, error: new Error(refused.error), field: 'pathname' };
        }
      }
    }

    const id = generateContentId();
    const now = data.created || new Date().toISOString();

    try {
      // Build the manifest with all locales
      const manifest: ContentManifest = {
        id,
        type: data.type,
        kind: data.kind,
        site: data.site,
        collection: data.collection,
        locales: {},
      };

      const contentCache: Record<string, ContentData> = {};

      // Create files for each locale
      for (const [locale, localeData] of Object.entries(data.locales)) {
        const content = localeData.content;

        // Build metadata with required title
        const title = localeData.meta?.title || data.meta?.title;
        if (!title) {
          return {
            success: false,
            reason: 'write_error',
            error: new Error('Title is required in metadata'),
          };
        }

        // Build complete metadata
        const meta: ContentMeta = {
          title,
          ...data.meta,
          ...localeData.meta,
        };

        const fileData: VXJSONFile = {
          id,
          type: data.type,
          created: now,
          modified: now,
          publishAt:
            localeData.publishAt && typeof localeData.publishAt === 'string' ? localeData.publishAt : undefined,
          unpublishAt:
            localeData.unpublishAt && typeof localeData.unpublishAt === 'string' ? localeData.unpublishAt : undefined,
          meta,
          content,
        };

        // Use the proper getFilePath method
        const filePath = this.getFilePath(manifest, { locale, name: data.name, pathname: localeData.pathname });

        // Ensure directory exists
        await mkdir(dirname(filePath), { recursive: true });

        // Write file and calculate etag from the serialized content
        let etag: string;

        if (data.type === 'mdx') {
          // Write MDX with frontmatter - flatten metadata fields
          const frontmatterData = {
            id,
            created: now,
            modified: now,
            ...(localeData.publishAt && { publishAt: localeData.publishAt }),
            ...(localeData.unpublishAt && { unpublishAt: localeData.unpublishAt }),
            ...meta, // Spread metadata fields directly, not nested
          };

          const mdxContent = serializeMdxWithFrontmatter(frontmatterData, content.mdx || '');
          await writeFile(filePath, mdxContent);

          // For MDX, calculate etags from the serialized content
          const mdxBuffer = new TextEncoder().encode(mdxContent);
          // For MDX, all frontmatter is metadata, content starts after ---
          const contentStartMarker = new TextEncoder().encode('---\n\n');
          let contentPos = -1;
          for (let i = 0; i <= mdxBuffer.length - contentStartMarker.length; i++) {
            let match = true;
            for (let j = 0; j < contentStartMarker.length; j++) {
              if (mdxBuffer[i + j] !== contentStartMarker[j]) {
                match = false;
                break;
              }
            }
            if (match) {
              contentPos = i + contentStartMarker.length;
              break;
            }
          }
          const etags = calculateEtagsFromMdxBuffer(mdxBuffer, contentPos);
          etag = `${etags.metaEtag}.${etags.contentEtag}`;
        } else if (data.type === 'json') {
          // Data files use "data" field instead of "content"
          const dataFileContent = {
            id,
            type: 'json',
            created: now,
            modified: now,
            ...(localeData.publishAt &&
              typeof localeData.publishAt === 'string' && { publishAt: localeData.publishAt }),
            ...(localeData.unpublishAt &&
              typeof localeData.unpublishAt === 'string' && { unpublishAt: localeData.unpublishAt }),
            meta,
            data: content.data || {},
          };

          const jsonContent = JSON.stringify(sortKeys(dataFileContent, { deep: true }), null, '\t');
          await writeFile(filePath, jsonContent);

          // For data files, use simple etag (hash entire buffer)
          const jsonBuffer = new TextEncoder().encode(jsonContent);
          etag = VXJSON.calculateSimpleEtag(jsonBuffer);
        } else {
          // VXJSON for pages (puck)
          const jsonContent = VXJSON.serialize(fileData);
          const jsonBuffer = new TextEncoder().encode(jsonContent);

          // Calculate etags from the buffer
          const etagResult = VXJSON.calculateETags(jsonBuffer);

          if (!etagResult.success) {
            throw new Error(`Invalid VXJSON format when creating content: ${etagResult.error}`);
          }

          etag = etagResult.contentEtag ? `${etagResult.metaEtag}.${etagResult.contentEtag}` : etagResult.metaEtag;

          // Write the file
          await writeFile(filePath, jsonContent);
        }

        // Build locale manifest using shared function
        const localeVersion = buildLocaleVersion({
          locale,
          etag,
          created: now,
          modified: now,
          meta,
          kind: data.kind,
          pathname: data.kind === 'page' ? localeData.pathname : undefined,
          name: data.kind === 'fragment' || data.kind === 'data' ? data.name : undefined,
          publishAt:
            localeData.publishAt && typeof localeData.publishAt === 'string' ? localeData.publishAt : undefined,
          unpublishAt:
            localeData.unpublishAt && typeof localeData.unpublishAt === 'string' ? localeData.unpublishAt : undefined,
        });

        // Add locale to manifest
        manifest.locales[locale] = localeVersion;
        contentCache[locale] = content;
      }

      // Add each locale to the index
      for (const localeVersion of localesOf(manifest)) {
        const { locale } = localeVersion;
        this.contentIndex.addContent(manifest, localeVersion, contentCache[locale]);
      }

      return { success: true, id };
    } catch (error) {
      return {
        success: false,
        reason: 'write_error',
        error: ensureError(error),
      };
    }
  }

  async updateLocalized(input: UpdateLocaleInput): Promise<UpdateResult> {
    const { id, locale, data, etag } = input;

    // Get the manifest
    const manifest = this.contentIndex.getManifest(id);
    if (!manifest) {
      return {
        success: false,
        reason: 'not_found',
      };
    }

    // Get the specific locale manifest
    const localeVersion = manifest.locales[locale];
    if (!localeVersion) {
      return {
        success: false,
        reason: 'not_found',
      };
    }

    // Get file path and read current content FIRST to get fresh etag
    const filePath = this.getFilePath(manifest, localeVersion);
    const current = await this.readLocaleFile(filePath, locale);
    if (!current) {
      return {
        success: false,
        reason: 'not_found',
      };
    }

    // Use fresh etag from file, not stale manifest etag
    const currentEtag = current.etag;

    // Check etag - data files use simple etags, others use dual etags
    if (manifest.kind === 'data') {
      // Data files use simple etag (single hash, no dot separator)
      // Just compare the full etag directly
      if (etag !== currentEtag) {
        return {
          success: false,
          reason: 'stale_write',
          currentEtag,
        };
      }
    } else {
      // Non-data files use dual etags (meta.content format)
      const etagParts = parseDualEtag(etag);
      const currentParts = parseDualEtag(currentEtag);

      if (!etagParts || !currentParts) {
        return {
          success: false,
          reason: 'stale_write',
          currentEtag,
        };
      }

      // Check which parts are being updated
      const updateScope = analyzeUpdateScope(data);
      const updatingMeta = (updateScope & UPDATE_SCOPE.META) !== 0;
      const updatingContent = (updateScope & UPDATE_SCOPE.CONTENT) !== 0;

      // Validate etags for parts being updated
      if (updatingMeta && etagParts.meta !== currentParts.meta) {
        return {
          success: false,
          reason: 'stale_write',
          currentEtag,
        };
      }

      if (updatingContent && etagParts.content !== currentParts.content) {
        return {
          success: false,
          reason: 'stale_write',
          currentEtag,
        };
      }
    }

    // Update modified timestamp for any change (metadata or content)
    let modified: string;
    if (shouldUpdateModifiedTimestamp(data)) {
      // Use provided modified timestamp or current time
      modified = data.modified || new Date().toISOString();
    } else if (data.modified) {
      // If modified timestamp is explicitly provided, always use it
      modified = data.modified;
    } else {
      // No changes and no explicit timestamp, keep current
      modified = current.modified;
    }

    const {
      sortedMeta: newMeta,
      valid: metaValid,
      error: metaError,
    } = validateAndPrepareMetadata(applyMetaPatch(current.meta, data.meta ?? {}));

    // Validate new metadata
    if (!newMeta || !metaValid) {
      return {
        success: false,
        reason: 'write_error',
        error: new Error(metaError),
      };
    }

    // Merge updates
    const newContent = data.content ? { ...current.content, ...data.content } : current.content;

    // A page's new path is tidied, and refused when it is malformed or another page has it, as a
    // create's is; the tidied form names the file and keys the page in the site index. An unchanged
    // path is left alone, so a page keeps a path from before the checks.
    let pathname = data.pathname;
    if (pathname !== undefined && pathname !== localeVersion.pathname && manifest.kind === 'page') {
      // Own-key only: the manifest's site name comes from the on-disk layout
      // and is never checked against the configured sites, so an inherited key
      // would reach the calls below.
      const site = manifest.site && Object.hasOwn(this.sites, manifest.site) ? this.sites[manifest.site] : undefined;
      const checked = checkPagePathname(site, pathname, locale, id);
      if (!checked.valid) {
        return { success: false, reason: checked.reason, error: new Error(checked.error) };
      }
      const refused = this.mdxPagesPathnameRefusal(manifest.type, checked.pathname, locale);
      if (refused) {
        return { success: false, reason: refused.reason, error: new Error(refused.error) };
      }
      pathname = checked.pathname;
    }

    // A new fragment or data name passes the create's checks. An unchanged name is left alone, so
    // an entry keeps a name from before the checks.
    if (
      data.name !== undefined &&
      data.name !== localeVersion.name &&
      (manifest.kind === 'fragment' || manifest.kind === 'data')
    ) {
      const entries = manifest.kind === 'fragment' ? this.fragments : this.data;
      const refused = checkEntryName(
        manifest.kind,
        manifest.collection,
        data.name,
        (name) =>
          manifest.kind === 'fragment' ? this.fragments.isFragmentNameValid(name) : this.data.isDataNameValid(name),
        (name) => entries.getNameConflict(manifest.collection, name, id),
      );
      if (refused) {
        return { success: false, reason: refused.reason, error: new Error(refused.error) };
      }
    }

    // Handle pathname changes - track history only for published content
    const pathnameHistory = buildPathnameHistory(
      localeVersion.pathname,
      pathname,
      isContentPublished({
        publishAt: resolvePublishDate(data.publishAt, current.publishAt),
        unpublishAt: resolvePublishDate(data.unpublishAt, current.unpublishAt),
      }),
      new Date().toISOString(),
    );

    try {
      // Determine the target file path (may be different if pathname or name changed)
      let targetFilePath = filePath;
      if (pathname && localeVersion.pathname && pathname !== localeVersion.pathname && manifest.site) {
        // For pages, calculate new file path based on new pathname
        const newLocaleVersion: LocaleVersion = {
          ...localeVersion,
          pathname,
        };
        targetFilePath = this.getFilePath(manifest, newLocaleVersion);

        // Ensure target directory exists
        await mkdir(dirname(targetFilePath), { recursive: true });
      } else if (
        data.name &&
        localeVersion.name &&
        data.name !== localeVersion.name &&
        (manifest.kind === 'fragment' || manifest.kind === 'data')
      ) {
        // A fragment's or data entry's name is part of its file path, so a rename moves the file
        const newLocaleVersion: LocaleVersion = {
          ...localeVersion,
          name: data.name,
        };
        targetFilePath = this.getFilePath(manifest, newLocaleVersion);

        // Ensure target directory exists
        await mkdir(dirname(targetFilePath), { recursive: true });
      }

      // Write updated content
      if (targetFilePath.endsWith('.mdx')) {
        // Build frontmatter with special fields and metadata
        const publishAt = resolvePublishDate(data.publishAt, current.publishAt);
        const unpublishAt = resolvePublishDate(data.unpublishAt, current.unpublishAt);
        const frontmatterData = {
          id: manifest.id,
          created: current.created,
          modified,
          ...(publishAt && { publishAt }),
          ...(unpublishAt && { unpublishAt }),
          ...newMeta, // Spread metadata fields directly
        };

        // Extract just the content part from MDX (remove frontmatter if present)
        let mdxContentPart = newContent.mdx || '';
        if (mdxContentPart.startsWith('---')) {
          // Remove frontmatter if it exists
          const { content: contentOnly } = matter(mdxContentPart, {});
          mdxContentPart = contentOnly;
        }

        // Defensive guard: warn when a frontmatter-shaped block appears
        // mid-body. The load path strips frontmatter before it reaches the
        // editor, so this should never occur — if it does, surface it for
        // investigation instead of silently writing a file with stacked
        // frontmatter blocks.
        if (/\n---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/.test(mdxContentPart)) {
          console.warn(
            `[content-api] Embedded frontmatter-shaped block detected in body for ${targetFilePath}. ` +
              'This indicates a load-path regression or client-side leak.',
          );
        }

        const mdxContent = serializeMdxWithFrontmatter(frontmatterData, mdxContentPart);

        // Atomic write for MDX files
        await atomicWriteFile(targetFilePath, mdxContent);
      } else if (targetFilePath.endsWith('.json')) {
        // Data files use "data" field instead of "content"
        const fileContent = JSON.parse(await readFile(filePath, 'utf-8'));

        // Build updated data file structure
        const updatedFile = {
          id: fileContent.id,
          type: 'json' as const,
          created: fileContent.created,
          modified,
          ...(fileContent.publishAt && { publishAt: fileContent.publishAt }),
          ...(fileContent.unpublishAt && { unpublishAt: fileContent.unpublishAt }),
          meta: newMeta,
          data: sortKeys(newContent.data || {}, { deep: true }),
        };

        // Handle publish date updates
        if ('publishAt' in data) {
          if (data.publishAt) {
            (updatedFile as Record<string, unknown>).publishAt = data.publishAt;
          } else {
            delete (updatedFile as Record<string, unknown>).publishAt;
          }
        }

        if ('unpublishAt' in data) {
          if (data.unpublishAt) {
            (updatedFile as Record<string, unknown>).unpublishAt = data.unpublishAt;
          } else {
            delete (updatedFile as Record<string, unknown>).unpublishAt;
          }
        }

        // Serialize data file
        const serializedContent = JSON.stringify(sortKeys(updatedFile, { deep: true }), null, '\t');

        // Atomic write for JSON data files
        await atomicWriteFile(targetFilePath, serializedContent);
      } else {
        // VXJSON for pages (puck)
        const fileContent = JSON.parse(await readFile(filePath, 'utf-8'));

        // Build updated VXJSONFile structure
        const updatedFile: VXJSONFile = {
          id: fileContent.id,
          type: fileContent.type,
          created: fileContent.created,
          modified,
          publishAt: fileContent.publishAt,
          unpublishAt: fileContent.unpublishAt,
          previousPathnames: fileContent.previousPathnames,
          meta: newMeta,
          content: sortKeys(newContent, { deep: true }),
        };

        // Handle pathname changes and track history
        if (pathname && localeVersion.pathname && pathname !== localeVersion.pathname) {
          // Only add to history if content is published
          if (isContentPublished(current)) {
            if (!updatedFile.previousPathnames) {
              updatedFile.previousPathnames = {};
            }
            updatedFile.previousPathnames[localeVersion.pathname] = modified;
          }
        }

        // Handle publish date updates
        if ('publishAt' in data) {
          if (data.publishAt) {
            updatedFile.publishAt = data.publishAt;
          } else {
            delete updatedFile.publishAt;
          }
        }

        if ('unpublishAt' in data) {
          if (data.unpublishAt) {
            updatedFile.unpublishAt = data.unpublishAt;
          } else {
            delete updatedFile.unpublishAt;
          }
        }

        // Serialize using VXJSON format to ensure content is last
        const serializedContent = VXJSON.serialize(updatedFile);

        // Atomic write for VXJSON page files
        await atomicWriteFile(targetFilePath, serializedContent);
      }

      // Calculate new etag from the written file
      const writtenBuffer = (await readFile(targetFilePath)) as Uint8Array;
      let newEtag: string;

      if (targetFilePath.endsWith('.mdx')) {
        // Find content position in MDX
        const contentStartMarker = new TextEncoder().encode('---\n\n');
        let contentPos = -1;
        for (let i = 0; i <= writtenBuffer.length - contentStartMarker.length; i++) {
          let match = true;
          for (let j = 0; j < contentStartMarker.length; j++) {
            if (writtenBuffer[i + j] !== contentStartMarker[j]) {
              match = false;
              break;
            }
          }
          if (match) {
            contentPos = i + contentStartMarker.length;
            break;
          }
        }
        const etags = calculateEtagsFromMdxBuffer(writtenBuffer, contentPos);
        newEtag = `${etags.metaEtag}.${etags.contentEtag}`;
      } else if (targetFilePath.endsWith('.json')) {
        // For data files, use simple etag (hash entire buffer)
        newEtag = VXJSON.calculateSimpleEtag(writtenBuffer);
      } else {
        // For VXJSON, calculateEtagsFromVXJSONBuffer finds the content position internally
        const etagResult = VXJSON.calculateETags(writtenBuffer);

        if (!etagResult.success) {
          throw new Error(`Invalid VXJSON format when updating content: ${etagResult.error}`);
        }

        newEtag = etagResult.contentEtag ? `${etagResult.metaEtag}.${etagResult.contentEtag}` : etagResult.metaEtag;
      }

      // Build updated locale manifest with current publish data
      const updatedLocaleVersion: LocaleVersion = {
        ...localeVersion,
        etag: newEtag,
        modified,
        meta: newMeta,
        ...(pathname && { pathname }),
        ...(data.name && { name: data.name }),
      };

      // Handle publish dates using shared function
      // First preserve current values if not updating
      if (current.publishAt && !('publishAt' in data)) {
        updatedLocaleVersion.publishAt = current.publishAt;
      }
      if (current.unpublishAt && !('unpublishAt' in data)) {
        updatedLocaleVersion.unpublishAt = current.unpublishAt;
      }

      // Then apply updates
      updatePublishDates(updatedLocaleVersion, data);

      // Update pathname history if changed
      if (Object.keys(pathnameHistory).length > 0) {
        updatedLocaleVersion.previousPathnames = {
          ...localeVersion.previousPathnames,
          ...pathnameHistory,
        };
      } else {
        // Preserve existing previousPathnames if no change, but only if it has content
        const existingPreviousPathnames = localeVersion.previousPathnames;
        if (existingPreviousPathnames && Object.keys(existingPreviousPathnames).length > 0) {
          updatedLocaleVersion.previousPathnames = existingPreviousPathnames;
        } else {
          // Remove empty previousPathnames object
          delete updatedLocaleVersion.previousPathnames;
        }
      }

      // Store the old locale manifest for rollback if needed
      const oldLocaleVersion = localeVersion;

      try {
        // Replace the locale so its old path/name mappings are removed first.
        this.contentIndex.removeLocale(id, locale);
        this.contentIndex.addContent(manifest, updatedLocaleVersion, newContent);

        // If pathname changed, delete the old file
        if (targetFilePath !== filePath) {
          try {
            // A name changed only in letter case is the same file on a case-insensitive disk: the
            // write went into it, so deleting the old path would delete the entry. Renaming it
            // gives the file its new name's case.
            if (await isSameFile(filePath, targetFilePath)) await rename(filePath, targetFilePath);
            else await unlink(filePath);
          } catch (error) {
            // Log but don't fail if old file deletion fails
            console.warn(`Failed to delete old file ${filePath}:`, error);
          }
        }
      } catch (error) {
        // Rollback on error to maintain the original locale and name mapping.
        this.contentIndex.removeLocale(id, locale);
        this.contentIndex.addContent(manifest, oldLocaleVersion, current.content);

        // If we wrote to a new file, try to clean it up. A name changed only in letter case wrote
        // into the entry's own file on a case-insensitive disk, and that file is kept.
        if (targetFilePath !== filePath && !(await isSameFile(filePath, targetFilePath))) {
          try {
            await unlink(targetFilePath);
          } catch {
            // Ignore cleanup errors
          }
        }

        throw error;
      }

      return {
        success: true,
        etag: newEtag,
        modified: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        reason: 'write_error',
        error: ensureError(error),
      };
    }
  }

  async deleteContent(id: string, etag: string): Promise<DeleteResult> {
    // Get manifest for this ID
    const manifest = this.contentIndex.getManifest(id);
    if (!manifest) {
      return {
        success: false,
        reason: 'not_found',
        error: new Error('Content not found'),
      };
    }

    // For deleteContent, we require the etag to match ANY locale (indicating user has current data)
    // But this is still a design flaw - we should probably require all etags or a master etag
    let matchingLocale: LocaleVersion | undefined;
    for (const localeVersion of localesOf(manifest)) {
      if (localeVersion.etag === etag) {
        matchingLocale = localeVersion;
        break;
      }
    }
    if (!matchingLocale) {
      return {
        success: false,
        reason: 'stale_write',
        currentEtag: Array.from(localesOf(manifest))[0]?.etag || '',
        error: new Error('Invalid etag - must match at least one locale'),
      };
    }

    // Settled, not all: Promise.all let one rejection abandon the others
    // AFTER they had already unlinked, so the caller was told the delete
    // failed while the content was gone and the index still listed it. A file
    // already absent (git checkout, a manual rm) is the common cause, and for
    // a delete that is the desired end state, not an error.
    const localeVersions = Array.from(localesOf(manifest));
    const outcomes = await Promise.allSettled(
      localeVersions.map(async (localeVersion) => {
        await rm(this.getFilePath(manifest, localeVersion), { force: true });
      }),
    );

    const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
    if (failures.length === 0) {
      this.contentIndex.removeEntry(id);
      return { success: true };
    }

    // Some files are gone and some are not. Drop exactly what was removed so
    // the index still describes what is on disk; the survivors stay indexed
    // rather than becoming unreachable orphans.
    for (const [position, outcome] of outcomes.entries()) {
      if (outcome.status === 'fulfilled') {
        this.contentIndex.removeLocale(id, localeVersions[position].locale);
      }
    }

    return {
      success: false,
      error: ensureError(failures[0].reason),
    };
  }

  async deleteLocalized(input: DeleteLocaleInput): Promise<DeleteResult> {
    const { id, locale, etag } = input;

    // Get manifest for this ID
    const manifest = this.contentIndex.getManifest(id);
    if (!manifest) {
      return {
        success: false,
        reason: 'not_found',
        error: new Error('Content not found'),
      };
    }

    // Check if this locale exists
    const localeVersion = manifest.locales[locale];
    if (!localeVersion) {
      return {
        success: false,
        reason: 'not_found',
        error: new Error('Locale not found'),
      };
    }

    // Verify etag matches this locale
    if (localeVersion.etag !== etag) {
      return {
        success: false,
        reason: 'stale_write',
        currentEtag: localeVersion.etag,
        error: new Error('Invalid etag for locale'),
      };
    }

    // Don't allow deleting the last locale. Count actual locales, not
    // manifest keys — removeLocale clears a locale by assigning undefined
    // and keeping the key, so after an earlier translation delete the key
    // count still includes the dead slot and the guard would wave the
    // genuinely last locale through.
    if (Array.from(localesOf(manifest)).length === 1) {
      return {
        success: false,
        error: new Error('Cannot delete the last locale. Use deleteContent to delete all content.'),
      };
    }

    try {
      // Delete the locale file. A file already absent (git checkout, a
      // manual rm) is the desired end state of a delete, not an error —
      // same stance deleteContent takes. Failing on it left the deleted
      // translation routable and cached while reporting failure.
      await rm(this.getFilePath(manifest, localeVersion), { force: true });

      // Remove locale from manifest and index. removeLocale clears the
      // manifest field itself, and returns early if it is already cleared —
      // clearing it here first skipped the pathname-index and content-cache
      // cleanup, leaving the deleted translation routable and cached.
      this.contentIndex.removeLocale(manifest.id, locale);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: ensureError(error),
      };
    }
  }

  getSite(siteName: string): Site | null {
    if (siteName === 'fragments') {
      throw new Error('Use `fragments` property instead of getSite("fragments")');
    }

    // Own-key only: the name is caller-supplied, and an inherited key like
    // `constructor` would resolve to a truthy non-Site.
    return Object.hasOwn(this.sites, siteName) ? this.sites[siteName] : null;
  }

  *listAllContent(filters?: GlobalFilters): Generator<ContentManifest> {
    yield* filterContentWithIndexes(this.contentIndex, filters, this.sitesConfig);
  }
  *findUntranslatedContent(targetLocale: string, options?: FindOptions): Generator<ContentManifest> {
    yield* this.contentIndex.findUntranslatedContent(targetLocale, options);
  }

  /**
   * Reindex files that were added or changed after initial creation
   *
   * This method:
   * 1. Either scans for all content files or processes specific paths
   * 2. Uses the path index to check if files are already indexed
   * 3. Indexes new files or force-reindexes specified files
   * 4. Optionally handles file deletions
   *
   * @param paths - Optional array of specific file paths to reindex. If not provided, scans all content files.
   * @param options - Options for reindexing behavior
   * @returns Statistics about the reindexing operation
   */
  async reindex(paths?: string[], options?: { handleDeletions?: boolean }): Promise<ReindexResult> {
    const filesToProcess = paths || (await this.scanContentFiles());
    let filesSkipped = 0;
    let filesProcessed = 0;
    let filesDeleted = 0;
    let errors = 0;
    const filesToIndex: string[] = [];
    const updated: LocalizedManifest[] = [];
    const deleted: Array<{ id: string; locale: string; kind: 'page' | 'fragment' | 'data' }> = [];

    // Check each file
    for (const filePath of filesToProcess) {
      // Check if file exists (for deletion handling)
      if (options?.handleDeletions && paths) {
        try {
          await readFile(filePath);
        } catch {
          // File doesn't exist - remove from index
          const parsed = this.parseFilePath(filePath);
          if (parsed) {
            // Find the content ID to remove
            let manifest: ContentManifest | null = null;
            if (parsed.kind === 'fragment' && parsed.name) {
              manifest = this.contentIndex.getFragmentByName(parsed.collection, parsed.name, parsed.locale);
            } else if (parsed.kind === 'data' && parsed.name) {
              manifest = this.contentIndex.getDataByName(parsed.collection, parsed.name, parsed.locale);
            } else if (parsed.kind === 'page' && parsed.site && parsed.pathname) {
              manifest = this.contentIndex.getByPathname(parsed.site, parsed.pathname, parsed.locale);
            }
            // A name finds an entry when any of its locales has it. A save that renames one locale
            // writes its new file and then deletes the old one, whose name the other locales still
            // carry: only a locale whose own name is the deleted file's has lost its file.
            if (parsed.kind !== 'page' && manifest?.locales[parsed.locale]?.name !== parsed.name) {
              manifest = null;
            }

            if (manifest) {
              // Track the deletion
              deleted.push({
                id: manifest.id,
                locale: parsed.locale,
                kind: parsed.kind,
              });

              // Remove the specific locale or entire entry if it's the last locale
              if (Object.keys(manifest.locales).length === 1) {
                this.contentIndex.removeEntry(manifest.id);
              } else {
                // Remove just this locale. removeLocale clears the manifest field itself and returns early
                // if it is already cleared, so clearing it here first left the locale's name taken.
                this.contentIndex.removeLocale(manifest.id, parsed.locale);
              }
              filesDeleted++;
            }
          }
          continue;
        }
      }

      const parsed = this.parseFilePath(filePath);
      if (!parsed) {
        console.warn(`Skipping unrecognized file pattern: ${filePath}`);
        errors++;
        continue;
      }

      // Check if this path is already indexed
      let isIndexed = false;
      if (parsed.kind === 'fragment' && parsed.name) {
        // Check fragment index by name
        const manifest = this.contentIndex.getFragmentByName(parsed.collection, parsed.name, parsed.locale);
        isIndexed = !!manifest;
      } else if (parsed.kind === 'page' && parsed.site && parsed.pathname) {
        // Check site index by pathname
        const manifest = this.contentIndex.getByPathname(parsed.site, parsed.pathname, parsed.locale);
        isIndexed = !!manifest;
      } else if (parsed.kind === 'data' && parsed.name) {
        // Check data index by name
        const manifest = this.contentIndex.getDataByName(parsed.collection, parsed.name, parsed.locale);
        isIndexed = !!manifest;
      }

      if (isIndexed) {
        if (!paths) {
          // Skip already indexed files when doing a full scan
          filesSkipped++;
        } else {
          // For specific paths, check if the file has changed
          const fileStats = await readFile(filePath);
          let currentManifest: ContentManifest | null = null;
          if (parsed.kind === 'fragment' && parsed.name) {
            currentManifest = this.contentIndex.getFragmentByName(parsed.collection, parsed.name, parsed.locale);
          } else if (parsed.kind === 'data' && parsed.name) {
            currentManifest = this.contentIndex.getDataByName(parsed.collection, parsed.name, parsed.locale);
          } else if (parsed.kind === 'page' && parsed.site && parsed.pathname) {
            currentManifest = this.contentIndex.getByPathname(parsed.site, parsed.pathname, parsed.locale);
          }

          if (currentManifest) {
            // Calculate current file etag
            const buffer = fileStats as Uint8Array;
            let currentEtag: string;

            if (filePath.endsWith('.mdx')) {
              const contentPos = findMdxContentStartPosition(buffer);
              const etags = calculateEtagsFromMdxBuffer(buffer, contentPos);
              currentEtag = `${etags.metaEtag}.${etags.contentEtag}`;
            } else if (filePath.endsWith('.vxjson')) {
              const etagResult = VXJSON.calculateETags(buffer);
              if (!etagResult.success) {
                // File needs repair - add to filesToIndex for repair
                filesToIndex.push(filePath);
                continue;
              }
              currentEtag = etagResult.contentEtag
                ? `${etagResult.metaEtag}.${etagResult.contentEtag}`
                : etagResult.metaEtag;
            } else if (filePath.endsWith('.json')) {
              // For JSON data files, use content hash as etag
              currentEtag = xxh64(buffer).toString(16);
            } else {
              // Unknown file type, skip
              filesSkipped++;
              continue;
            }

            // Only reindex if etag changed
            const existingEtag = currentManifest.locales[parsed.locale]?.etag;

            if (existingEtag === currentEtag) {
              const relativePath = filePath.replace(`${this.absoluteContentRoot}/`, '');
              console.log(`[Content] skip ${relativePath} (unchanged)`);
              filesSkipped++;
            } else {
              filesToIndex.push(filePath);
            }
          } else {
            // Not indexed yet
            filesToIndex.push(filePath);
          }
        }
      } else {
        // Not indexed yet
        filesToIndex.push(filePath);
      }
    }

    // Index the files
    const buffers = Array.from({ length: Math.min(filesToIndex.length, 100) }, () => new Uint8Array(4096));

    // Drop the previous verdicts for every file this pass re-examines, so
    // problems do not pile up across reindexes. A full scan re-examines every
    // file that is not already indexed — and a file with a problem is never
    // indexed — so it can start from an empty slate.
    if (paths) {
      this.contentIndex.dropProblems(new Set(filesToIndex));
    } else {
      this.contentIndex.clearProblems();
    }

    for (let i = 0; i < filesToIndex.length; i++) {
      const filePath = filesToIndex[i];
      const bufferIndex = i % buffers.length;

      try {
        const result = await this.parseFileHeaderWithRepair(filePath, buffers[bufferIndex]);
        if (result) {
          const { manifest, localeVersion, content } = result;

          // A different file already claims this id+locale. Its file still
          // being on disk is what tells a stray copy (refuse, or it merges
          // over the original and a page silently stops existing) apart from
          // an out-of-band rename (the old path is gone — this file is the
          // entry's new home and must keep merging).
          const claimant = this.contentIndex.getManifest(manifest.id);
          const claimedLocale = claimant?.locales[localeVersion.locale];
          if (claimant && claimedLocale) {
            const claimantPath = this.getFilePath(claimant, claimedLocale);
            const claimantOnDisk = await access(claimantPath).then(
              () => true,
              () => false,
            );
            if (claimantPath !== filePath && claimantOnDisk) {
              this.recordIndexProblem(
                filePath,
                'duplicate-id',
                duplicateIdMessage(manifest.id, localeVersion.locale, claimantPath),
              );
              filesSkipped++;
              continue;
            }
          }

          // Add to index
          this.contentIndex.addContent(manifest, localeVersion, content);
          filesProcessed++;

          // Create LocalizedManifest for the updated list
          const localizedManifest: LocalizedManifest = {
            id: manifest.id,
            type: manifest.type,
            kind: manifest.kind,
            site: manifest.site,
            collection: manifest.collection,
            localized: localeVersion,
          };
          updated.push(localizedManifest);
        }
      } catch (error) {
        console.error(`Failed to reindex ${filePath}: ${messageOf(error)}`);
        this.recordIndexProblem(filePath, 'index-error', messageOf(error));
        errors++;
      }
    }

    const result: ReindexResult = {
      filesProcessed,
      filesSkipped,
      updated,
    };

    if (options?.handleDeletions && deleted.length > 0) {
      result.filesDeleted = filesDeleted;
      result.deleted = deleted;
    }

    if (errors > 0) {
      result.errors = errors;
    }

    return result;
  }

  /**
   * Read content directly from cache
   * For testing purposes - returns null if not cached
   */
  async readFromCache(id: string, locale: string): Promise<ContentData | null> {
    return this.contentIndex.getCachedContent(id, locale);
  }

  async getContentAsBuffer(
    id: string,
    locale: string,
  ): Promise<{
    buffer: Uint8Array;
    etag: string;
    contentType: 'application/json' | 'text/mdx';
  } | null> {
    const manifest = this.contentIndex.getManifest(id);
    if (!manifest?.locales[locale]) {
      return null;
    }

    const localeVersion = manifest.locales[locale];
    const filePath = this.getFilePath(manifest, localeVersion);
    const buffer = (await readFile(filePath)) as Uint8Array;
    const contentType = filePath.endsWith('.mdx') ? 'text/mdx' : 'application/json';

    // Calculate ETag based on file type
    let etag: string;
    if (contentType === 'text/mdx') {
      // Find content start position for MDX
      const contentStartMarker = new TextEncoder().encode('---\n\n');
      let contentPos = -1;
      for (let i = 0; i <= buffer.length - contentStartMarker.length; i++) {
        let match = true;
        for (let j = 0; j < contentStartMarker.length; j++) {
          if (buffer[i + j] !== contentStartMarker[j]) {
            match = false;
            break;
          }
        }
        if (match) {
          contentPos = i + contentStartMarker.length;
          break;
        }
      }
      const etags = calculateEtagsFromMdxBuffer(buffer, contentPos);
      etag = `${etags.metaEtag}.${etags.contentEtag}`;
    } else {
      // Calculate ETags for JSON
      const etagResult = VXJSON.calculateETags(buffer);

      if (!etagResult.success) {
        throw new Error(`Invalid VXJSON format in getContentAsBuffer: ${etagResult.error}`);
      }

      etag = etagResult.contentEtag ? `${etagResult.metaEtag}.${etagResult.contentEtag}` : etagResult.metaEtag;
    }

    return { buffer, etag, contentType };
  }

  async batchUpdate(operations: UpdateLocaleInput[]): Promise<BatchResult> {
    // First, validate all operations can succeed
    const validationResults: Array<{
      op: UpdateLocaleInput;
      manifest: ContentManifest;
      localeVersion: LocaleVersion;
      current?: LocaleFileData;
    }> = [];

    for (const op of operations) {
      const manifest = this.contentIndex.getManifest(op.id);
      if (!manifest) {
        // Content not found
        return {
          operations: operations.map((o) => ({
            id: o.id,
            locale: o.locale,
            updated: false,
            error: new Error('Content not found'),
          })),
          success: false,
          updated: 0,
          failed: operations.length,
        };
      }

      const localeVersion = manifest.locales[op.locale];
      if (!localeVersion) {
        // Locale not found
        return {
          operations: operations.map((o) => ({
            id: o.id,
            locale: o.locale,
            updated: false,
            error: new Error('Locale not found'),
          })),
          success: false,
          updated: 0,
          failed: operations.length,
        };
      }

      // Check etag
      if (localeVersion.etag !== op.etag) {
        // Stale write detected
        return {
          operations: operations.map((o) => ({
            id: o.id,
            locale: o.locale,
            updated: false,
            error: new Error('Stale write'),
          })),
          success: false,
          updated: 0,
          failed: operations.length,
        };
      }

      // Read current content for validation
      const filePath = this.getFilePath(manifest, localeVersion);
      const current = await this.readLocaleFile(filePath, op.locale);
      if (!current) {
        return {
          operations: operations.map((o) => ({
            id: o.id,
            locale: o.locale,
            updated: false,
            error: new Error('Failed to read content'),
          })),
          success: false,
          updated: 0,
          failed: operations.length,
        };
      }

      // Validate metadata size if updating
      if (op.data.meta) {
        const newMeta = applyMetaPatch(current.meta, op.data.meta);
        const validation = validateAndPrepareMetadata(newMeta);
        if (!validation.valid) {
          return {
            operations: operations.map((o) => ({
              id: o.id,
              locale: o.locale,
              updated: false,
              error: new Error(validation.error!),
            })),
            success: false,
            updated: 0,
            failed: operations.length,
          };
        }
      }

      validationResults.push({ op, manifest, localeVersion, current });
    }

    // All validations passed, now perform updates
    const results: BatchOperationResult[] = [];
    let updated = 0;

    for (const { op } of validationResults) {
      const result = await this.updateLocalized(op);
      if (result.success) {
        updated++;
        results.push({ id: op.id, locale: op.locale, updated: true, etag: result.etag });
      } else {
        // This shouldn't happen if validation was correct
        results.push({ id: op.id, locale: op.locale, updated: false, error: result.error });
      }
    }

    return {
      operations: results,
      success: updated === operations.length,
      updated,
      failed: operations.length - updated,
    };
  }
}

/** Whether two paths name one file, as 'hero.en.mdx' and 'Hero.en.mdx' do on a case-insensitive disk. */
async function isSameFile(a: string, b: string): Promise<boolean> {
  const [statA, statB] = await Promise.all([stat(a), stat(b)]).catch(() => [null, null]);
  return statA !== null && statB !== null && statA.dev === statB.dev && statA.ino === statB.ino;
}
