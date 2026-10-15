import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readEditorDescriptors } from '@conloca/astro-cms/node';
import type { AstroIntegration, AstroIntegrationLogger } from 'astro';
import type { UserConfig as ViteUserConfig } from 'vite';
import { registrationCommits } from './build-commit.js';
import type { BundledStylesheet, BundleEditorAssetsResult } from './bundle.js';
import { bundleEditorAssets, emitRouteCssArtifact, mirrorEditorAssets } from './bundle.js';
import { type ComponentManifestArtifact, emitComponentManifest } from './component-manifest.js';
import { BUILD_TOKEN_ENV_VAR, PACKAGE_NAME, PREVIEW_BUILD_ENV_FLAG, PREVIEW_SECRET_ENV_FLAG } from './constants.js';
import { resolveEditorDescriptors } from './descriptors.js';
import type { DiscoveredStyleContext } from './discovery.js';
import { discoverStyleContext } from './discovery.js';
import { gitOutput, resolveBuildRef, resolveRepositoryUri } from './git.js';
import { packageVersion } from './package-version.js';
import { spawnPreviewBuild } from './preview-build.js';
import { postRegistration } from './register.js';
import { resolveBuildSiteId } from './site-id.js';
import { scaffoldSkill } from './skill.js';
import type { ConlocaCloudOptions } from './types.js';

// Re-export the constants that moved out of this module when the preview
// wiring broke the circular import. Public callers (and tests) import them
// from `./index.js`, which threads through here.
export { PACKAGE_NAME, PREVIEW_BUILD_ENV_FLAG };

/**
 * Returns the site's Astro integration that hooks into `astro:build:done`
 * to bundle editor assets, register the build at `endpoint`, and
 * (optionally) trigger a recursive preview build.
 *
 * The build:done pipeline:
 *
 *   1. esbuild the site's puck config into one browser ESM bundle under
 *      `dist/_conloca/` with react/react-dom/jsx-runtime/puck externalized
 *      (the editor supplies them at runtime), plus a `_headers` CORS
 *      rule so the editor's origin can load it cross-origin. For a conlocaCMS
 *      build it also writes the component manifest there (what each
 *      component accepts, read from source) and registers its URL + hash
 *      with the bundle.
 *   2. POST the registration (repo, git sha, branch, bundle URL + hash) to the
 *      endpoint, authenticated by the build token. An ATTEMPTED
 *      registration that is rejected FAILS THE BUILD — the error carries the
 *      endpoint's exact status and body. Only a never-attempted registration (no
 *      build token, repo identity, git sha/branch, or public base URL) skips,
 *      ending the build with one summary block — or failing it when
 *      `requireRegistration` is set.
 *   3. Spawn the recursive preview build with the preview secret
 *      returned by registration (or the env override).
 */
const VIRTUAL_PREVIEW_OPTS = 'virtual:conloca-preview-opts';
const RESOLVED_PREVIEW_OPTS = `\0${VIRTUAL_PREVIEW_OPTS}`;

