import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { AstroI18nLocales } from '@conloca/astro-cms/checks';
import { readEditorDescriptors } from '@conloca/astro-cms/node';
import { DEFAULT_EDITOR_ENDPOINT, editorUiOrigin } from '@conloca/content-api/editor-host';
import type { AstroConfig, AstroIntegration, IntegrationResolvedRoute } from 'astro';
import type { UserConfig as ViteUserConfig } from 'vite';
import { PACKAGE_NAME, PREVIEW_BUILD_ENV_FLAG } from './constants.js';
import {
  finishD3Build,
  onDemandPatterns,
  workerFirstPattern,
  writePreviewRoutes,
  writeWorkerFirst,
} from './d3-build.js';
import {
  bakedIdentity,
  bakedMedia,
  bakesMedia,
  cloudflareD8Problems,
  d8Baked,
  d8ImageEndpoint,
  hasOnDemandRoutes,
  knownImageService,
  narrowVercelCatchAll,
  previewPageHandlerPath,
  siteOnDemand,
  sitePagesOf,
  writeSitePagesList,
} from './d8-build.js';
import {
  adapterMiddlewareMode,
  D8_EDGE_REFUSAL,
  d8ConfigRefusal,
  d8EdgeRefusal,
  d8IsrRefusal,
  darkenIsrPrefix,
  readAstroConfigText,
  vercelIsrCatchesPrefix,
} from './d8-guards.js';
import { emitEditorPage, emitPreviewServerInfo } from './editor-page/emit.js';
import { resolveRepositoryUri } from './git.js';
import { messageOf } from './message-of.js';
import type { BakedPreviewOpts } from './preview/_resolve-opts.js';
import { cloudflareAdapter, resolveCloudflareAdapter } from './preview/cloudflare-adapter.js';
import type { PreviewExit } from './preview/prefix-router.js';
import {
  imageEndpointEntry,
  normalizeTrailingSlash,
  PREVIEW_ROUTE_SEGMENT,
  type PreviewServeMode,
  previewOwnEntries,
} from './preview/preview-path.js';
import {
  prerenderedKey,
  previewBuildMode,
  previewChildMode,
  previewChildPrerendered,
  spawnPreviewBuild,
} from './preview-build.js';
import { type InheritedOptions, resolveInheritedOptions } from './resolve-options.js';
import { scaffoldSkill } from './skill.js';
import type { ConlocaCloudOptions, PreviewBuildOptions } from './types.js';

// Re-export the constants that moved out of this module when the preview
// wiring broke the circular import. Public callers (and tests) import them
// from `./index.js`, which threads through here.
export { PACKAGE_NAME, PREVIEW_BUILD_ENV_FLAG };

/**
 * Returns the site's Astro integration that hooks into `astro:build:done`
 * to write the editor page and, when the site opts in, trigger a recursive
 * preview build.
 *
 * The build:done pipeline:
 *
 *   0. Write the editor page to `dist/_conloca/editor/`: `index.html`, the
 *      site's compiled puck config and styles, the MDX sandbox frame and
 *      `conloca.json`. Every build does this; the page carries no credential.
 *   1. Only when `previewBuild` is given as an object: D3 spawns the recursive preview build next to the static site
 *      and writes the dispatcher (`d3-build.ts`), failing the build when a failed preview build would leave the
 *      site's own on-demand routes unserved; D4 builds it in a separate deploy, not here; D8 spawns nothing: config:setup
 *      mounts `/_conloca/preview/` in the site's own build (`d8-build.ts`). Every preview build bakes in the
 *      repository, site and branch it serves (every pass must match them), Astro's base and the commit it was built from.
 */
const VIRTUAL_PREVIEW_OPTS = 'virtual:conloca-preview-opts';
const RESOLVED_PREVIEW_OPTS = `\0${VIRTUAL_PREVIEW_OPTS}`;

/** Where the preview build writes its server and client, outside dist/ (see config:setup). */
function previewOutDir(previewBuild: PreviewBuildOptions | false | undefined, root: URL): URL {
  return new URL(`${(previewBuild || undefined)?.outDir ?? '.conloca/preview-server'}/`, root);
}

