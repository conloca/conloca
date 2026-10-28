import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readEditorDescriptors } from '@conloca/astro-cms/node';
import { DEFAULT_EDITOR_ENDPOINT, editorUiOrigin } from '@conloca/content-api/editor-host';
import type { AstroIntegration } from 'astro';
import type { UserConfig as ViteUserConfig } from 'vite';
import { PACKAGE_NAME, PREVIEW_BUILD_ENV_FLAG } from './constants.js';
import { emitEditorPage, mirrorEditorPage } from './editor-page/emit.js';
import { gitOutput, resolveBuildRef, resolveRepositoryUri } from './git.js';
import type { BakedPreviewOpts } from './preview/_resolve-opts.js';
import { PREVIEW_ROUTE_SEGMENT } from './preview/preview-path.js';
import { previewBuildMode, spawnPreviewBuild } from './preview-build.js';
import { type InheritedOptions, resolveInheritedOptions } from './resolve-options.js';
import { resolveBuildSiteId } from './site-id.js';
import { scaffoldSkill } from './skill.js';
import type { ConlocaCloudOptions } from './types.js';

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
 *   1. Only when `previewBuild` is given as an object and an SSR adapter
 *      exists (refused under @astrojs/vercel and @astrojs/netlify, checked
 *      already at `astro:config:done`), spawn the recursive preview build
 *      and copy the editor page into its
 *      client folder. It mounts `/_conloca/preview/` and
 *      bakes in the repository, site and branch it serves (every pass must
 *      match them), Astro's base and the commit it was built from.
 */
const VIRTUAL_PREVIEW_OPTS = 'virtual:conloca-preview-opts';
const RESOLVED_PREVIEW_OPTS = `\0${VIRTUAL_PREVIEW_OPTS}`;