export function conlocaCloud(options: ConlocaCloudOptions): AstroIntegration {
  validateOptions(options);
  const repoUri = resolveRepositoryUri(options.repoUri, process.env);
  // Populated during the preview build's config:setup and read by the virtual
  // module below. Server-only — never reaches a browser bundle.
  let previewOptsModule: Record<string, string> | undefined;
  // The project root, captured in config:setup: astro:build:done only hands
  // over the build's own outDir, but the siteStyles resolve against the root,
  // and locating the CHILD build's client dir (for the editor-asset mirror)
  // needs the root the child resolves against.
  let projectRoot: URL | undefined;
  // Adapter name, finalized only at config:done. Discovery boots the built
  // server entry for `output: 'server'` sites, and only the node adapter's
  // entry is a plain bootable process (see discovery.ts).
  let adapterName: string | undefined;
  // The site's Vite config, finalized at config:done: the siteStyles compile
  // through it, as they do in conlocaCMS's dev editor.
  let viteConfig: ViteUserConfig | undefined;

  return {
    name: PACKAGE_NAME,
    hooks: {
      'astro:config:setup': ({ logger, injectRoute, updateConfig, config, addMiddleware }) => {
        // Optional-chained: unit tests drive this hook with a bare { logger }.
        projectRoot = config?.root;
        // The agent skill: write-if-not-exists, fail-soft, and
        // never from the recursive preview child (it would race the parent).
        if (process.env[PREVIEW_BUILD_ENV_FLAG] !== '1' && config?.root) {
          scaffoldSkill(fileURLToPath(config.root), logger);
        }
        logger.info(
          `integration registered (endpoint=${options.endpoint}, previewMode=${
            options.previewDomain ? 'preview-domain' : 'same-domain-runtime'
          })`,
        );

        // Only the recursive preview build (which sets PREVIEW_BUILD_ENV_FLAG)
        // mounts the secret-scoped SSR catch-all that renders previews. A
        // site's normal build must never expose it; the per-branch secret in
        // the path is the load guard (JWT validation in the handler is the real
        // auth boundary). Without a secret there is nothing to scope, so skip.
        if (process.env[PREVIEW_BUILD_ENV_FLAG] === '1') {
          const secret = process.env[PREVIEW_SECRET_ENV_FLAG];
          if (secret) {
            if (!repoUri) {
              throw new Error(
                `${PACKAGE_NAME}: could not determine repository identity for the preview build ` +
                  '(build in a Git checkout or set repoUri as an advanced override)',
              );
            }
            injectRoute({
              pattern: `/conloca_preview_${secret}/[...path]`,
              entrypoint: '@conloca/cloud-astro/preview-handler',
              prerender: false,
            });
            // The prefixed route above is the ENTRY DOOR — the only URL the
            // endpoint can link to before a cookie exists. This interceptor is the
            // serving surface: once the init hop sets the `Path=/` cookie, the
            // browser sends the credential on every same-origin request, so
            // internal links keep rendering drafts instead of silently falling
            // back to published content after one page view. Fail-open — an
            // uncredentialed visitor gets the ordinary page.
            addMiddleware({ entrypoint: '@conloca/cloud-astro/site-middleware', order: 'pre' });
            // Bake the middleware's configuration into the artifact. Every
            // value is already known here — the secret arrived with
            // registration, endpoint/audience are integration options — so a
            // correctly built preview deployment needs NO env vars set on it.
            // That also closes a chicken-and-egg loop: the secret is generated
            // DURING this build, but the deployment that would carry it as an
            // env var only happens afterwards. `saasIssuer` stays unbaked
            // unless configured: it is a property of the endpoint, not of the site.
            // The commit this preview build's checkout holds: a PR build may
            // check out a merge commit rather than the PR commit it registers.
            // Page-status compares the branch's latest commit with it, so the
            // endpoint diffs against the content actually serving, not a newer
            // registration whose deploy never landed. A checkout commit the
            // endpoint does not have makes it render from the branch instead.
            const buildCommit = registrationCommits({
              eventCommitSha: process.env.CF_PAGES_COMMIT_SHA,
              checkoutCommitSha: gitOutput(['rev-parse', 'HEAD']),
            }).buildId;
            previewOptsModule = {
              secret,
              saasEndpoint: options.endpoint,
              // The token's `aud` is the repo URI as registered — the same
              // string this integration posts at registration time.
              saasAudience: repoUri,
              ...(options.saasIssuer ? { saasIssuer: options.saasIssuer } : {}),
              ...(buildCommit ? { buildCommit } : {}),
            };
            // Preview-build path: the child build must emit an SSR
            // artifact even when the primary build is fully static. Switch to
            // server output, apply the preview adapter (the project's own
            // adapter stays in force when it already has one), and write to a
            // SEPARATE outDir so the child never clobbers the primary dist/.
            const previewBuild = options.previewBuild === false ? {} : (options.previewBuild ?? {});
            const adapter = previewBuild.adapter ?? config.adapter;
            if (!adapter) {
              throw new Error(
                `${PACKAGE_NAME}: the preview build needs an SSR adapter — the project is static and ` +
                  'previewBuild.adapter is not set. Pass one (e.g. previewBuild: { adapter: cloudflare() }) ' +
                  'or set previewBuild: false to opt out of draft preview.',
              );
            }
            // Astro allows exactly one deployment integration. Adding
            // previewBuild.adapter next to the project's own would make the
            // child build die on Astro's adapter-conflict error, which names
            // neither this integration nor the option — fail here with the
            // actual cause. The child inherits the project adapter, so the
            // option is unnecessary on SSR projects.
            if (previewBuild.adapter && config.adapter) {
              const projectAdapterName = (config.adapter as { name?: string }).name ?? 'the project adapter';
              throw new Error(
                `${PACKAGE_NAME}: previewBuild.adapter conflicts with the project's own adapter ` +
                  `(${projectAdapterName}) — Astro allows only one deployment integration per build. ` +
                  'Remove previewBuild.adapter; the preview build inherits the project adapter.',
              );
            }
            // Trailing slash so URL-joining treats it as a directory. Astro
            // derives build.client/build.server from outDir BEFORE hooks run,
            // so overriding outDir alone still writes into the primary dist/ —
            // all three must move together.
            // OUTSIDE dist/ on purpose, against the original design: the
            // artifact bakes the preview secret, so a wholesale static upload
            // of dist/ must never be able to publish it — and Astro clears
            // dist/ at the start of a build, which would wipe a sibling
            // artifact parked inside it.
            const previewOut = new URL(`${previewBuild.outDir ?? '.conloca/preview-server'}/`, config.root);
            // The site's extra config goes through its OWN updateConfig
            // call: Astro deep-merges successive calls (concatenating
            // vite.plugins and integrations), whereas spreading it into the
            // object below would shallow-replace whole keys — a user `vite`
            // entry silently dropped the required virtual-module plugin.
            // Ours comes second so the required scalars (output, outDir,
            // build dirs) always win; previewBuild.outDir is the supported
            // override for the artifact location.
            if (previewBuild.config) {
              updateConfig(previewBuild.config);
            }
            updateConfig({
              output: 'server',
              outDir: previewOut,
              build: { client: new URL('client/', previewOut), server: new URL('server/', previewOut) },
              vite: {
                // The middleware dynamically imports Cloudflare's runtime
                // module (binding transport). The Cloudflare adapter resolves
                // the scheme itself; every other adapter's Rollup pass fails
                // the child build on it unless externalized. Off Cloudflare
                // Workers the runtime import rejects and the middleware falls
                // back to the global fetch.
                build: { rollupOptions: { external: [/^cloudflare:/] } },
                // Starlight renders Steps, Tabs and FileTree with satteri's
                // htmlToHast. On Cloudflare Workers satteri resolves to a
                // binding that can be neither installed nor run on workerd, so the child
                // build fails to resolve it — swap in a stand-in there. The
                // target is an absolute path: a bare name would be looked up
                // from the Starlight file, which cannot see this package in an
                // isolated (non-hoisted) node_modules layout.
                ...(adapter.name === '@astrojs/cloudflare'
                  ? {
                      resolve: {
                        alias: [
                          {
                            find: /^satteri$/,
                            replacement: resolveSatteriStandIn(),
                          },
                        ],
                      },
                    }
                  : {}),
                plugins: [
                  {
                    name: 'conloca-preview-opts',
                    resolveId(id: string) {
                      return id === VIRTUAL_PREVIEW_OPTS ? RESOLVED_PREVIEW_OPTS : undefined;
                    },
                    load(id: string) {
                      if (id !== RESOLVED_PREVIEW_OPTS) return undefined;
                      // Read lazily so the values assigned above are captured.
                      return `export default ${JSON.stringify(previewOptsModule ?? {})};`;
                    },
                  },
                ],
              },
              // The adapter must ride in BOTH ways: as `adapter` because the
              // build gate checks `config.adapter` before creating the SSR
              // bundle, and as an integration because only the adapter's own
              // astro:config:done hook calls setAdapter — which is what the
              // build pipeline actually renders through. (Astro unshifts
              // config.adapter into the integration list BEFORE any hook runs,
              // so setting `adapter` alone here is too late for the hooks.)
              // A project that is already SSR keeps its own adapter untouched.
              ...(previewBuild.adapter ? { adapter: previewBuild.adapter, integrations: [previewBuild.adapter] } : {}),
            });
          }
        }
      },
      /**
       * Force the CMS content routes — and only those — on demand for the
       * preview build.
       *
       * Astro never runs middleware for a prerendered route — the adapter
       * serves the built file directly — so the preview interceptor could
       * never fire while content routes stayed prerendered. Draft preview
       * requires exactly this scope: the preview build uses `output: 'server'`
       * AND non-prerendered Conloca content routes. Everything else stays
       * prerendered: a preview of a non-CMS page is by definition its
       * published bytes, and keeping those routes static preserves the
       * path-space partitioning between root catch-alls (see the inline note).
       *
       * This hook, not `astro:routes:resolved`: that one hands integrations a
       * COPY of each route (`toIntegrationResolvedRoute` builds a new object)
       * and discards any mutation. `astro:route:setup` receives the live
       * record, runs AFTER the `export const prerender` source parse, and
       * Astro reads `prerender` back after every integration has run.
       *
       * Gated on the secret as well as the flag, mirroring the config hook: no
       * secret means no interceptor was mounted, so stripping the site's
       * static output would buy nothing.
       */
      'astro:route:setup': ({ route, logger }) => {
        if (process.env[PREVIEW_BUILD_ENV_FLAG] !== '1') return;
        if (!process.env[PREVIEW_SECRET_ENV_FLAG]) return;
        // `type` exists at runtime but is absent from the public RouteOptions
        // type. Endpoints keep their prerendered data files: they emit no HTML
        // to intercept, and one built from getStaticPaths would break on demand.
        const routeType = (route as { type?: string }).type;
        if (routeType !== undefined && routeType !== 'page') return;
        if (route.prerender === false) return;
        // ONLY the CMS page routes go on demand. Forcing every route stripped
        // the getStaticPaths path-space partitioning: two root catch-alls (the
        // CMS pages route and e.g. Starlight's docs route) both match any path
        // once on demand, and Astro's tie-break hands the win to whichever
        // injected first — CMS pathnames rendered the docs 404. Non-CMS routes
        // keep their static output (served by the adapter before the app), and
        // App.match falls through a prerendered dynamic match to the first
        // on-demand route — exactly the CMS handler for CMS pathnames.
        if (!route.component.endsWith('/internal/page-handler.astro')) return;
        route.prerender = false;
        logger.debug(`preview build: forcing on-demand rendering for ${route.component}`);
      },
      'astro:config:done': ({ config }) => {
        adapterName = config.adapter?.name;
        viteConfig = config.vite;
      },
      'astro:build:done': async ({ dir, logger }) => {
        if (process.env[PREVIEW_BUILD_ENV_FLAG] === '1') {
          // The recursive preview build sets this flag on the child
          // Astro process. Re-entering registration there would create an
          // infinite build loop, so we short-circuit.
          logger.info('skipping registration: recursive preview build detected');
          return;
        }

        // Astro always runs the config hooks first. No fallback: compiling
        // against the working directory would build the canvas stylesheet for
        // the wrong project without a word.
        if (projectRoot === undefined || viteConfig === undefined) {
          throw new Error(
            `${PACKAGE_NAME}: astro:build:done ran before the config hooks recorded the project root and Vite config`,
          );
        }

        // Editor descriptors (the bundle's third leg): the host's schemas
        // module and the auto-discovered MDX registry, both resolved by
        // conlocaCMS and read off its channel. The scan runs here because the
        // editor at the endpoint has no dev server to serve `/api/registry` from.
        const descriptors = await resolveEditorDescriptors(logger);

        const bundle = await bundleEditorAssets({
          dir: fileURLToPath(dir),
          root: fileURLToPath(projectRoot),
          vite: viteConfig,
          puckConfigPath: options.puckConfigPath,
          siteStyles: options.siteStyles,
          publicBaseUrl: resolveDeploymentUrl(options),
          ...(descriptors === undefined ? {} : { descriptors }),
          logger,
        });

        // The component vocabulary for agents, read from the config the bundle
        // just compiled. Only a build conlocaCMS is part of carries one (its
        // descriptor channel is how this add-on knows): without the CMS there
        // are no pages for an agent to compose. Gated on the channel itself,
        // not on `descriptors` — that is also undefined for a CMS build with
        // no schemas module, MDX components or templates, which still has a
        // Puck vocabulary. An unreadable channel already warned above.
        const componentManifest =
          readEditorDescriptors(process.env) === undefined
            ? undefined
            : await emitComponentManifest({
                dir: fileURLToPath(dir),
                puckConfigPath: options.puckConfigPath,
                projectRoot: process.cwd(),
                logger,
              });

        // Build-time style discovery: read the discovery
        // route's rendered page, collect its CSS, run the shared wrapper
        // heuristic; results ride registration below. Opt-in via the option —
        // and fail-soft throughout: a build must never die over preview
        // styling.
        let discovery: Awaited<ReturnType<typeof discoverStyleContext>>;
        let routeCssArtifact: Awaited<ReturnType<typeof emitRouteCssArtifact>>;
        if (options.fragmentPreviewRoute) {
          const clientDir = fileURLToPath(dir);
          const nodeEntry = fileURLToPath(new URL('../server/entry.mjs', dir));
          discovery = await discoverStyleContext({
            clientDir,
            serverEntry: adapterName === '@astrojs/node' && existsSync(nodeEntry) ? nodeEntry : undefined,
            route: options.fragmentPreviewRoute,
            logger,
          });
          if (discovery?.routeCss) {
            routeCssArtifact = await emitRouteCssArtifact(
              clientDir,
              discovery.routeCss,
              resolveDeploymentUrl(options),
              logger,
            );
          }
        }

        const registration = await registerBuild(options, repoUri, bundle, logger, {
          hostWrappers: discovery?.hostWrappers,
          routeCssArtifact: routeCssArtifact?.stylesheet,
          componentManifest,
        });
        let registeredSecret: string | undefined;
        if ('missing' in registration) reportSkippedRegistration(registration.missing, options, logger);
        else registeredSecret = registration.previewSecret;

        if (options.previewBuild === false) {
          // The site explicitly opted out of the recursive preview build.
          return;
        }
        // Prefer the secret returned by registration; the env override lets
        // CI smoke-test the recursive build path without a reachable endpoint.
        const previewSecret = registeredSecret ?? process.env[PREVIEW_SECRET_ENV_FLAG];
        if (!previewSecret) {
          return;
        }
        await spawnPreviewBuild(previewSecret, options.previewBuild ?? {});
        // The child build cannot compile the editor bundle itself (it
        // short-circuits this hook — see the recursion guard above), but in
        // a deployment that serves the site and the preview from one
        // Cloudflare Worker its client dir is THE asset set serving the site,
        // so the editor at the endpoint loads `/_conloca/*` from it. Mirror
        // the bundle + its CORS rule from this build's dist into it.
        // previewBuild === false already returned above, so only the options
        // object (or undefined) reaches this point.
        const previewOut = new URL(`${options.previewBuild?.outDir ?? '.conloca/preview-server'}/`, projectRoot);
        await mirrorEditorAssets(fileURLToPath(dir), fileURLToPath(new URL('client/', previewOut)), [
          ...bundle.assetCorsPaths,
          ...(routeCssArtifact?.assetCorsPaths ?? []),
        ]);
        logger.info('editor assets mirrored into the preview client dir');
      },
    },
  };
}

