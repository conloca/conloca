/**
 * The site's build serving d8: the draft preview renders inside the site's own build, at the preview route, with
 * the values every pass is checked against baked in. Also what every preview build bakes.
 */

import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { mediaRefPath } from '@conloca/content-api';
import { isRecord } from '@conloca/content-api/component-vocabulary';
import { DEFAULT_EDITOR_ENDPOINT } from '@conloca/content-api/editor-host';
import type { AstroConfig, IntegrationResolvedRoute } from 'astro';
import { PACKAGE_NAME } from './constants.js';
import { declaredDomains, deployProblems, onDemandPatterns } from './d3-build.js';
import { mediaFromBuild } from './editor-page/emit.js';
import { gitOutput, resolveBuildRef } from './git.js';
import type { BakedPreviewOpts, BakedSitePages } from './preview/_resolve-opts.js';
import { normalizeTrailingSlash } from './preview/preview-path.js';
import { resolveBuildSiteId } from './site-id.js';
import type { ConlocaCloudOptions } from './types.js';

/**
 * astro-cms's second copy of its page handler, as the site resolves it: a route injected at it is a route of its own,
 * where one at the published handler's file would be taken for that route.
 */
export function previewPageHandlerPath(root: URL): string {
  const manifest = createRequire(new URL('package.json', root)).resolve('@conloca/astro-cms/package.json');
  const path = join(dirname(manifest), 'dist', 'internal', 'preview-page-handler.astro');
  if (!existsSync(path)) {
    throw new Error(`@conloca/astro-cms is too old for draft preview on this site (no ${path}); upgrade it`);
  }
  return path;
}

export interface BakeInput {
  options: ConlocaCloudOptions;
  config: Pick<AstroConfig, 'root' | 'base'>;
  repoUri: string | undefined;
  env: NodeJS.ProcessEnv;
}

/**
 * What every preview build bakes into its artifact, so a correctly built preview needs NO env vars on the
 * deployment: the endpoint and audience are integration options; repository, site, branch, base and commit are what
 * this build was made from, and every pass must match the first three. `saasIssuer` stays unbaked unless configured:
 * it is a property of the endpoint, not of the site. Throws without a repository or a branch.
 */
