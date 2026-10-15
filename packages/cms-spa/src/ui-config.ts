/* oxlint-disable no-underscore-dangle -- __UI_CONFIG__ is the existing browser-global compatibility contract read by embedded hosts. */
import type { ContentAPIClient, EditorDataBindings } from '@conloca/content-api-client';
import type { QueryClientConfig } from '@tanstack/react-query';
import type { MediaBridge } from './media/types.js';

export interface TemplateConfig {
  label: string;
  component: string;
  pathPrefix?: string;
  description?: string;
}

/**
 * Does the site serve draft preview?
 *
 * `'unknown'` is not a failure — it means nobody has established the answer
 * yet, and every consumer must behave exactly as it did before this existed.
 * Only a definitive `'unavailable'` may take a control away from the user.
 */
export type PreviewCapability = 'available' | 'unavailable' | 'unknown';

/** Outcome of `openPreview`: a draft-preview URL, or why the site has none. */
export type OpenPreviewResult =
  | { ok: true; url: string }
  /**
   * The site does not serve draft preview, so no URL exists that could work.
   * `message` is written for the person editing the page, not for a log.
   */
  | { ok: false; reason: 'not-deployed'; message: string };

/**
 * Why the editor refuses to write, in the words of the person editing.
 *
 * It is an OBJECT rather than a `readOnly: boolean` because a control that
 * dies without saying why is the worst thing this seam could produce: the
 * reader is left with an editor that silently eats their work and no idea
 * what to do about it. A refusal that carries no reason is therefore not
 * representable, and the reason MUST name the recovery — cms-spa has no
 * route vocabulary of its own, so the embedding host writes the sentence.
 */
export interface EditorWriteRefusal {
  readonly reason: string;
}

/**
 * Whether the editor may write, as a value the caller has to take apart.
 *
 * A union rather than a flag: the reason is reachable ONLY after narrowing
 * `writable`, so a consumer cannot read the capability and forget the
 * explanation, and cannot treat an unhandled case as permission.
 */
export type EditorWriteAccess =
  | { readonly writable: true }
  | { readonly writable: false; readonly refusal: EditorWriteRefusal };

