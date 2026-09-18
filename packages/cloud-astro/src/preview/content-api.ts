import type {
  BatchResult,
  ContentAPI,
  ContentEntry,
  ContentManifest,
  CreateContentInput,
  CreateResult,
  DeleteLocaleInput,
  DeleteResult,
  FindOptions,
  Fragments,
  GlobalFilters,
  LocaleVersion,
  LocalizedEntry,
  Site,
  SitesConfig,
  UpdateLocaleInput,
  UpdateResult,
} from '@conloca/content-api';
import type { PreviewContext } from './middleware.js';

/**
 * `Data` is not re-exported from `@conloca/content-api`'s package index; we
 * pull it off the `ContentAPI` interface via an indexed type so the preview
 * reader's `data` field has the same nominal shape without depending on
 * deep imports.
 */
type ContentAPIData = ContentAPI['data'];

/**
 * Options consumed by {@link PreviewContentAPI}.
 *
 * The reader is constructed once per request inside the preview SSR
 * dispatcher; passing the baseline reader through the options keeps the
 * "no long-lived cache" rule honest (no per-package singleton can
 * accidentally outlive a request).
 *
 * `embeddedPayloads` is the optimisation the endpoint's page-status route
 * uses to avoid N+1 fetches when it has already loaded a changed dependency
 * to compute the page render graph. Keys are `"${id} ${locale}"`; the value
 * is the full {@link LocalizedEntry} envelope the renderer would have read
 * from disk. When supplied, {@link PreviewContentAPI.getLocalized} short-
 * circuits the network fetch for that pair.
 *
 * `fetchFn` is the optional fetch injection seam. Tests pass a recording
 * stub so the network is never touched.
 */
export interface PreviewContentAPIOptions {
  saasEndpoint: string;
  ctx: PreviewContext;
  /**
   * The build's static collection-backed reader. Used for `304` fall-back
   * inside `getLocalized` when the endpoint reports a dependency unchanged in the
   * branch, and as the manifest source only when the branch listing could not
   * be loaded. A loaded branch listing is authoritative for additions,
   * deletions, and each manifest's locale set.
   */
  baselineApi: ContentAPI;
  embeddedPayloads?: ReadonlyMap<string, LocalizedEntry>;
  fetchFn?: typeof fetch;
}

/**
 * Per-request preview-aware `ContentAPI` reader.
 *
 * The page handler boundary reads through `Astro.locals.contentApi` when
 * present; the preview dispatcher installs an instance of this class on that
 * property. For unchanged dependencies the reader transparently
 * falls back to the baseline so the production assets are reused; for changed
 * dependencies the reader fetches `/preview/content` from the endpoint,
 * carrying the preview JWT in the `Authorization` header.
 *
 * Write methods always return a failure result — preview SSR is strictly
 * read-only: no write reaches the endpoint from the preview reader.
 */
export class PreviewContentAPI implements ContentAPI {
  /**
   * Fragments/Data facades delegate to the baseline reader. The preview
   * renderer reads fragment / data dependencies through `getLocalized` once
   * the page handler has resolved the dependency id, so the facades only
   * need to surface the baseline's listing semantics for legacy callers.
   */
  readonly fragments: Fragments;
  readonly data: ContentAPIData;

  private readonly opts: PreviewContentAPIOptions;
  private readonly fetchImpl: typeof fetch;
  /** The branch's page set, once {@link loadBranchManifests} has run. */
  private branchManifests?: ContentManifest[];
  private readonly localizedReads = new Map<string, Promise<LocalizedEntry | null>>();

  constructor(opts: PreviewContentAPIOptions) {
    this.opts = opts;
    // Bind the global fetch: `this.fetchImpl(...)` is a method call, and on
    // Cloudflare Workers an unbound fetch invoked with a foreign `this` throws
    // "Illegal invocation" (Node does not care, so only workerd catches it).
    this.fetchImpl = opts.fetchFn ?? fetch.bind(globalThis);
    this.fragments = opts.baselineApi.fragments;
    this.data = opts.baselineApi.data;
  }

  get sitesConfig(): SitesConfig {
    return this.opts.baselineApi.sitesConfig;
  }

  // -------------------------------------------------------------------------
  // Reads — the actual preview behaviour.
  // -------------------------------------------------------------------------

  async getContent(id: string): Promise<ContentEntry | null> {
    const manifest =
      this.branchManifests === undefined
        ? await this.opts.baselineApi.getContent(id)
        : (this.branchManifests.find((entry) => entry.id === id) ?? null);
    if (!manifest) return null;

    const locales: ContentEntry['locales'] = {};
    for (const locale of Object.keys(manifest.locales)) {
      const localized = await this.getLocalized(id, locale);
      if (localized) {
        locales[locale] = withContent(localized);
      }
    }
    if (Object.keys(locales).length === 0) return null;
    return { ...manifest, locales };
  }

  async getLocalized(id: string, locale: string): Promise<LocalizedEntry | null> {
    const embedded = this.opts.embeddedPayloads?.get(embeddedKey(id, locale));
    if (embedded) return embedded;

    // Request-scoped memoization (the instance lives for one render, so this
    // is not a long-lived cache): the render enumerates the
    // same entries repeatedly — page listing, fragment listing, dependency
    // reads — and every duplicate would be another round trip to the endpoint
    // against the Cloudflare Workers subrequest budget. Failures are evicted so a later read
    // can retry.
    const key = embeddedKey(id, locale);
    const inFlight = this.localizedReads.get(key);
    if (inFlight) return inFlight;
    const read = this.fetchLocalized(id, locale);
    this.localizedReads.set(key, read);
    read.catch(() => this.localizedReads.delete(key));
    return read;
  }

