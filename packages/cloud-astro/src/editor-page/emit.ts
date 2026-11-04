import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import {
  type AstroI18nLocales,
  collectStaticPageRoutes,
  nonDefaultLocalesOf,
  type StaticPageRoute,
} from '@conloca/astro-cms/checks';
import { readEditorDescriptors } from '@conloca/astro-cms/node';
import { isValidSiteBase } from '@conloca/content-api';
import {
  type BranchDeploys,
  branchDeploysOf,
  CONLOCA_JSON_MAX_BYTES,
  contentPathsOf,
  EDITOR_HOST_PROTOCOL,
  EDITOR_PAGE_INFO_FORMATS,
  type EditorMedia,
  type EditorPageInfo,
  editorUiOrigin,
  isEditorPageInfo,
  isEditorRoute,
  isValidBranchName,
  mediaOf,
  PREVIEW_PROTOCOL,
  type PreviewMode,
  type PreviewSignal,
  ROUTES_MAX,
} from '@conloca/content-api/editor-host';
import { readSitesConfig } from '@conloca/content-api/node';
import { buildSandboxSrcdoc } from '@conloca/mdx/sandbox-frame';
import type { UserConfig } from 'vite';
import { emitComponentManifest } from '../component-manifest.js';
import { PACKAGE_NAME } from '../constants.js';
import { resolveEditorDescriptors } from '../descriptors.js';
import { gitOutput, resolveBuildRef } from '../git.js';
import { packageVersion } from '../package-version.js';
import type { InheritedOptions } from '../resolve-options.js';
import { resolveBuildSiteId } from '../site-id.js';
import { bundleEditorPage } from './bundle.js';
import { emitDataSchemas } from './data-schemas.js';
import { findFramingBlockers } from './framing.js';
import { renderEditorPage } from './page.js';
import { baseMismatch } from './site-base.js';

/** The folder, relative to the build output, that holds every file of the editor page. */
const EDITOR_DIR = '_conloca/editor';

export interface EmitEditorPageInput {
  /** Build output directory (Astro's `dir`, as a filesystem path). */
  dir: string;
  /** The Astro project root, as a filesystem path. */
  root: string;
  /** Astro's `base`, with or without its trailing slash. */
  base: string;
  /** The site's Vite config as Astro's config hooks see it, which holds no Astro core plugin. */
  vite: UserConfig;
  endpoint: string | undefined;
  inherited: InheritedOptions;
  repoUri: string | undefined;
  siteIdOverride: string | undefined;
  /** How this build serves draft previews; conloca.json `preview.mode`. */
  previewMode: PreviewMode;
  /** The site's `src/pages` folder, as a filesystem path. */
  pagesDir: string;
  /** Astro `output === 'server'`: only pages with `prerender = true` are built. */
  serverOutput: boolean;
  /** Astro's `i18n`, whose non-default locale folders hold no pages to offer. */
  i18n: AstroI18nLocales | undefined;
  logger: { info(message: string): void; warn(message: string): void };
}