/** Absolute path of the satteri stand-in the Cloudflare preview build aliases `satteri` to. */
function resolveSatteriStandIn(): string {
  try {
    return createRequire(import.meta.url).resolve('@conloca/cloud-astro/satteri-workerd');
  } catch (cause) {
    throw new Error(
      `${PACKAGE_NAME}: could not resolve the satteri stand-in (@conloca/cloud-astro/satteri-workerd) that the ` +
        'Cloudflare preview build uses in place of satteri — is the package installed and built?',
      { cause },
    );
  }
}

/**
 * The origin the deployed site answers on. Used for two things that must agree:
 * absolutizing the bundle/stylesheet URLs a registration carries, and re-pointing the
 * stylesheet's own asset URLs at the site (they would otherwise resolve
 * against the editor's origin — see `rewriteStylesheetAssetUrls`).
 */
function resolveDeploymentUrl(options: ConlocaCloudOptions): string | undefined {
  if (!options.previewDomain) {
    return options.publicBaseUrl ?? process.env.CF_PAGES_URL;
  }
  const previewUrl = new URL(
    options.previewDomain.includes('://') ? options.previewDomain : `https://${options.previewDomain}`,
  );
  return previewUrl.origin;
}

/**
 * ONE end-of-build block for a skipped registration — every prerequisite that
 * was missing and what it costs — the last thing the integration prints.
 * With `requireRegistration` it fails the build instead.
 */