export function conlocaCloud(options: ConlocaCloudOptions = {}): AstroIntegration {
  validateOptions(options);
  const repoUri = resolveRepositoryUri(options.repoUri, process.env);
  // Populated during the preview build's config:setup and read by the virtual
  // module below. Server-only — never reaches a browser bundle.
  let previewOptsModule: BakedPreviewOpts | undefined;
  // The Astro command, recorded in config:setup: only `astro build` starts
  // the preview build, so only it checks the preview adapter at config:done.
  let astroCommand: string | undefined;
  // The project root, captured in config:setup: astro:build:done only hands
  // over the build's own outDir, but the siteStyles resolve against the root,
  // and locating the CHILD build's client dir (for the editor page mirror)
  // needs the root the child resolves against.
  let projectRoot: URL | undefined;
  // Adapter name, finalized only at config:done: the preview build reads it
  // when previewBuild names no adapter of its own.
  let adapterName: string | undefined;
  // The site's Vite config, finalized at config:done: the editor page and the
  // siteStyles compile through it, as they do in conlocaCMS's dev editor. It
  // holds the site's and integrations' plugins only; Astro adds its own core
  // plugins to a separate config when it builds, so none reach the editor page.
  let viteConfig: ViteUserConfig | undefined;
  // Astro's base, as written: the editor page's URLs sit below it.
  let astroBase = '/';
  // The editor options, settled at config:done: conlocaCMS publishes its
  // channel from its own config:setup, which may run after ours.
  let inherited: InheritedOptions | undefined;
  // Whether the parent build starts the preview build, read with the adapter
  // the child will use: previewBuild.adapter, else the project's own.
  const previewMode = () =>
    previewBuildMode(options.previewBuild, (options.previewBuild || undefined)?.adapter?.name ?? adapterName);

  return {
    name: PACKAGE_NAME,
    hooks: {
      'astro:config:setup': ({ logger, injectRoute, updateConfig, config, addMiddleware, command }) => {
        // Optional-chained: unit tests drive this hook with a bare { logger }.
        projectRoot = config?.root;
        astroCommand = command;
        // The agent skill: write-if-not-exists, fail-soft, and
        // never from the recursive preview child (it would race the parent).
        if (process.env[PREVIEW_BUILD_ENV_FLAG] !== '1' && config?.root) {
          scaffoldSkill(fileURLToPath(config.root), logger);
        }
        logger.info(`integration registered (endpoint=${options.endpoint ?? DEFAULT_EDITOR_ENDPOINT})`);

        // Only the recursive preview build (which sets PREVIEW_BUILD_ENV_FLAG)
        // mounts the SSR catch-all that renders previews; a site's normal
        // build never exposes it. The route is fixed and public: the signed
        // pass, checked against what this build bakes in, is the lock.
        if (process.env[PREVIEW_BUILD_ENV_FLAG] === '1') {
          if (!repoUri) {
            throw new Error(
              `${PACKAGE_NAME}: could not determine repository identity for the preview build ` +
                '(build in a Git checkout or set repoUri as an advanced override)',
            );
          }
          // The project's own checkout answers git, not the directory the
          // build was started from.
          const projectGit = (args: string[]) => gitOutput(args, fileURLToPath(config.root));
          const buildRef = resolveBuildRef(process.env, projectGit);
          if (!buildRef.branch) {
            throw new Error(
              `${PACKAGE_NAME}: could not determine the branch the preview build serves (set CF_PAGES_BRANCH, ` +
                'WORKERS_CI_BRANCH, VERCEL_GIT_COMMIT_REF or GITHUB_REF_NAME, or build in a git checkout on a branch)',
            );
          }
          const siteId = resolveBuildSiteId({
            contentRoot: process.env.CONLOCA_CONTENT_ROOT,
            override: options.siteId,
          });
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
          // The commit this preview build's checkout holds: a PR build may
          // check out a merge commit rather than the commit CI hands over.
          // Page-status compares the branch's latest commit with it, so the
          // endpoint diffs against the content actually serving, not a newer
          // commit whose deploy never landed. A checkout commit the
          // endpoint does not have makes it render from the branch instead.
          const buildCommit = projectGit(['rev-parse', 'HEAD']) ?? buildRef.gitSha;
          // Bake the middleware's configuration into the artifact. Every value
          // is already known here — endpoint and audience are integration
          // options; repository, site, branch, base and commit are what this
          // build was made from, and every pass must match the first three —
          // so a correctly built preview deployment needs NO env vars set on
          // it. `saasIssuer` stays unbaked unless configured: it is a property
          // of the endpoint, not of the site.
          previewOptsModule = {
            saasEndpoint: options.endpoint ?? DEFAULT_EDITOR_ENDPOINT,
            // The token's `aud` is the repo URI this build resolved.
            saasAudience: repoUri,
            ...(options.saasIssuer ? { saasIssuer: options.saasIssuer } : {}),
            ...(buildCommit ? { buildCommit } : {}),
            repo: repoUri,
            siteId,
            branch: buildRef.branch,
            base: config.base ?? '/',
          };
          // Preview-build path: the child build must emit an SSR
          // artifact even when the primary build is fully static. Switch to
          // server output, apply the preview adapter (the project's own
          // adapter stays in force when it already has one), and write to a
          // SEPARATE outDir so the child never clobbers the primary dist/.
          const previewBuild = options.previewBuild || {};
          const adapter = previewBuild.adapter ?? config.adapter;
          // Throws for a missing adapter, or one the preview build is refused
          // under — the parent already checked, this keeps the child honest.
          previewBuildMode(previewBuild, adapter?.name);
          // Astro allows exactly one deployment integration. Adding
          // previewBuild.adapter next to the project's own would make the
          // child build die on Astro's adapter-conflict error, which names
          // neither this integration nor the option — fail here with the
          // actual cause. The child inherits the project adapter, so the
          // option is unnecessary on SSR projects.
          if (previewBuild.adapter && config.adapter) {
            const projectAdapterName = config.adapter.name;
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
          // OUTSIDE dist/ on purpose, against the original design: a
          // wholesale static upload of dist/ must never publish the preview
          // server — and Astro clears dist/ at the start of a build, which
          // would wipe a sibling artifact parked inside it.
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
        astroBase = config.base ?? '/';
        inherited = resolveInheritedOptions(options, readEditorDescriptors());
        // A refused or missing preview adapter fails `astro build` here,
        // before the site builds, rather than after it. `astro dev`, `sync`
        // and `preview` never start the preview build, so they are left
        // alone. The child build checks its own.
        if (astroCommand === 'build' && process.env[PREVIEW_BUILD_ENV_FLAG] !== '1') previewMode();
      },
      'astro:build:done': async ({ dir, logger }) => {
        if (process.env[PREVIEW_BUILD_ENV_FLAG] === '1') {
          // The recursive preview build sets this flag on the child
          // Astro process. Writing the editor page there again would race
          // the parent, which mirrors its own copy in, so we short-circuit.
          logger.info('skipping the editor page: recursive preview build detected');
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
          logger,
        });

        // Strict opt-in: only a previewBuild given as an object starts the
        // second build.
        const previewBuild = options.previewBuild || undefined;
        if (previewBuild === undefined || previewMode() === 'off') return;
        await spawnPreviewBuild(previewBuild);
        // The child build cannot write the editor files itself (it
        // short-circuits this hook — see the recursion guard above), but in
        // a deployment that serves the site and the preview from one
        // Cloudflare Worker its client dir is THE asset set serving the site,
        // so the editor files must be there too. Mirror them from this build's dist.
        const previewOut = new URL(`${previewBuild.outDir ?? '.conloca/preview-server'}/`, projectRoot);
        const previewClient = fileURLToPath(new URL('client/', previewOut));
        await mirrorEditorPage(fileURLToPath(dir), previewClient);
        logger.info('editor page mirrored into the preview client dir');
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