export function conlocaCloud(options: ConlocaCloudOptions = {}): AstroIntegration {
  validateOptions(options);
  const repoUri = resolveRepositoryUri(options.repoUri, process.env);
  // Populated during the preview build's config:setup and read by the virtual
  // module below. Server-only — never reaches a browser bundle.
  let previewOptsModule: BakedPreviewOpts | undefined;
  // The exit values the preview build baked (its config:setup), reported to the site's build for the dispatcher.
  let childExit: PreviewExit | undefined;
  // The Astro command, recorded in config:setup: only `astro build` starts
  // the preview build, so only it checks the preview adapter at config:done.
  let astroCommand: string | undefined;
  // The project root, captured in config:setup: astro:build:done only hands
  // over the build's own outDir, but the siteStyles resolve against the root,
  // and locating the preview build's output needs the root it resolves against.
  let projectRoot: URL | undefined;
  // The site's Vite config, finalized at config:done: the editor page and the
  // siteStyles compile through it, as they do in conlocaCMS's dev editor. It
  // holds the site's and integrations' plugins only; Astro adds its own core
  // plugins to a separate config when it builds, so none reach the editor page.
  let viteConfig: ViteUserConfig | undefined;
  // Astro's base, as written: the editor page's URLs sit below it.
  let astroBase = '/';
  // Where the site's pages live and how Astro builds them: conloca.json lists the prerendered ones.
  let srcDir: URL | undefined;
  let serverOutput = false;
  let i18n: AstroI18nLocales | undefined;
  // The editor options, settled at config:done: conlocaCMS publishes its
  // channel from its own config:setup, which may run after ours.
  let inherited: InheritedOptions | undefined;
  // How the site's build serves drafts, settled once in config:setup: an option that cannot work turns preview off
  // for this build with a warning rather than failing the deploy.
  let siteMode: 'off' | 'd3' | 'd4' | 'd8' = 'off';
  // Whether the project has no adapter of its own, read in config:setup before the preview build switches to
  // server output: such a site can use no server islands, so its dispatcher never runs on their route.
  let projectStatic = false;
  // The site's adapter, read in config:setup: the d8 edge and isr guards depend on it.
  let adapterName: string | undefined;
  // The routes the preview build renders on demand (astro:routes:resolved), as Astro patterns.
  let onDemand: string[] = [];
  // The site's build: the routes it prerendered (astro:routes:resolved), handed to a D3 child.
  let sitePrerendered: string[] = [];
  // The site's build: its own on-demand routes (astro:routes:resolved); none means it would be static without preview,
  // undefined that the hook never ran, so nothing is known.
  let siteRoutesOnDemand: string[] | undefined;
  // d8 moved the image endpoint under the preview route (config:setup): only a site with no on-demand page.
  let imageMoved = false;
  // Where the adapter writes its server build (config:done): the Cloudflare adapter's wrangler.json is there.
  let buildServer: URL | undefined;
  // The site's build: its resolved routes (astro:routes:resolved) and config (config:done), for the d8 site-pages list.
  let siteRoutes: IntegrationResolvedRoute[] = [];
  let astroConfig: AstroConfig | undefined;
  // A D3 child: the routes its site's build prerendered, which it keeps prerendered (config:setup).
  let keepPrerendered = new Set<string>();
  // The preview build's mode (config:setup): a D4 child of a static site has no site build to ask.
  let childServeMode: PreviewServeMode = 'd4';
  // Serves the baked options as `virtual:conloca-preview-opts`, read lazily so the values config:setup bakes are
  // captured.
  const previewOptsPlugin = {
    name: 'conloca-preview-opts',
    resolveId(id: string) {
      return id === VIRTUAL_PREVIEW_OPTS ? RESOLVED_PREVIEW_OPTS : undefined;
    },
    load(id: string) {
      if (id !== RESOLVED_PREVIEW_OPTS) return undefined;
      return `export default ${JSON.stringify(previewOptsModule ?? {})};`;
    },
  };

  return {
    name: PACKAGE_NAME,
    hooks: {
      'astro:config:setup': async ({ logger, injectRoute, updateConfig, config, addMiddleware, command }) => {
        // Optional-chained: unit tests drive this hook with a bare { logger }.
        projectRoot = config?.root;
        astroCommand = command;
        projectStatic = config?.adapter === undefined;
        adapterName = config?.adapter?.name;
        // The agent skill: write-if-not-exists, fail-soft, and
        // never from the recursive preview child (it would race the parent).
        if (process.env[PREVIEW_BUILD_ENV_FLAG] !== '1' && config?.root) {
          scaffoldSkill(fileURLToPath(config.root), logger);
        }
        logger.info(`integration registered (endpoint=${options.endpoint ?? DEFAULT_EDITOR_ENDPOINT})`);
        if (process.env[PREVIEW_BUILD_ENV_FLAG] !== '1') {
          const previewBuild = options.previewBuild || undefined;
          let mode: typeof siteMode = 'off';
          try {
            mode = previewBuildMode(previewBuild, config?.adapter?.name, previewBuild?.adapter?.name);
            // §4.6: refused before anything registers, since d8's own middleware is what breaks an edge build.
            if (mode === 'd8' && command === 'build') {
              const text = readAstroConfigText(config.root);
              const name = config.adapter?.name ?? '';
              let refusal = d8ConfigRefusal(text, name, config.base);
              // Only these adapters' config:done merely stores state, so only they may be called out of order.
              if (refusal === null && config.adapter && (name === '@astrojs/vercel' || name === '@astrojs/netlify')) {
                refusal = d8EdgeRefusal(await adapterMiddlewareMode(config.adapter, config), text, name);
              }
              if (refusal !== null) {
                logger.warn(`preview is off for this build: ${refusal}`);
                mode = 'off';
              }
            }
            // Only `astro build` serves d8 drafts: dev, sync, check and preview read no git or sites.json for it.
            if (mode === 'd8' && command === 'build') {
              for (const name of ['config', 'outDir', 'required'] as const) {
                if (previewBuild?.[name] !== undefined) {
                  logger.warn(`previewBuild.${name} has no effect on this site: drafts render in the site's own build`);
                }
              }
              previewOptsModule = await d8Baked({ options, config, repoUri, env: process.env });
              // The draft preview renders in this build, at the preview route its own copy of the page handler
              // serves. A site without a recent astro-cms throws here, before anything is injected.
              const entrypoint = previewPageHandlerPath(config.root);
              // A hybrid site keeps its `/_image` for drafts too: Astro reads `image.endpoint` once, before routes
              // exist, and its on-demand pages need the real one. A third-party service may build live `<Image>` URLs
              // from the route, so only known services move it. Read before registering: nothing below may throw.
              const moveImage =
                knownImageService(config.image?.service?.entrypoint) && !(await hasOnDemandRoutes(config));
              injectRoute({ pattern: `${PREVIEW_ROUTE_SEGMENT}/[...path]`, entrypoint, prerender: false });
              addMiddleware({ entrypoint: '@conloca/cloud-astro/d8-middleware', order: 'pre' });
              // The middleware's Cloudflare runtime import, as in the preview build below.
              updateConfig({
                vite: { build: { rollupOptions: { external: [/^cloudflare:/] } }, plugins: [previewOptsPlugin] },
              });
              // Last, so a refusal or throw above never moves it.
              if (moveImage) {
                updateConfig({
                  image: {
                    endpoint: {
                      route: `${PREVIEW_ROUTE_SEGMENT}/_image`,
                      entrypoint: d8ImageEndpoint(config.adapter?.name ?? ''),
                    },
                  },
                });
                imageMoved = true;
              }
            }
            siteMode = mode;
          } catch (error) {
            // conlocaCMS publishes the content root from its own config:setup, which runs first only when listed first.
            const hint =
              mode === 'd8' && !process.env.CONLOCA_CONTENT_ROOT
                ? '; list conlocaCloud() after conlocaCMS() in astro.config'
                : '';
            logger.warn(`preview is off for this build: ${messageOf(error)}${hint}`);
          }
        }

        // Only the recursive preview build (which sets PREVIEW_BUILD_ENV_FLAG)
        // mounts the SSR catch-all that renders previews; a site's normal
        // build never exposes it. The route is fixed and public: the signed
        // pass, checked against what this build bakes in, is the lock.
        if (process.env[PREVIEW_BUILD_ENV_FLAG] === '1') {
          const baked = bakedIdentity({ options, config, repoUri, env: process.env });
          const childMode = previewChildMode(process.env);
          childServeMode = childMode;
          keepPrerendered = previewChildPrerendered(process.env);
          injectRoute({
            pattern: `${PREVIEW_ROUTE_SEGMENT}/[...path]`,
            entrypoint: '@conloca/cloud-astro/preview-handler',
            prerender: false,
          });
          // The route above is the ENTRY DOOR — the only URL the endpoint can
          // link to before a cookie exists. This interceptor is the serving
          // surface: once the init hop sets the `Path=/` cookie, the browser
          // sends the credential on every same-origin request, so internal
          // links keep rendering drafts instead of silently falling back to
          // published content after one page view. Fail-open — an
          // uncredentialed visitor gets the ordinary page.
          addMiddleware({ entrypoint: '@conloca/cloud-astro/site-middleware', order: 'pre' });
          previewOptsModule = { ...baked, mode: childMode };
          // The dispatcher's exit route answers with these: the values every pass is checked against.
          childExit = {
            repo: baked.repo,
            siteId: baked.siteId,
            branch: baked.branch,
            audience: baked.repo,
            ...(options.saasIssuer ? { issuer: options.saasIssuer } : {}),
          };
          // Preview-build path: the child build must emit an SSR
          // artifact even when the primary build is fully static. Switch to
          // server output, apply the preview adapter (the project's own
          // adapter stays in force when it already has one), and write to a
          // SEPARATE outDir so the child never clobbers the primary dist/.
          const previewBuild = options.previewBuild || {};
          // The site's build settled its own mode; a build started with the flag alone is a separate preview deploy,
          // so it is checked as one: refused under an adapter that deploys from the project root, and with
          // previewBuild.adapter.
          previewBuildMode(
            childMode === 'd4' ? { ...previewBuild, separate: true } : previewBuild,
            config.adapter?.name,
            previewBuild.adapter?.name,
          );
          // A site that names no adapter builds its preview server for Cloudflare Workers: next to it (D3) or apart (D4).
          const adapter = config.adapter ?? (await cloudflareAdapter(config.root, childMode));
          // Trailing slash so URL-joining treats it as a directory. Astro
          // derives build.client/build.server from outDir BEFORE hooks run,
          // so overriding outDir alone still writes into the primary dist/ —
          // all three must move together.
          // OUTSIDE dist/ on purpose, against the original design: a
          // wholesale static upload of dist/ must never publish the preview
          // server — and Astro clears dist/ at the start of a build, which
          // would wipe a sibling artifact parked inside it.
          const previewOut = previewOutDir(previewBuild, config.root);
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
              ...(adapter?.name === '@astrojs/cloudflare'
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
              plugins: [previewOptsPlugin],
            },
            // The adapter must ride in BOTH ways: as `adapter` because the
            // build gate checks `config.adapter` before creating the SSR
            // bundle, and as an integration because only the adapter's own
            // astro:config:done hook calls setAdapter — which is what the
            // build pipeline actually renders through. (Astro unshifts
            // config.adapter into the integration list BEFORE any hook runs,
            // so setting `adapter` alone here is too late for the hooks.)
            // A project that is already SSR keeps its own adapter untouched.
            // A static site's Cloudflare adapter rides in the same way.
            ...(adapter !== undefined && adapter !== config.adapter ? { adapter, integrations: [adapter] } : {}),
          });
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
       * Gated on the flag, as the config hook is: only the preview build
       * mounts the interceptor these routes must reach.
       */
      'astro:route:setup': ({ route, logger }) => {
        if (process.env[PREVIEW_BUILD_ENV_FLAG] !== '1') return;
        const cms = route.component.endsWith('/internal/page-handler.astro');
        const entry = /preview-handler(\.astro)?$/u.test(route.component);
        // `route` (the pattern) and `type` exist at runtime but are absent from the public RouteOptions type.
        const pattern = 'route' in route && typeof route.route === 'string' ? route.route : '';
        // A D3 child keeps prerendered what its static site's build prerendered, endpoints included: on demand, a
        // getStaticPaths route would lose its props, and the dispatcher would have to run on it in production. Its
        // own on-demand routes keep their own setting.
        if (!cms && keepPrerendered.has(prerenderedKey(pattern, route.component))) {
          route.prerender = true;
          return;
        }
        // Endpoints keep their prerendered data files: they emit no HTML
        // to intercept, and one built from getStaticPaths would break on demand.
        const routeType = (route as { type?: string }).type;
        // A static site's separate preview deploy (D4) has no site build to ask, but every page of the site was
        // prerendered: they stay so, or a getStaticPaths page would render on demand without its props.
        if (
          projectStatic &&
          childServeMode === 'd4' &&
          !cms &&
          !entry &&
          (routeType === undefined || routeType === 'page')
        ) {
          route.prerender = true;
          return;
        }
        if (routeType !== undefined && routeType !== 'page') return;
        // ONLY the CMS page routes go on demand. Forcing every route stripped
        // the getStaticPaths path-space partitioning: two root catch-alls (the
        // CMS pages route and e.g. Starlight's docs route) both match any path
        // once on demand, and Astro's tie-break hands the win to whichever
        // injected first — CMS pathnames rendered the docs 404. Non-CMS routes
        // keep their static output (served by the adapter before the app), and
        // App.match falls through a prerendered dynamic match to the first
        // on-demand route — exactly the CMS handler for CMS pathnames.
        if (!cms || route.prerender === false) return;
        route.prerender = false;
        logger.debug(`preview build: forcing on-demand rendering for ${route.component}`);
      },
      'astro:routes:resolved': ({ routes, logger }) => {
        if (process.env[PREVIEW_BUILD_ENV_FLAG] !== '1') {
          sitePrerendered = routes
            .filter((route) => route.isPrerendered)
            .map((route) => prerenderedKey(route.pattern, route.entrypoint));
          siteRoutesOnDemand = siteOnDemand(routes, PREVIEW_ROUTE_SEGMENT);
          siteRoutes = routes;
          if (imageMoved) {
            for (const route of siteRoutesOnDemand) {
              logger.warn(
                `preview moved the image endpoint, but ${route} renders on demand and was not visible when astro.config was read: its images are served untransformed while preview is on`,
              );
            }
          }
          return;
        }
        // Astro injects the server-islands route whenever an adapter is set, but refuses islands without one: a static
        // site uses none, so its dispatcher must not run on that route.
        const used = projectStatic ? routes.filter((route) => route.pattern !== '/_server-islands/[name]') : routes;
        onDemand = onDemandPatterns(used);
      },
      'astro:config:done': ({ config, logger }) => {
        viteConfig = config.vite;
        astroBase = config.base ?? '/';
        srcDir = config.srcDir;
        serverOutput = config.output === 'server';
        i18n = config.i18n;
        // Optional-chained: unit tests drive this hook with a partial config.
        buildServer = config.build?.server;
        astroConfig = config;
        inherited = resolveInheritedOptions(options, readEditorDescriptors());
        // d8 and D3 child builds: the media folder conlocaCMS settled in its config:setup, listed as this build deploys it.
        if (previewOptsModule !== undefined && bakesMedia(previewOptsModule.mode)) {
          try {
            const media = bakedMedia(readEditorDescriptors(), config.root);
            if (media !== undefined) previewOptsModule = { ...previewOptsModule, media };
          } catch (error) {
            // Never fail the site's build over it: draft uploads still show, images committed on the branch don't.
            logger.warn(
              `drafts won't show images committed on the branch: can't list the media folder: ${messageOf(error)}`,
            );
          }
        }
        // A missing Cloudflare adapter fails `astro build` here, before the
        // site builds, rather than after it. `astro dev`, `sync` and
        // `preview` never start the preview build, so they are left alone.
        if (astroCommand === 'build' && process.env[PREVIEW_BUILD_ENV_FLAG] !== '1') {
          // D3 builds its preview server with @astrojs/cloudflare: missing, the build fails here, before the site builds.
          if (siteMode === 'd3' && projectRoot !== undefined) resolveCloudflareAdapter(fileURLToPath(projectRoot));
        }
      },
      // Can't happen: config:setup turns d8 off for edge middleware before registering any; reaching this is a guard bug.
      'astro:build:ssr': ({ middlewareEntryPoint }) => {
        if (
          siteMode === 'd8' &&
          middlewareEntryPoint !== undefined &&
          (adapterName === '@astrojs/vercel' || adapterName === '@astrojs/netlify')
        ) {
          throw new Error(`${PACKAGE_NAME}: ${D8_EDGE_REFUSAL}`);
        }
      },
      'astro:build:done': async ({ dir, logger, pages, assets }) => {
        if (process.env[PREVIEW_BUILD_ENV_FLAG] === '1') {
          // The recursive preview build sets this flag on the child Astro process. Writing the editor page there
          // again would race the parent, which writes its own; the child reports only what the parent reads.
          logger.info('skipping the editor page: recursive preview build detected');
          if (previewChildMode(process.env) === 'd4') {
            await emitPreviewServerInfo(fileURLToPath(dir), {
              root: fileURLToPath(projectRoot ?? dir),
              repoUri,
              siteIdOverride: options.siteId,
              logger,
            });
            return;
          }
          if (projectRoot === undefined) return;
          // config:setup records the exit values in the child (below), or throws before the build starts.
          const exit = childExit;
          if (exit === undefined) throw new Error(`${PACKAGE_NAME}: the preview build recorded no exit values`);
          const root = astroBase.replace(/\/+$/u, '');
          await writePreviewRoutes(fileURLToPath(previewOutDir(options.previewBuild, projectRoot)), {
            prerendered: (pages ?? []).map(({ pathname }) => normalizeTrailingSlash(`${root}/${pathname}`)),
            onDemand: onDemand.map((pattern) => workerFirstPattern(pattern, astroBase)),
            exit,
          });
          return;
        }

        // Astro always runs the config hooks first. No fallback: compiling
        // against the working directory would build the canvas stylesheet for
        // the wrong project without a word.
        if (projectRoot === undefined || viteConfig === undefined || inherited === undefined) {
          throw new Error(
            `${PACKAGE_NAME}: astro:build:done ran before the config hooks recorded the project root and Vite config`,
          );
        }

        // §4.6 backstop for an isr config the text could not read (computed options): the adapter's build:done ran
        // first, so its routes are written. The prefix answers a static 404, so no draft is ever cached.
        const vercelConfig = new URL('.vercel/output/config.json', projectRoot);
        if (siteMode === 'd8' && adapterName === '@astrojs/vercel') {
          try {
            const routes: unknown = existsSync(vercelConfig) ? JSON.parse(readFileSync(vercelConfig, 'utf8')) : null;
            if (vercelIsrCatchesPrefix(routes, astroBase)) {
              writeFileSync(vercelConfig, JSON.stringify(darkenIsrPrefix(routes, astroBase), null, 2));
              logger.warn(`preview is off for this build: ${d8IsrRefusal(astroBase)}`);
              siteMode = 'off';
            }
          } catch (error) {
            // Decision (f): never fail the site build; with the routes unchecked, no draft may be served.
            logger.warn(
              `preview is off for this build: couldn't check .vercel/output/config.json: ${messageOf(error)}`,
            );
            siteMode = 'off';
          }
        }
        // After the backstop, so a darkened prefix stays as it is: keep visitors' misses off the preview function.
        if (siteMode === 'd8' && adapterName === '@astrojs/vercel' && existsSync(vercelConfig)) {
          try {
            const config: unknown = JSON.parse(readFileSync(vercelConfig, 'utf8'));
            const narrowed = narrowVercelCatchAll(config, siteRoutesOnDemand?.length === 0);
            if (narrowed !== null && 'config' in narrowed) {
              writeFileSync(vercelConfig, JSON.stringify(narrowed.config, null, 2));
            } else if (narrowed !== null) {
              logger.warn(
                `misses on this site run the preview function: add src/pages/404.astro (.vercel/output/config.json: ${narrowed.leave})`,
              );
            }
          } catch (error) {
            // Decision (f): drafts still render; only what a miss costs changes.
            logger.warn(
              `misses on this site run the preview function: couldn't narrow .vercel/output/config.json: ${messageOf(error)}`,
            );
          }
        }
        if (siteMode === 'd8' && adapterName === '@astrojs/cloudflare') {
          try {
            const expected = [
              // A moved image endpoint is under `<prefix>/*`; `<base>_image` then serves nothing.
              ...previewOwnEntries(astroBase).filter((entry) => !imageMoved || entry !== imageEndpointEntry(astroBase)),
              // With not_found_handling "404-page", a static site's `server:defer` islands would get the 404 page.
              workerFirstPattern('/_server-islands/[name]', astroBase),
              ...(siteRoutesOnDemand ?? []).map((pattern) => workerFirstPattern(pattern, astroBase)),
            ];
            await writeWorkerFirst(fileURLToPath(projectRoot), expected);
            // An SSR site's misses reached its Cloudflare Worker before preview, too.
            if (siteRoutesOnDemand?.length === 0 && buildServer !== undefined) {
              const wrangler: unknown = JSON.parse(readFileSync(new URL('wrangler.json', buildServer), 'utf8'));
              for (const problem of cloudflareD8Problems(wrangler, expected)) {
                logger.warn(`${problem} (\`conloca connect --update --yes\` applies this once the CLI supports d8)`);
              }
            }
          } catch (error) {
            logger.warn(`preview: couldn't check the Cloudflare routing: ${messageOf(error)}`);
          }
        }
        const mode = siteMode;
        // The editor page: every build writes it.
        await emitEditorPage({
          dir: fileURLToPath(dir),
          root: fileURLToPath(projectRoot),
          base: astroBase,
          vite: viteConfig,
          endpoint: options.endpoint,
          inherited,
          repoUri,
          siteIdOverride: options.siteId,
          previewMode: mode,
          pagesDir: fileURLToPath(new URL('pages/', srcDir ?? new URL('src/', projectRoot))),
          serverOutput,
          i18n,
          logger,
        });
        // After the editor page: on Cloudflare the list goes in its folder, which the editor page must create.
        if (mode === 'd8' && adapterName !== undefined && astroConfig !== undefined) {
          try {
            const sitePages = sitePagesOf(pages ?? [], assets ?? new Map(), siteRoutes, dir, astroBase);
            await writeSitePagesList(adapterName, astroConfig, sitePages);
          } catch (error) {
            // Decision (f): drafts still render; the site's own pages just aren't kept inside the preview.
            logger.warn(`preview: the site-pages list failed: ${messageOf(error)}`);
          }
        }

        // Strict opt-in: only a previewBuild given as an object starts the second build. D4 builds it elsewhere.
        const previewBuild = options.previewBuild || undefined;
        if (previewBuild === undefined || mode !== 'd3') return;
        const previewOut = previewOutDir(previewBuild, projectRoot);
        // D3: a failed preview build is isolated unless its server also serves the live site (finishD3Build decides).
        let built = true;
        try {
          await spawnPreviewBuild({ ...previewBuild, required: true }, 'd3', sitePrerendered);
        } catch (error) {
          built = false;
          logger.warn(`the preview build failed: ${messageOf(error)}`);
        }
        await finishD3Build({
          root: fileURLToPath(projectRoot),
          dist: fileURLToPath(dir),
          previewOut: fileURLToPath(previewOut),
          base: astroBase,
          endpoint: options.endpoint ?? DEFAULT_EDITOR_ENDPOINT,
          built,
          logger,
        });
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

/** The options the editor page made obsolete; naming one fails the build so the config gets updated. */
const REMOVED_OPTIONS = [
  'buildToken',
  'requireRegistration',
  'publicBaseUrl',
  'previewDomain',
  'editorBundlePlugins',
  'fragmentPreviewRoute',
] as const;

/** Refuses a removed option, a malformed endpoint, or one that is not an `app.` address, at config load. */
function validateOptions(options: ConlocaCloudOptions): void {
  for (const name of REMOVED_OPTIONS) {
    if (name in options) {
      throw new Error(
        `${PACKAGE_NAME}: option "${name}" was removed — run \`npx @conloca/cli connect\` to update this config`,
      );
    }
  }
  if (options.endpoint === undefined) return;
  try {
    // Throws on malformed URLs; we don't keep the parsed value.
    new URL(options.endpoint);
  } catch {
    throw new Error(`${PACKAGE_NAME}: endpoint must be a valid URL, got ${options.endpoint}`);
  }
  if (editorUiOrigin(options.endpoint) === null) {
    throw new Error(
      `${PACKAGE_NAME}: endpoint must be the workspace editor's app. address (for example https://app.conloca.com), got ${options.endpoint}`,
    );
  }
}