export function bakedIdentity({
  options,
  config,
  repoUri,
  env,
}: BakeInput): BakedPreviewOpts & { repo: string; siteId: string; branch: string } {
  if (!repoUri) {
    throw new Error(
      `${PACKAGE_NAME}: could not determine repository identity for the preview build ` +
        '(build in a Git checkout or set repoUri as an advanced override)',
    );
  }
  // The project's own checkout answers git, not the directory the build was started from.
  const projectGit = (args: string[]) => gitOutput(args, fileURLToPath(config.root));
  const buildRef = resolveBuildRef(env, projectGit);
  if (!buildRef.branch) {
    throw new Error(
      `${PACKAGE_NAME}: could not determine the branch the preview build serves (set CF_PAGES_BRANCH, ` +
        'WORKERS_CI_BRANCH, VERCEL_GIT_COMMIT_REF or GITHUB_REF_NAME, or build in a git checkout on a branch)',
    );
  }
  const siteId = resolveBuildSiteId({ contentRoot: env.CONLOCA_CONTENT_ROOT, override: options.siteId });
  // The commit this build's checkout holds: a PR build may check out a merge commit rather than the commit CI hands
  // over. Page-status compares the branch's latest commit with it, so the endpoint diffs against the content actually
  // serving; a checkout commit the endpoint does not have makes it render from the branch instead.
  const buildCommit = projectGit(['rev-parse', 'HEAD']) ?? buildRef.gitSha;
  return {
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
}

/** What a d8 site build bakes: the identity, plus the routing values the draft render moves links with. */
export async function d8Baked(
  input: BakeInput & {
    config: Pick<AstroConfig, 'root' | 'base' | 'trailingSlash' | 'site'> &
      SitePagesConfig & {
        build: Pick<AstroConfig['build'], 'format'>;
      };
  },
): Promise<BakedPreviewOpts> {
  return {
    ...bakedIdentity(input),
    mode: 'd8',
    domains: await declaredDomains(input.env.CONLOCA_CONTENT_ROOT),
    trailingSlash: input.config.trailingSlash,
    buildFormat: input.config.build.format,
    sitePages: bakedSitePages(input.config, input.env),
  };
}

/**
 * The media folder's link base, from the source conloca.json's `media` uses, and the images in it this build deploys
 * (relative to it): a draft link to any other image is a file committed on the branch, served by the media route.
 * A branch file with a deployed file's name shows the deployed bytes. Symlinked subfolders are not followed. Unbaked
 * (no git repository, an unreadable folder), draft addresses still move; branch-committed images do not.
 * Throws when the folder can't be read.
 */
export function bakedMedia(
  channel: { assetsPath?: string; assetRefBase?: string } | undefined,
  root: URL,
): BakedPreviewOpts['media'] {
  const media = mediaFromBuild(channel, gitOutput(['rev-parse', '--show-toplevel'], fileURLToPath(root)));
  if (media === undefined || channel?.assetsPath === undefined) return undefined;
  // An empty base is the whole `public/`: the rewrite moves only draft addresses there, so nothing is listed.
  if (media.refBase === '') return { refBase: '', deployed: [] };
  const { assetsPath } = channel;
  const entries = existsSync(assetsPath) ? readdirSync(assetsPath, { recursive: true, withFileTypes: true }) : [];
  const deployed = entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(assetsPath, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter((file) => mediaRefPath(`${media.refBase}/${file}`, media.refBase) !== undefined);
  // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts its own array.
  return { refBase: media.refBase, deployed: deployed.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) };
}

/** Only builds that render drafts from this build's own files bake its media list. */
export function bakesMedia(mode: string | undefined): boolean {
  return mode === 'd8' || mode === 'd3';
}

type SitePagesConfig = Pick<AstroConfig, 'site'> & {
  adapter?: { name: string };
  build: Pick<AstroConfig['build'], 'serverEntry'>;
};

function bakedSitePages(config: SitePagesConfig, env: NodeJS.ProcessEnv): BakedSitePages {
  const { serverEntry } = config.build;
  switch (config.adapter?.name) {
    case '@astrojs/node':
      return { kind: 'disk', serverEntry };
    case '@astrojs/cloudflare':
      return { kind: 'assets' };
    case '@astrojs/vercel':
    case '@astrojs/netlify': {
      // Only a production deploy's `site` serves this build's pages; a branch deploy's pages live elsewhere.
      const production = env.VERCEL_ENV === 'production' || env.CONTEXT === 'production';
      const origin = production && config.site ? config.site.replace(/\/+$/u, '') : null;
      return { kind: 'function', serverEntry, origin };
    }
    default:
      return { kind: 'none' };
  }
}

// astro-cms's published page handler: the CMS route, whose pages render drafts rather than published bytes.
const CMS_PAGE_HANDLER = '/internal/page-handler.astro';

/** The site's own prerendered pages; `exact` holds those a site route's own output file names. */
export interface SitePagesList {
  pages: string[];
  exact: string[];
}

/**
 * The pages the site prerendered itself, base included, in normalizeTrailingSlash form: every page `astro:build:done`
 * reports but those the CMS route wrote. A page goes to the route whose output files hold it (`pages` names no route);
 * that page is `exact`, since production serves the site route there by route priority. One no route's files hold
 * goes to the first prerendered route that matches it (`routes` is in Astro's priority order), and is not exact.
 */
export function sitePagesOf(
  pages: readonly { pathname: string }[],
  assets: ReadonlyMap<string, readonly URL[]>,
  routes: readonly Pick<
    IntegrationResolvedRoute,
    'pattern' | 'patternRegex' | 'entrypoint' | 'isPrerendered' | 'type'
  >[],
  dir: URL,
  base: string,
): SitePagesList {
  const root = base.replace(/\/+$/u, '');
  // Whether each page Astro lists files for is the CMS route's.
  const ownedByCms = new Map(
    routes.flatMap((route) =>
      (assets.get(route.pattern) ?? []).map(
        (file) =>
          [
            normalizeTrailingSlash(
              `${root}/${decodeURI(file.pathname.slice(dir.pathname.length)).replace(/(?:^|\/)index\.html$|\.html$/u, '')}`,
            ),
            route.entrypoint.endsWith(CMS_PAGE_HANDLER),
          ] as const,
      ),
    ),
  );
  // shortcut: the Cloudflare prerenderer leaves each route only its last file in `assets`, so most pages there fall to
  // the first matching route, which lists a CMS page behind a site getStaticPaths route that does not generate it; such
  // a page is not exact, and the preview middleware renders its draft when page-status is `changed`.
  const list: SitePagesList = { pages: [], exact: [] };
  for (const { pathname } of pages) {
    const page = normalizeTrailingSlash(`${root}/${pathname}`);
    const owned = ownedByCms.get(page);
    const matched =
      owned === undefined
        ? routes.find(
            (route) => route.type === 'page' && route.isPrerendered && route.patternRegex.test(`/${pathname}`),
          )
        : undefined;
    if (owned ?? matched?.entrypoint.endsWith(CMS_PAGE_HANDLER)) continue;
    list.pages.push(page);
    // A route without parameters has one page, so matching it proves the file is that route's own.
    if (owned === false || (matched !== undefined && !matched.pattern.includes('['))) list.exact.push(page);
  }
  return list;
}

/**
 * Writes `site-pages.json` where the adapter's runtime reads it (`preview/site-page-sources.ts`), none of it needing
 * `site`: beside the Node server entry; beside every copy of the server entry in the Vercel or Netlify function bundle
 * (the adapter's build:done, which runs first, wrote it); in the Cloudflare client build's editor folder. Returns the
 * files written; throws when the function bundle holds no server entry.
 */
export async function writeSitePagesList(
  adapterName: string,
  config: Pick<AstroConfig, 'root'> & { build: Pick<AstroConfig['build'], 'server' | 'client' | 'serverEntry'> },
  list: SitePagesList,
): Promise<string[]> {
  // Where Vercel and Netlify put the function they deploy, under the project root.
  const functionRoot =
    adapterName === '@astrojs/vercel'
      ? '.vercel/output/functions/_render.func/'
      : adapterName === '@astrojs/netlify'
        ? '.netlify/v1/functions/ssr/'
        : undefined;
  let dirs: string[] = [];
  if (adapterName === '@astrojs/node') dirs = [fileURLToPath(config.build.server)];
  if (adapterName === '@astrojs/cloudflare') dirs = [join(fileURLToPath(config.build.client), '_conloca', 'editor')];
  if (functionRoot !== undefined) {
    const bundle = fileURLToPath(new URL(functionRoot, config.root));
    const files = await readdir(bundle, { recursive: true }).catch((): string[] => []);
    dirs = files
      .filter((file) => basename(file) === config.build.serverEntry && !file.split(sep).includes('node_modules'))
      .map((file) => join(bundle, dirname(file)));
    if (dirs.length === 0)
      throw new Error(`no ${config.build.serverEntry} in ${bundle} to write site-pages.json beside`);
  }
  const body = `${JSON.stringify(list)}\n`;
  return Promise.all(
    dirs.map(async (dir) => {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'site-pages.json'), body);
      return join(dir, 'site-pages.json');
    }),
  );
}