export interface UIConfig {
  basename?: string;
  apiBaseUrl?: string;
  siteBaseUrl?: string; // Base URL for the site (e.g., '/docs' or 'https://example.com/docs')
  enableDevtools?: boolean;
  queryClientOptions?: QueryClientConfig;
  /**
   * Optional content client supplied by an embedding host. When absent,
   * CmsSpaApp creates the default ContentAPIClient from `apiBaseUrl`.
   */
  contentClient?: ContentAPIClient;
  /** Absolute path to project root (for "Open in Editor" links) */
  projectRoot?: string;
  /** Relative path to schemas file (e.g., './src/schemas.ts') */
  schemasPath?: string;
  /** Page creation templates */
  templates?: Record<string, TemplateConfig>;
  /**
   * True when at least one site in `sites.json` declares an `mdxPages`
   * path. Drives whether the create-page dialog exposes the "Document
   * page" (MDX) option. When absent or false, the dialog only creates
   * Puck pages — the historical behavior.
   */
  mdxPagesEnabled?: boolean;
  /**
   * The site's supported locales. Comes from the top-level `locales`
   * option on `conlocaCMS({...})` (which can be derived from
   * `localesFromAstroI18n` / `localesFromStarlight`). When absent the
   * dialog falls back to a single English locale and hides the locale
   * field entirely.
   */
  locales?: { list: string[]; defaultLocale: string };
  /**
   * The site's routing data bindings, which the page editor builds each
   * page's data context from so blocks resolve against the same collections
   * and page feed as on the published page. conlocaCMS fills it, and a host
   * app can pass the bindings in later with {@link setDataBindings}; without
   * them blocks resolve with no context.
   */
  dataBindings?: EditorDataBindings;
  /**
   * When true, cms-spa is embedded in a host app that already owns
   * identity, account, and site-state UI. The sidebar
   * suppresses widgets that would compete with the host (UserAvatar,
   * GitStatusPanel) and lets the host's chrome show through. The document
   * editors also leave Cmd/Ctrl+S to the host (a host that binds it calls
   * `flushOpenEditor` first), while their visible Save buttons stay: the
   * editor's Save and any save action the host offers are different actions.
   * Default false: cms-spa runs as the whole page (astro-cms, dev-entry).
   */
  hosted?: boolean;
  /**
   * When true, document editors hide their Save control entirely on top
   * of releasing Cmd/Ctrl+S — for hosts whose chrome is the only save
   * affordance. Host apps that show the editor should prefer plain
   * `hosted`, which keeps the in-editor Save button visible.
   * Default false keeps the standalone editor's Save unchanged.
   */
  hideEditorSave?: boolean;
  /**
   * Bridge a host app installs to surface extra per-asset media
   * metadata (e.g. branch-vs-published scope) in cms-spa's media
   * surfaces. cms-spa's renderer-neutral `AssetEntry` does NOT
   * carry that metadata because astro-cms on its own has no notion
   * of branch-only assets. Surfaces consult the bridge through a
   * TanStack-wrapped hook (`useAssetScope` in `media/use-asset-scope.ts`)
   * so per-asset lookups cache cleanly.
   *
   * Optional in `UIConfig` — when absent, AssetCard /
   * AssetDetailSidebar skip the scope pill entirely. This keeps
   * astro-cms standalone working unchanged.
   */
  mediaBridge?: MediaBridge;
  /**
   * Base path the media surfaces build thumbnail URLs against
   * (`buildAssetServeUrl(assetsBasePath, folder, filename)`). A host
   * passes its own base here when it serves media somewhere other than
   * the `/__cms/api/assets/serve` default; astro-cms passes the one under
   * the route it mounts the CMS at. When absent, `MediaPage`/`ImagePicker`
   * pass `undefined` and `AssetCard`/`AssetDetailSidebar` keep their
   * literal default.
   */
  assetsBasePath?: string;
  /** Draft-image render base; render URLs must never replace canonical saved asset refs. */
  draftAssetsBasePath?: string;
  /**
   * Base the STORED asset reference is built on (`buildAssetRef(folder,
   * filename)`) — the sibling of `assetsBasePath`, and deliberately a
   * different thing: `assetsBasePath` is where the editor READS draft bytes,
   * this is what the reference in the saved content SAYS.
   *
   * astro-cms injects the URL where the site serves its media folder, derived
   * from `assetsPath`, the resolved publicDir and the site's base path, so the
   * stored string is the URL the published page loads. It is empty when the
   * media folder is publicDir itself on a site served at the root. A host that
   * injects nothing gets `/assets`.
   */
  assetRefBase?: string;
  /**
   * Draft preview: a host returns a preview URL for the current page path.
   * When set, the editor Preview button calls this instead of bare `buildUrl`
   * (live site). The standalone astro-cms editor leaves it unset.
   *
   * Returns a RESULT rather than throwing for `not-deployed`, because a site
   * that does not serve draft preview is an ordinary, expected answer — a fact
   * about that site — not a failure of the call. The two must
   * stay distinguishable: one is the site's setup, the other is a fault.
   */
  openPreview?: (input: { path: string }) => Promise<OpenPreviewResult>;
  /**
   * Whether the site actually serves draft preview.
   * `'unknown'` (the default) means not established yet and the editor leaves
   * the control enabled — `openPreview` is the authoritative gate. Only a
   * definitive `'unavailable'` disables it.
   */
  previewCapability?: PreviewCapability;
  /**
   * Present when the editor must render its content but refuse every write
   * — when the app that embeds the editor has decided that this account may
   * not change content right now. ABSENT is the only way to say "writable":
   * there is no `false`, so the seam cannot be half-set.
   *
   * Deliberately NOT a blanket "hide the editor": the person editing still
   * sees everything they would get back by regaining write access, and the
   * published site is unaffected either way. Reads keep working; every write
   * is refused with {@link EditorWriteRefusal.reason}.
   */
  readOnly?: EditorWriteRefusal;
}

const defaultConfig: UIConfig = {
  basename: '/__cms',
  apiBaseUrl: '/__cms/api',
  siteBaseUrl: '', // No base URL by default (site at root)
  enableDevtools: false,
  queryClientOptions: {
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5, // 5 minutes
        retry: 1,
      },
    },
  },
};

declare global {
  interface Window {
    __UI_CONFIG__?: UIConfig;
  }
}

let config: UIConfig = { ...defaultConfig };

export function configureUI(options: Partial<UIConfig>) {
  // `readOnly` survives a reinstall unless the caller states a new answer.
  //
  // Every other field here describes ONE workspace, and a host app runs
  // `configureUI` again whenever it switches workspace. The write grant does
  // not: it is an account-level fact whose lifetime spans every workspace in
  // the org. Rebuilding the config from `defaultConfig` would quietly hand
  // writes back to a read-only account on the next branch switch — a silent
  // re-grant nobody would see in review. `in` rather than `!== undefined`, so
  // an explicit `{ readOnly: undefined }` still clears it.
  const readOnly = 'readOnly' in options ? options.readOnly : config.readOnly;
  config = { ...defaultConfig, ...options, readOnly };

  // Make it available globally for the runtime
  if (typeof window !== 'undefined') {
    window.__UI_CONFIG__ = config;
  }
}