/** Writes <dir>/_conloca/editor/. The endpoint was already checked to be an app. address at config load. */
export async function emitEditorPage(input: EmitEditorPageInput): Promise<void> {
  const { dir, inherited, logger } = input;
  const origin = editorUiOrigin(input.endpoint);
  if (origin === null) throw new Error(`${PACKAGE_NAME}: endpoint ${input.endpoint} is not an app. address`);
  const base = input.base.endsWith('/') ? input.base : `${input.base}/`;
  if (!isValidSiteBase(base)) {
    logger.warn(
      `base ${base} is not a plain path of letters, digits and . _ ~ - segments; the workspace editor will not open a page under it`,
    );
  }
  const contentRoot = process.env.CONLOCA_CONTENT_ROOT;
  const sitesConfig = contentRoot ? await readSitesConfig(contentRoot) : undefined;
  const mismatch = sitesConfig ? baseMismatch(sitesConfig, base) : undefined;
  if (mismatch !== undefined) logger.warn(mismatch);
  for (const { file, header } of await findFramingBlockers(input.root)) {
    logger.warn(
      `${file} sets ${header} for the whole site and has no /_conloca/editor/ rule, so the workspace editor cannot frame the editor page. Add the rule (npx @conloca/cli connect writes it).`,
    );
  }
  const folder = join(dir, EDITOR_DIR);
  if (existsSync(folder)) {
    throw new Error(
      `${PACKAGE_NAME}: ${base}_conloca/editor/ already exists in the build output (a page or a public/ file claims it). That path is reserved for the editor page; move the content elsewhere.`,
    );
  }
  const defines = Object.keys(input.vite.define ?? {});
  if (defines.length > 0) {
    logger.warn(
      `vite.define is applied to the editor page's public bundle too; make sure none of ${defines.join(', ')} holds a secret`,
    );
  }

  const descriptors = await resolveEditorDescriptors(logger);
  const bundle = await bundleEditorPage({
    dir,
    root: input.root,
    vite: input.vite,
    puckConfigPath: inherited.puckConfigPath,
    styles: [...(inherited.siteStyles ?? []), ...(inherited.editorStyles ?? [])],
    ...(descriptors === undefined ? {} : { descriptors }),
    logger,
  });
  if (descriptors?.schemasPath) {
    await emitDataSchemas({
      folder,
      root: input.root,
      vite: input.vite,
      schemasPath: descriptors.schemasPath,
      logger,
    });
  }

  let editorCssFile: string | null = null;
  if (inherited.editorCss) {
    const bytes = new TextEncoder().encode(inherited.editorCss);
    editorCssFile = `editor.${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.css`;
    await writeFile(join(folder, editorCssFile), bytes);
  }
  await writeFile(join(folder, 'sandbox-frame.html'), buildSandboxSrcdoc());

  const channel = readEditorDescriptors(process.env);
  // Only a build conlocaCMS is part of carries a vocabulary, as on the key path.
  const componentManifest =
    channel === undefined
      ? undefined
      : await emitComponentManifest({
          dir,
          folder: EDITOR_DIR,
          puckConfigPath: inherited.puckConfigPath,
          projectRoot: input.root,
          logger,
        });

  const info = editorPageInfo(input, componentManifest);
  if (!isEditorPageInfo(info)) {
    throw new Error(`${PACKAGE_NAME}: internal error: conloca.json failed its own format check`);
  }
  const repoRoot = gitOutput(['rev-parse', '--show-toplevel'], input.root);
  const contentPaths = contentPathsFromBuild(channel?.contentPaths ?? [], repoRoot);
  const media = mediaFromBuild(channel, repoRoot);
  if (media === undefined && repoRoot !== undefined && channel?.assetsPath !== undefined) {
    logger.warn(
      `the media folder ${channel.assetsPath} is not a folder of this site's repository, so the workspace editor cannot add images to it`,
    );
  }
  const branchDeploys = branchDeploysFromEnv(process.env);
  const preview: PreviewSignal = { mode: input.previewMode, protocol: PREVIEW_PROTOCOL };
  const written: WrittenConlocaJson = {
    ...info,
    preview,
    ...(branchDeploys === undefined ? {} : { branchDeploys }),
    ...(contentPaths === undefined ? {} : { contentPaths }),
    ...(media === undefined ? {} : { media }),
  };
  const collected = await collectStaticPageRoutes({
    pagesDir: input.pagesDir,
    serverOutput: input.serverOutput,
    nonDefaultLocales: nonDefaultLocalesOf(sitesConfig ?? { sites: {} }, info.siteId, input.i18n),
  });
  const { routes, left } = routesFromBuild(collected, written);
  if (left > 0) {
    logger.warn(
      `conloca.json lists ${routes.length} of ${routes.length + left} static page routes; the others have names outside the editor's route format or do not fit. \`npx @conloca/cli routes\` lists them all.`,
    );
  }
  await writeFile(join(folder, 'conloca.json'), `${JSON.stringify({ ...written, routes }, null, 2)}\n`);

  const url = (file: string) => `${base}${EDITOR_DIR}/${file}`;
  const html = renderEditorPage(
    {
      protocol: info.protocol,
      repo: info.repo,
      siteId: info.siteId,
      site: url(bundle.site),
      css: bundle.css ? [url(bundle.css)] : [],
      editorCss: editorCssFile === null ? null : url(editorCssFile),
      sandboxFrame: url('sandbox-frame.html'),
      info: url('conloca.json'),
    },
    origin,
  );
  await writeFile(join(folder, 'index.html'), html);
  logger.info(`editor page written: ${base}${EDITOR_DIR}/`);
}