/** The endpoint d8 moves the image route to: Cloudflare's own passthrough there, Conloca's redirect elsewhere. */
export function d8ImageEndpoint(adapterName: string): string {
  return adapterName === '@astrojs/cloudflare'
    ? '@astrojs/cloudflare/image-passthrough-endpoint'
    : '@conloca/cloud-astro/preview-image-endpoint';
}

const PAGE_FILE = /\.(?:astro|md|mdx|markdown|html|js|ts|mjs)$/u;
// Astro's own rule (astro core/routing/prerender.js).
const PRERENDER_FALSE = /^\s*export\s+const\s+prerender\s*=\s*false/mu;

/**
 * Astro's own image services, Cloudflare's and Netlify's (whose URLs go to `/.netlify/images`): they serve `<Image>`
 * URLs that do not depend on the endpoint route.
 */
export function knownImageService(entrypoint: string | undefined): boolean {
  // Unset is Astro's default (sharp).
  return (
    entrypoint === undefined ||
    entrypoint.startsWith('astro/assets/services/') ||
    entrypoint.startsWith('@astrojs/cloudflare/image-service') ||
    entrypoint.startsWith('@astrojs/netlify/image-service')
  );
}

/** Whether the site renders anything on demand, as far as astro.config and `src/pages` tell before routes exist. */
export async function hasOnDemandRoutes(config: Pick<AstroConfig, 'output' | 'srcDir'>): Promise<boolean> {
  if (config.output === 'server') return true;
  const pages = fileURLToPath(new URL('pages/', config.srcDir));
  const files = await readdir(pages, { recursive: true }).catch((): string[] => []);
  const sources = await Promise.all(
    files
      // Astro skips `_`-prefixed files and folders.
      .filter((file) => PAGE_FILE.test(file) && !file.split(sep).some((part) => part.startsWith('_')))
      .map((file) => readFile(join(pages, file), 'utf8').catch(() => '')),
  );
  return sources.some((source) => PRERENDER_FALSE.test(source));
}

