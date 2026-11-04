import type { AstroIntegration } from 'astro';

/**
 * Draft previews. Off unless given as an object. A static site's preview server is a second build that runs on
 * Cloudflare Workers under `/_conloca/preview/` next to the site (D3; it needs `@astrojs/cloudflare` installed); a site
 * with an adapter renders drafts in its own build (D8); `separate: true` builds a separate preview deploy (D4).
 * `config`, `outDir` and `required` belong to D3 and D4 only (a D8 build warns they have no effect). `separate` is
 * refused under `@astrojs/vercel` and `@astrojs/netlify`.
 */
export interface PreviewBuildOptions {
  /** Refused: drafts render through the adapter in astro.config. Kept in the type so the refusal can name it. */
  adapter?: AstroIntegration;
  /**
   * Adapter-specific config overrides forwarded to the D3 or D4 preview build.
   */
  config?: Record<string, unknown>;
  /**
   * Output directory for the D3 or D4 preview build. Defaults to `.conloca/preview-server`
   * — outside `dist/`, so the preview server can never ride a wholesale static
   * upload of the site and Astro's dist-clearing cannot wipe it.
   */
  outDir?: string;
  /**
   * Changes nothing in D3 or D4. A failed D3 preview build fails the site's build only when its server also serves
   * the live site (`run_worker_first` lists routes beyond the preview route, or `not_found_handling` is `"none"`);
   * otherwise the site ships and its preview route answers "preview unavailable". A D4 build is its deploy's own.
   */
  required?: boolean;
  /**
   * Serve previews from a separate deploy (D4) instead of next to the site. The site's build then runs no preview
   * build; a second deploy builds with `CONLOCA_PREVIEW_BUILD=1`, and its address goes in sites.json `previewUrl`.
   */
  separate?: boolean;
}

/**
 * Options accepted by {@link conlocaCloud}. Every one is optional: repository
 * identity is normally detected from CI metadata or the Git checkout, and the
 * editor options come from `conlocaCMS`.
 */
export interface ConlocaCloudOptions {
  /**
   * The workspace editor's address, no trailing slash. Defaults to
   * 'https://app.conloca.com'. Its host must start with `app.`.
   */
  endpoint?: string;
  /**
   * Advanced override for repository identity, normalized to `owner/repo`.
   * Normally omit this: Conloca detects GitHub, Vercel, or GitLab CI metadata,
   * then falls back to the checkout's `remote.origin.url`.
   */
  repoUri?: string;
  /**
   * Advanced override for the deployable-site id, for CMS-less builds where
   * `conlocaCMS` does not publish CONLOCA_CONTENT_ROOT. When the CMS channel IS
   * present, the content root's sites.json is authoritative and an override
   * that contradicts it fails the build — never a silent pick.
   */
  siteId?: string;
  /**
   * Entry module of the puck config to compile into the editor bundle,
   * e.g. './src/puck.config.tsx'. Same option name as @conloca/astro-cms.
   * Defaults to the `conlocaCMS` value.
   */
  puckConfigPath?: string;
  /**
   * Site CSS for accurate preview rendering — same option name and shape
   * as `conlocaCMS({ siteStyles })`, and compiled the same way: by the site's
   * own Vite pipeline (its plugins, PostCSS config and preprocessors), into
   * the editor page's canvas stylesheet, ahead of the
   * component modules, e.g. './src/styles/index.scss'. Paths resolve against
   * the project root. The assets these stylesheets reference are emitted under
   * `/_conloca/editor/`, and an entry that fails to compile fails the build. Component
   * `*.module.(s)css` imports compile in automatically — list here only what
   * lives outside the component graph. Defaults to the `conlocaCMS` value.
   */
  siteStyles?: string | string[];
  /**
   * Off unless given as an object; the second build that serves draft
   * previews. Refused under @astrojs/vercel and @astrojs/netlify.
   */
  previewBuild?: PreviewBuildOptions | false;
  /**
   * The token issuer (the JWT `iss`) every pass must name. Unset, the preview server checks the pass against the
   * endpoint's published keys alone, so a site sets nothing at runtime; set it (or `CONLOCA_SAAS_ISSUER`) to pin it.
   */
  saasIssuer?: string;
}