function reportSkippedRegistration(
  missing: string[],
  options: ConlocaCloudOptions,
  logger: AstroIntegrationLogger,
): void {
  const summary = [
    `editor at ${options.endpoint} NOT updated by this build`,
    ...missing.map((prerequisite) => `  missing: ${prerequisite}`),
    "  consequence: registration was skipped, so the editor keeps serving the previous build of this branch (or the default branch's, or nothing, if neither was ever registered)",
    '  check: conloca doctor --live',
  ].join('\n');
  if (options.requireRegistration) {
    throw new Error(`${PACKAGE_NAME}: ${summary}\n  requireRegistration is on, so this build fails.`);
  }
  logger.warn(summary);
}

/** What `registerBuild` ended with: the preview secret, or every prerequisite whose absence made it skip. */
type RegistrationOutcome = { previewSecret: string } | { missing: string[] };

/**
 * Registers the freshly built editor bundle at the endpoint. Soft-skip ONLY
 * when registration was never attempted: the pre-request guards (no build
 * token, no repo identity, no sha/branch, no base URL) each warn, and every
 * missing prerequisite is returned at once, so one build names all that setup
 * still lacks and an unregistered deploy still completes — the hook turns
 * that into one end-of-build summary (or a failure under
 * `requireRegistration`). Once a registration IS attempted, its failure
 * FAILS THE BUILD: postRegistration throws on any
 * deterministic 4xx and after exhausting the ≥500 retry backoff, and that
 * error — carrying the HTTP status and response body — propagates. A green
 * deploy whose registration silently went missing is the "deployed but
 * editor unregistered" class this project exists to kill.
 */