/** Site on-demand routes other than ours and Astro's runtime routes (`/_image`, `/_server-islands/[name]`, default `/404`). */
export function siteOnDemand(routes: Parameters<typeof onDemandPatterns>[0], prefixPattern: string): string[] {
  // onDemandPatterns already drops Astro's other internal routes, the default 404 among them.
  return onDemandPatterns(routes).filter(
    (pattern) =>
      pattern !== prefixPattern &&
      !pattern.startsWith(`${prefixPattern}/`) &&
      pattern !== '/_image' &&
      pattern !== '/_server-islands/[name]',
  );
}

const VERCEL_STATIC_404 = { src: '^/.*$', dest: '/404.html', status: 404 };
// The function's `/404` under any base and trailing-slash setting: `^/404/?$`, `^/404$`, `^/docs/404/?$`.
const RENDERED_404 = /^\^(?:\/[^/^$]+)*\/404(?:\/\?)?\$$/u;

/** The rewritten Vercel config, or null to leave it (with the reason to warn). */
export function narrowVercelCatchAll(
  config: unknown,
  siteStaticWithoutPreview: boolean,
): { config: unknown } | { leave: string } | null {
  // An SSR site's misses reached its function before preview, too.
  if (!siteStaticWithoutPreview) return null;
  if (!isRecord(config) || !Array.isArray(config.routes)) return { leave: 'it has no routes list' };
  const last: unknown = config.routes.at(-1);
  // A prerendered 404.astro: the adapter already sends misses to it.
  if (isDeepStrictEqual(last, VERCEL_STATIC_404)) return null;
  if (!isDeepStrictEqual(last, { src: '^/.*$', dest: '_render' })) {
    return { leave: `its final route is not the adapter's catch-all: ${JSON.stringify(last)}` };
  }
  const kept = config.routes
    .slice(0, -1)
    .filter(
      (route: unknown) =>
        !(isRecord(route) && route.dest === '_render' && typeof route.src === 'string' && RENDERED_404.test(route.src)),
    );
  return { config: { ...config, routes: [...kept, VERCEL_STATIC_404] } };
}

/** Problems in the Cloudflare adapter's dist/server/wrangler.json for a d8 site, each with what it breaks and the edit (empty when fine). */
export function cloudflareD8Problems(wrangler: unknown, expected: readonly string[]): string[] {
  const assets = isRecord(wrangler) && isRecord(wrangler.assets) ? wrangler.assets : {};
  return [
    ...deployProblems(wrangler, expected, false).map(
      (problem) =>
        `${problem}: drafts get a 404 (preview broken); add them to assets.run_worker_first in wrangler.jsonc`,
    ),
    ...(assets.not_found_handling === '404-page'
      ? []
      : [
          'wrangler.jsonc assets.not_found_handling is not "404-page": misses start the Cloudflare Worker; set assets.not_found_handling to "404-page" in wrangler.jsonc',
        ]),
  ];
}
