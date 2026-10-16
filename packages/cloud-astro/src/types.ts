import type { AstroIntegration } from 'astro';
import type { Plugin as EsbuildPlugin } from 'esbuild';

/**
 * Configuration for a recursive preview build that runs immediately after the
 * site's production build completes. The preview build emits the SSR routes
 * that serve draft preview.
 *
 * Set to `false` to explicitly opt out of preview builds for sites that do not
 * need a draft/preview pipeline.
 */
export interface PreviewBuildOptions {
  /**
   * Optional alternative Astro adapter to use for the preview build.
   * Falls back to the project's default adapter when omitted.
   */
  adapter?: AstroIntegration;
  /**
   * Adapter-specific config overrides forwarded to the recursive build.
   */
  config?: Record<string, unknown>;
  /**
   * Output directory for the preview build. Defaults to `.conloca/preview-server`
   * — outside `dist/`, so the secret-baked artifact can never ride a wholesale
   * static upload of the site and Astro's dist-clearing cannot wipe it.
   */
  outDir?: string;
  /**
   * If true, fail the parent build when the preview build fails. Defaults to
   * true; set false while setting up.
   */
  required?: boolean;
}

/**
 * Options accepted by {@link conlocaCloud}.
 *
 * Registration authenticates with one build token (`cbt_<id>.<secret>`)
 * issued by the endpoint. Repository identity is normally detected from CI metadata or the Git
 * checkout.
 */
export interface ConlocaCloudOptions {
  /** Editor endpoint, e.g. 'https://cms.example.com', no trailing slash. */
  endpoint: string;
  /**
   * Advanced override for repository identity, normalized to `owner/repo`.
   * Normally omit this: Conloca detects GitHub, Vercel, or GitLab CI metadata,
   * then falls back to the checkout's `remote.origin.url`. Registration is
   * rejected when the token does not cover the detected repo.
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
   * Build token issued by the endpoint. Prefer injecting it via the
   * CONLOCA_BUILD_TOKEN environment variable instead of committing it here;
   * when neither is present the build skips registration (fail soft, unless
   * `requireRegistration` is set).
   */
  buildToken?: string;
  /**
   * Entry module of the puck config to compile into the editor bundle,
   * e.g. './src/puck.config.tsx'. Same option name as @conloca/astro-cms.
   */
  puckConfigPath: string;
  /**
   * Site CSS for accurate preview rendering — same option name and shape
   * as `conlocaCMS({ siteStyles })`, and compiled the same way: by the site's
   * own Vite pipeline (its plugins, PostCSS config and preprocessors), into
   * the canvas stylesheet each build registers, ahead of the
   * component modules, e.g. './src/styles/index.scss'. Paths resolve against
   * the project root. The assets these stylesheets reference are emitted under
   * `/_conloca/`, and an entry that fails to compile fails the build. Component
   * `*.module.(s)css` imports compile in automatically — list here only what
   * lives outside the component graph.
   */
  siteStyles?: string | string[];
  /**
   * esbuild plugins for the editor bundle (puck config, its components and the
   * conlocaCMS schemas module). That bundle is built with esbuild, outside the
   * site's Vite pipeline, so a source transform the site's Vite plugins apply
   * — e.g. Typia's `createValidate<T>()` generation in page schemas — must be
   * passed here in its esbuild form too, or the bundle carries untransformed
   * calls that throw when the editor loads it.
   */
  editorBundlePlugins?: EsbuildPlugin[];
  /**
   * Representative content route for build-time style discovery — the SAME
   * name and meaning as `conlocaCMS`'s option: the page whose styles and
   * content-wrapper shape prose editing should adopt. When set, the build
   * reads that route's rendered page (a prerendered file, or the booted node
   * server entry), collects its CSS and wrapper shape, and registers them
   * alongside the bundle. Unset: discovery is skipped and the editor falls
   * back to the prose-safe derived tier.
   *
   * @example '/blog/welcome-post'
   */
  fragmentPreviewRoute?: string;

  /**
   * Public base URL of the deployed site, used to absolutize the editor
   * bundle URL when no dedicated preview domain is configured. Falls back to
   * the CF_PAGES_URL env var; without either, registration is skipped.
   */
  publicBaseUrl?: string;
  /**
   * Optional dedicated preview deployment as a hostname or absolute URL. A
   * hostname is normalized to HTTPS. When set, editor assets and preview links
   * use this deployment instead of the production site's public base URL.
   */
  previewDomain?: string;
  /**
   * Recursive preview build configuration. Set to `false` to opt out.
   * Defaults to enabled with project defaults.
   */
  previewBuild?: PreviewBuildOptions | false;
  /**
   * The token issuer (the JWT `iss` the preview middleware pins).
   * Set it to bake the value into the preview artifact; otherwise the
   * deployment must supply `CONLOCA_SAAS_ISSUER` at runtime.
   */
  saasIssuer?: string;
  /**
   * Fail the build when registration is SKIPPED for a missing prerequisite
   * (no build token, no repository identity, no git sha/branch, no public
   * base URL). Default false, so a plain `astro build` without the token
   * stays untouched. Turn it on in CI once setup is done: a deploy can
   * then never silently leave the editor at the endpoint stale. An ATTEMPTED
   * registration that fails always fails the build, regardless of this.
   */
  requireRegistration?: boolean;
}