async function registerBuild(
  options: ConlocaCloudOptions,
  repoUri: string | undefined,
  bundle: BundleEditorAssetsResult,
  logger: AstroIntegrationLogger,
  discovery: {
    hostWrappers?: DiscoveredStyleContext['hostWrappers'];
    routeCssArtifact?: BundledStylesheet;
    componentManifest?: ComponentManifestArtifact;
  } = {},
): Promise<RegistrationOutcome> {
  const missing: string[] = [];
  const buildToken = options.buildToken ?? process.env[BUILD_TOKEN_ENV_VAR];
  if (!buildToken) {
    logger.warn(`skipping registration: no build token (set buildToken or ${BUILD_TOKEN_ENV_VAR})`);
    missing.push(`build token (set buildToken or ${BUILD_TOKEN_ENV_VAR})`);
  }

  if (!repoUri) {
    logger.warn(
      'skipping registration: could not determine repository identity ' +
        '(build in a supported CI environment or Git checkout, or set repoUri)',
    );
    missing.push('repository identity (build in a supported CI environment or Git checkout, or set repoUri)');
  }

  const { branch } = resolveBuildRef();
  // CI may hand over the branch's latest commit to register; the checkout is what was built.
  const commits = registrationCommits({
    eventCommitSha: process.env.CF_PAGES_COMMIT_SHA,
    checkoutCommitSha: gitOutput(['rev-parse', 'HEAD']),
  });
  const gitSha = commits.gitSha;
  if (!gitSha || !branch) {
    logger.warn(
      'skipping registration: could not resolve the git sha/branch ' +
        '(set CF_PAGES_COMMIT_SHA and CF_PAGES_BRANCH, or build inside a git checkout)',
    );
    missing.push('git sha/branch (set CF_PAGES_COMMIT_SHA and CF_PAGES_BRANCH, or build inside a git checkout)');
  }

  const deploymentUrl = resolveDeploymentUrl(options);
  const baseUrl = deploymentUrl;
  if (!baseUrl) {
    logger.warn(
      'skipping registration: no public base URL for the editor bundle (set previewDomain, publicBaseUrl, or CF_PAGES_URL)',
    );
    missing.push('public base URL for the editor bundle (set previewDomain, publicBaseUrl, or CF_PAGES_URL)');
  }
  // Restates the guards above, so the values below are typed as set.
  if (!buildToken || !repoUri || !gitSha || !branch || !baseUrl) return { missing };

  // Resolve the deployable-site id (STRICT): a throw here FAILS THE BUILD —
  // after the soft skip guards above, so only a build that is actually
  // registering can die on it. A silently mis-attached registration points
  // the editor at the wrong site, which is the same miss as never having
  // registered at all. The channel is CONLOCA_CONTENT_ROOT (published by
  // conlocaCMS); options.siteId is the CMS-less-build override.
  const siteId = resolveBuildSiteId({
    contentRoot: process.env.CONLOCA_CONTENT_ROOT,
    override: options.siteId,
  });

  // NO catch: from here on the registration is ATTEMPTED, and an attempted
  // registration's failure fails the build. postRegistration already retried
  // transient (≥500 / network) failures with backoff; what escapes is either
  // a deterministic 4xx (unknown siteId, bad token — fix and rebuild) or an
  // exhausted retry budget, and the error message carries the HTTP status +
  // response body verbatim.
  logger.info(
    'registering at the endpoint (transient failures retry, with up to ~2.5 minutes of waiting between attempts)',
  );
  const { previewSecret } = await postRegistration({
    endpoint: options.endpoint,
    buildToken,
    repoUri,
    gitSha,
    siteId,
    branch,
    editorBundleUrl: new URL(bundle.url, baseUrl).toString(),
    bundleHash: bundle.hash,
    ...(bundle.stylesheet === undefined
      ? {}
      : {
          stylesheetUrl: new URL(bundle.stylesheet.url, baseUrl).toString(),
          stylesheetHash: bundle.stylesheet.hash,
        }),
    ...(discovery.hostWrappers === undefined ? {} : { hostWrappers: discovery.hostWrappers }),
    ...(discovery.routeCssArtifact === undefined
      ? {}
      : {
          routeCssUrl: new URL(discovery.routeCssArtifact.url, baseUrl).toString(),
          routeCssHash: discovery.routeCssArtifact.hash,
        }),
    ...(discovery.componentManifest === undefined
      ? {}
      : {
          componentManifestUrl: new URL(discovery.componentManifest.url, baseUrl).toString(),
          componentManifestHash: discovery.componentManifest.hash,
        }),
    deploymentUrl,
    buildId: commits.buildId,
    clientVersion: packageVersion(),
  });
  logger.info(`registration complete (gitSha=${gitSha}, branch=${branch}, buildId=${commits.buildId})`);
  return { previewSecret };
}

function validateOptions(options: ConlocaCloudOptions): void {
  if (!options.endpoint) {
    throw new Error(`${PACKAGE_NAME}: endpoint is required`);
  }
  if (!options.puckConfigPath) {
    throw new Error(`${PACKAGE_NAME}: puckConfigPath is required`);
  }
  try {
    // Throws on malformed URLs; we don't keep the parsed value.
    new URL(options.endpoint);
  } catch {
    throw new Error(`${PACKAGE_NAME}: endpoint must be a valid URL, got ${options.endpoint}`);
  }
}