  private async fetchLocalized(id: string, locale: string): Promise<LocalizedEntry | null> {
    const url = `${this.opts.saasEndpoint}/preview/content/${id}/${locale}`;
    const response = await this.fetchImpl(url, {
      headers: { authorization: `Bearer ${this.opts.ctx.jwt}` },
    });

    if (response.status === 304) {
      return this.opts.baselineApi.getLocalized(id, locale);
    }
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`preview fetch ${id}/${locale}: ${response.status}`);
    }
    const data: unknown = await response.json();
    if (!isLocalizedEntry(data)) {
      throw new Error(`preview fetch ${id}/${locale}: malformed payload`);
    }
    return data;
  }

  async getContentAsBuffer(
    id: string,
    locale: string,
  ): Promise<{ buffer: Uint8Array; etag: string; contentType: 'application/json' | 'text/mdx' } | null> {
    return this.opts.baselineApi.getContentAsBuffer(id, locale);
  }

  // -------------------------------------------------------------------------
  // Sites / listings.
  // -------------------------------------------------------------------------

  getSite(siteName: string): Site | null {
    return this.opts.baselineApi.getSite(siteName);
  }

  /**
   * Prefetch the branch's own manifest listing.
   *
   * The baseline is a snapshot of the last PRODUCTION build, so it cannot know
   * about a page created on the branch and still contains pages the branch
   * deleted — listing from it makes new pages unpreviewable and deleted ones
   * linger. The branch is the authority for the page set; the baseline stays
   * the fallback for unchanged dependency CONTENT.
   *
   * Prefetched rather than fetched lazily because `ContentAPI.listAllContent`
   * is a synchronous generator. On any failure the listing is left unset and
   * `listAllContent` degrades to the baseline — a stale page set renders
   * something, an exception renders nothing.
   */
  async loadBranchManifests(): Promise<void> {
    try {
      // /preview/manifests admits the preview scope; the editor listing at
      // /api/v1/content/manifests filters a preview JWT to `*`-prefixed ids
      // and would return an empty page set here.
      const response = await this.fetchImpl(`${this.opts.saasEndpoint}/preview/manifests`, {
        headers: { authorization: `Bearer ${this.opts.ctx.jwt}` },
      });
      if (!response.ok) return;
      const data: unknown = await response.json();
      if (Array.isArray(data)) this.branchManifests = data as ContentManifest[];
    } catch {
      // Network/parse failure — keep the baseline listing.
    }
  }

  *listAllContent(filters?: GlobalFilters): Generator<ContentManifest> {
    if (this.branchManifests === undefined) {
      yield* this.opts.baselineApi.listAllContent(filters);
      return;
    }
    for (const manifest of this.branchManifests) {
      if (filters?.collection !== undefined && manifest.collection !== filters.collection) continue;
      if (filters?.kind !== undefined && manifest.kind !== filters.kind) continue;
      if (filters?.site !== undefined && manifest.site !== filters.site) continue;
      yield manifest;
    }
  }

  *findUntranslatedContent(targetLocale: string, options?: FindOptions): Generator<ContentManifest> {
    yield* this.opts.baselineApi.findUntranslatedContent(targetLocale, options);
  }

  // -------------------------------------------------------------------------
  // Writes — always rejected. Preview SSR never mutates branch state;
  // edits go through the editor at the endpoint, never through the site.
  // -------------------------------------------------------------------------

  async createContent(_input: CreateContentInput): Promise<CreateResult> {
    return { success: false, reason: 'write_error', error: new Error(WRITE_REJECTED_MESSAGE) };
  }

  async updateLocalized(_input: UpdateLocaleInput): Promise<UpdateResult> {
    return { success: false, reason: 'write_error', error: new Error(WRITE_REJECTED_MESSAGE) };
  }

  async deleteContent(_id: string, _etag: string): Promise<DeleteResult> {
    return { success: false, reason: 'delete_error', error: new Error(WRITE_REJECTED_MESSAGE) };
  }

  async deleteLocalized(_input: DeleteLocaleInput): Promise<DeleteResult> {
    return { success: false, reason: 'delete_error', error: new Error(WRITE_REJECTED_MESSAGE) };
  }

  async batchUpdate(operations: UpdateLocaleInput[]): Promise<BatchResult> {
    return {
      operations: operations.map((operation) => ({
        id: operation.id,
        locale: operation.locale,
        updated: false,
        error: new Error(WRITE_REJECTED_MESSAGE),
      })),
      success: false,
      failed: operations.length,
      updated: 0,
    };
  }
}

const WRITE_REJECTED_MESSAGE = 'preview SSR is read-only; edits must go through the editor at the endpoint';

/**
 * Composes the embedded-payload map key. Public so the dispatcher (and the
 * page-status response decoder) can build keys that the reader will match
 * without leaking the encoding choice across modules.
 */
export function embeddedKey(id: string, locale: string): string {
  return `${id} ${locale}`;
}

/**
 * Lift a localized entry into the `LocaleVersion & { content }` shape that
 * `ContentEntry.locales` expects. The entry is already the right shape — the
 * helper exists so the dependency on `LocaleVersion` is documented at the
 * call site rather than buried in a structural cast.
 */
function withContent(entry: LocalizedEntry): LocaleVersion & { content: LocalizedEntry['localized']['content'] } {
  return entry.localized;
}

function isLocalizedEntry(value: unknown): value is LocalizedEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { id?: unknown; localized?: unknown };
  if (typeof v.id !== 'string') return false;
  if (typeof v.localized !== 'object' || v.localized === null) return false;
  const l = v.localized as { etag?: unknown; locale?: unknown; content?: unknown };
  return typeof l.etag === 'string' && typeof l.locale === 'string' && typeof l.content === 'object';
}