/**
 * A separate preview deploy (D4) serves no editor page, but it answers its own conloca.json: its release, protocol
 * and mode, read next to the site's to tell when the two deploys run different releases.
 */
export async function emitPreviewServerInfo(
  dir: string,
  input: Pick<EmitEditorPageInput, 'root' | 'repoUri' | 'siteIdOverride' | 'logger'>,
): Promise<void> {
  const preview: PreviewSignal = { mode: 'd4', protocol: PREVIEW_PROTOCOL };
  const folder = join(dir, EDITOR_DIR);
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, 'conloca.json'),
    `${JSON.stringify({ ...editorPageInfo(input, undefined), preview }, null, 2)}\n`,
  );
}

/**
 * The Cloudflare Pages project that serves this site's branch builds: `CONLOCA_PAGES_PROJECT` (direct upload with
 * wrangler) wins, else the project in a Pages build's `CF_PAGES_URL` (`https://<hash>.<project>.pages.dev`).
 */
export function branchDeploysFromEnv(env: Record<string, string | undefined>): BranchDeploys | undefined {
  // An empty variable counts as unset, so it never hides CF_PAGES_URL.
  let project = env.CONLOCA_PAGES_PROJECT === '' ? undefined : env.CONLOCA_PAGES_PROJECT;
  if (project === undefined && env.CF_PAGES_URL !== undefined) {
    try {
      const url = new URL(env.CF_PAGES_URL);
      const labels = url.hostname.split('.');
      if (url.protocol === 'https:' && labels.length === 4 && labels.slice(2).join('.') === 'pages.dev') {
        project = labels[1];
      }
    } catch {
      return undefined;
    }
  }
  return project === undefined ? undefined : branchDeploysOf({ branchDeploys: { host: 'cloudflare-pages', project } });
}

/** Each content path under the repository root, written from that root ('' for the root itself); others are dropped. */
export function contentPathsFromBuild(paths: readonly string[], repoRoot: string | undefined): string[] | undefined {
  if (repoRoot === undefined) return undefined;
  const contentPaths = paths
    .map((path) => relative(repoRoot, path))
    .filter((path) => !isAbsolute(path))
    .map((path) => path.split(sep))
    .filter((segments) => segments[0] !== '..')
    .map((segments) => segments.join('/'));
  return contentPathsOf({ contentPaths });
}

/** conloca.json as the build writes it before its `routes`. */
export interface WrittenConlocaJson extends EditorPageInfo {
  preview: PreviewSignal;
  branchDeploys?: BranchDeploys;
  contentPaths?: string[];
  media?: EditorMedia;
}

/** The routes conloca.json lists and how many prerendered routes it leaves out. */
export interface BuildRoutes {
  routes: string[];
  left: number;
}

/**
 * The prerendered routes in the editor's route format, in order, up to `ROUTES_MAX` and while the whole conloca.json
 * stays within `CONLOCA_JSON_MAX_BYTES`; `left` counts the prerendered routes not written.
 */