/**
 * Install (or clear, with `null`) the editor's read-only refusal after
 * `configureUI` has run — the same post-configure swap point as
 * {@link setSiteBaseUrl}, and the one a host app uses, because whether the
 * account may write can arrive over the network long after the synchronous
 * mount config is installed.
 *
 * `null` CLEARS, and clearing has to be as easy as setting: an account that
 * regains write access gets its editor back as soon as the host app says so,
 * without a reload.
 */
export function setEditorReadOnly(readOnly: EditorWriteRefusal | null) {
  const next = readOnly ?? undefined;
  config.readOnly = next;
  if (typeof window === 'undefined') return;
  // The runtime mirror `getUIConfig` reads from.
  const runtimeConfig = window.__UI_CONFIG__;
  if (runtimeConfig) runtimeConfig.readOnly = next;
}

/**
 * Override the rendered-site root after `configureUI` has run. A host may know
 * the site URL only AFTER `configureUI` has run, so it passes that URL in
 * here — the same post-configure swap point `setPuckConfig` / `setSiteStyles`
 * use. `buildSiteUrl` reads the live value, so the editor "Preview" action
 * opens the site rather than the editor origin. No-op-safe: writes both the
 * module-level config and the window global `getUIConfig` reads from.
 */
export function setSiteBaseUrl(siteBaseUrl: string) {
  config.siteBaseUrl = siteBaseUrl;
  if (typeof window !== 'undefined' && window.__UI_CONFIG__) {
    window.__UI_CONFIG__.siteBaseUrl = siteBaseUrl;
  }
}

/**
 * Override the preview capability after `configureUI` has run — the same
 * post-configure swap point as {@link setSiteBaseUrl}, and passed in by the
 * host the same way.
 *
 * RESET to `'unknown'` when the host has no answer yet: this config is a
 * process-wide global, so without the reset an earlier `'unavailable'` would
 * carry over to a site that previews perfectly well, and silently disable a
 * working button.
 */
export function setPreviewCapability(previewCapability: PreviewCapability) {
  config.previewCapability = previewCapability;
  if (typeof window === 'undefined') return;
  // The runtime mirror `getUIConfig` reads from.
  const runtimeConfig = window.__UI_CONFIG__;
  if (runtimeConfig) runtimeConfig.previewCapability = previewCapability;
}

/**
 * Override the page-creation templates after `configureUI` has run — the same
 * post-configure swap point as {@link setSiteBaseUrl}, passed in by a host once
 * it knows the templates.
 *
 * Replaced WHOLESALE on every call, and `undefined` clears: the config is a
 * process-wide global, so a site without templates must not inherit the
 * previous site's create-page dropdown.
 */
export function setTemplates(templates?: Record<string, TemplateConfig>) {
  config.templates = templates;
  if (typeof window === 'undefined') return;
  const runtimeConfig = window.__UI_CONFIG__;
  if (runtimeConfig) runtimeConfig.templates = templates;
}

/**
 * Override the site's data bindings after `configureUI` has run — the same
 * post-configure swap point as {@link setTemplates}, passed in by a host once
 * it knows the bindings.
 *
 * Replaced WHOLESALE on every call, and `undefined` clears: the config is a
 * process-wide global, so a site without bindings must not build its pages'
 * data context from the previous site's routes.
 */
export function setDataBindings(dataBindings?: EditorDataBindings) {
  config.dataBindings = dataBindings;
  if (typeof window === 'undefined') return;
  const runtimeConfig = window.__UI_CONFIG__;
  if (runtimeConfig) runtimeConfig.dataBindings = dataBindings;
}

export function getUIConfig(): UIConfig {
  if (typeof window === 'undefined') {
    return config;
  }

  // Check if already configured via global
  if (window.__UI_CONFIG__) {
    return window.__UI_CONFIG__;
  }

  // For development mode, auto-configure. `readOnly` is carried across
  // because it is the one field here that is NOT a property of this page's
  // workspace: dropping it would re-grant writes to a refused account.
  if (window.location.pathname === '/') {
    return {
      ...defaultConfig,
      basename: undefined,
      enableDevtools: true,
      readOnly: config.readOnly,
    };
  }

  return config;
}

/**
 * The route the CMS is mounted at, without a trailing slash. The integration
 * serves the editor's own endpoints — styles, content wrapper, component
 * render, registry — under `<route>/api`, so a site that moves the CMS off
 * `/__cms` moves them with it.
 */
export function getCmsRoute(): string {
  return (getUIConfig().basename ?? '/__cms').replace(/\/+$/, '');
}