export function routesFromBuild(collected: readonly StaticPageRoute[], written: WrittenConlocaJson): BuildRoutes {
  const prerendered = collected.filter((page) => page.prerendered);
  const routes: string[] = [];
  for (const { route } of prerendered) {
    if (routes.length === ROUTES_MAX) break;
    if (!isEditorRoute(route)) continue;
    routes.push(route);
    const bytes = new TextEncoder().encode(`${JSON.stringify({ ...written, routes }, null, 2)}\n`).length;
    if (bytes > CONLOCA_JSON_MAX_BYTES) {
      routes.pop();
      break;
    }
  }
  return { routes, left: prerendered.length - routes.length };
}

/** The media folder written from the repository root, with its link base; undefined outside the repository. */
export function mediaFromBuild(
  channel: { assetsPath?: string; assetRefBase?: string } | undefined,
  repoRoot: string | undefined,
): EditorMedia | undefined {
  if (repoRoot === undefined || channel?.assetsPath === undefined || channel.assetRefBase === undefined) {
    return undefined;
  }
  const path = relative(repoRoot, channel.assetsPath);
  const segments = path.split(sep);
  if (isAbsolute(path) || segments[0] === '..') return undefined;
  return mediaOf({ media: { path: segments.join('/'), refBase: channel.assetRefBase } });
}

/**
 * conloca.json's facts. A repository, commit or branch that is unknown or fails its format is written as null with a
 * warning; a `builtWith` that cannot be formed fails the build, since the workspace editor would refuse the page.
 */
function editorPageInfo(
  input: Pick<EmitEditorPageInput, 'root' | 'repoUri' | 'siteIdOverride' | 'logger'>,
  componentManifest: { filename: string; hash: string } | undefined,
): EditorPageInfo {
  const { logger } = input;
  let repo: string | null = null;
  if (input.repoUri !== undefined && EDITOR_PAGE_INFO_FORMATS.repo.test(input.repoUri)) {
    repo = input.repoUri;
  } else {
    logger.warn(
      `no GitHub repository resolved for this build (got ${input.repoUri ?? 'none'}); the workspace editor will refuse this page until conlocaCloud({ repoUri: 'owner/repo' }) names it`,
    );
  }

  const ref = resolveBuildRef(process.env, (args) => gitOutput(args, input.root));
  const commit = ref.gitSha !== undefined && EDITOR_PAGE_INFO_FORMATS.commit.test(ref.gitSha) ? ref.gitSha : null;
  if (commit === null) {
    logger.warn(
      ref.gitSha
        ? `commit ${ref.gitSha} is not a 40-character git commit hash; conloca.json lists the commit as null`
        : 'no commit resolved for this build; conloca.json lists the commit as null',
    );
  }
  const branch = ref.branch !== undefined && isValidBranchName(ref.branch) ? ref.branch : null;
  if (branch === null) {
    logger.warn(
      ref.branch
        ? `branch ${ref.branch} is not a valid git branch name; conloca.json lists the branch as null`
        : 'no branch resolved for this build; conloca.json lists the branch as null',
    );
  }

  const version = packageVersion();
  if (version === undefined) {
    throw new Error(
      `${PACKAGE_NAME}: could not read this package's version, so conloca.json cannot name the build and the workspace editor would refuse the page`,
    );
  }
  const builtWith = `${PACKAGE_NAME}@${version}`;
  if (!EDITOR_PAGE_INFO_FORMATS.builtWith.test(builtWith)) {
    throw new Error(`${PACKAGE_NAME}: ${builtWith} is not a release version the workspace editor accepts`);
  }

  return {
    protocol: EDITOR_HOST_PROTOCOL,
    repo,
    siteId: resolveBuildSiteId({ contentRoot: process.env.CONLOCA_CONTENT_ROOT, override: input.siteIdOverride }),
    commit,
    branch,
    builtWith,
    componentManifest:
      componentManifest === undefined ? null : { path: componentManifest.filename, sha256: componentManifest.hash },
  };
}
