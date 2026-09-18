import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { TemplateConfig } from '@conloca/astro-cms';
import type { EditorDataBindings } from '@conloca/content-api';
import { build, type Plugin } from 'esbuild';
import { build as buildWithVite, mergeConfig, type UserConfig } from 'vite';
import { PACKAGE_NAME } from './constants.js';
import { messageOf } from './message-of.js';

/**
 * Modules the editor bundle must NEVER contain. The editor (served from
 * `endpoint`) supplies them at runtime so the site's components
 * execute on the editor's own React instance — a second bundled React breaks
 * hooks/context. `@puckeditor/core` is the puck editor package the site's
 * config builds its component definitions against.
 *
 * KEEP IN SYNC with the modules the editor at the endpoint supplies: the two lists
 * are one contract, so every specifier externalized here needs an entry there
 * or the site's bundle fails bare-specifier resolution in the browser. Each side
 * pins the list in its own tests.
 */
export const EDITOR_BUNDLE_EXTERNALS = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom/client',
  '@puckeditor/core',
] as const;

/**
 * Asset references inside component stylesheets are never pulled INTO the
 * bundle — inlining would balloon the registered stylesheet and drag binary
 * assets through the hash pipeline. They are instead re-pointed at the
 * deployed site (see `rewriteStylesheetAssetUrls`), because the registered
 * stylesheet is injected as text into the editor's canvas: left as-authored, a
 * root-relative `url(/fonts/x.otf)` would resolve against the EDITOR's origin
 * and 404.
 */
const STYLESHEET_ASSET_EXTERNALS = [
  '*.woff',
  '*.woff2',
  '*.ttf',
  '*.otf',
  '*.eot',
  '*.png',
  '*.jpg',
  '*.jpeg',
  '*.gif',
  '*.svg',
  '*.webp',
  '*.avif',
] as const;

/**
 * Cloudflare Pages `_headers` rule that lets the editor load an asset
 * cross-origin. Part of the site-side contract: without it the browser
 * blocks the fetch from the editor's origin. Applied to `/_conloca/*` for the
 * bundle itself, and to the directories the stylesheet's assets live in —
 * webfonts are CORS-gated, so a 200 without this header still renders the
 * fallback face.
 */
function corsRule(path: string): string {
  return `${path}\n  Access-Control-Allow-Origin: *\n`;
}

const BUNDLE_CORS_PATH = '/_conloca/*';

/**
 * The named exports the bundle re-exports from the host's schemas module
 * (conlocaCMS `schemasPath`). One list drives the virtual entry's re-export
 * lines, the always-undefined warning absorption, and the all-absent check —
 * three places that must never disagree on a name.
 */
const SCHEMA_MODULE_EXPORTS = ['pageSchemas', 'dataSchemas', 'mdxComponents'] as const;

/** esbuild's per-name notice for a schemas-module export the module doesn't declare (absorbed below). */
const SCHEMA_EXPORT_ABSENCE = new RegExp(`^Import "(${SCHEMA_MODULE_EXPORTS.join('|')})" will always be undefined\\b`);

/**
 * Editor descriptors compiled into the bundle, next to the puck config and
 * the site styles. Sourced from what `conlocaCMS` resolved and published —
 * this package never grows its own option for them.
 */
export interface EditorBundleDescriptors {
  /**
   * Absolute path of the host's schemas module (conlocaCMS `schemasPath`).
   * Its `pageSchemas` / `dataSchemas` / `mdxComponents` exports are
   * re-exported by the bundle, so the editor at the endpoint reads them off bytes it
   * already hash-verified — no second fetch, no second trust decision.
   */
  schemasPath?: string;
  /**
   * Auto-discovered MDX descriptors (conlocaCMS `mdxComponentFolders`),
   * serialized into the bundle verbatim. Opaque here on purpose: the shape
   * is cms-spa's contract and this package only transports it.
   */
  discoveredMdxComponents?: readonly unknown[];
  /**
   * Page-creation templates (conlocaCMS `templates`), serialized into the
   * bundle verbatim. Typed by the `@conloca/astro-cms` peer, whose
   * `readEditorDescriptors` produced the value this package transports.
   */
  templates?: Record<string, TemplateConfig>;
  /**
   * The routing data bindings (conlocaCMS `routing`), serialized into the
   * bundle verbatim, so the editor at the endpoint builds each page's data context from
   * the same routes the published page resolves with.
   */
  dataBindings?: EditorDataBindings;
}

export interface BundleEditorAssetsInput {
  /** Build output directory (Astro's `dir`, as a filesystem path). */
  dir: string;
  /** The Astro project root, as a filesystem path: siteStyles resolve against it. */
  root: string;
  /** The site's own Vite config (Astro's `config.vite`), which compiles siteStyles. */
  vite: UserConfig;
  /** Entry module of the site's puck config (same option name as @conloca/astro-cms). */
  puckConfigPath: string;
  /**
   * Site CSS for accurate preview rendering (the `siteStyles` option),
   * compiled by the site's own Vite pipeline into the same registered
   * stylesheet AHEAD of the component modules, so component rules keep the
   * final word.
   */
  siteStyles?: string | string[];
  /**
   * Public origin the deployed site answers on (the `publicBaseUrl` option).
   * Root-relative asset URLs in the registered stylesheet are absolutized
   * against it, since that stylesheet is applied inside the editor's canvas
   * rather than on the site. Omitted: URLs stay as authored.
   */
  publicBaseUrl?: string;
  /**
   * Editor descriptors published by conlocaCMS for this build. Absent for a
   * CMS-less build, or when there is nothing to carry (no schemas module,
   * discoverable MDX component, page template or data binding) — in which case
   * the emitted bytes are identical to a pre-descriptor build (no gratuitous
   * hash churn).
   */
  descriptors?: EditorBundleDescriptors;
  logger: { info(message: string): void; warn(message: string): void };
}

export interface BundledStylesheet {
  /** Site-relative URL of the emitted stylesheet, e.g. `/_conloca/editor-bundle.<hash16>.css`. */
  url: string;
  /** FULL sha-256 hex of the stylesheet bytes — the editor hash-verifies against this. */
  hash: string;
  /** The emitted stylesheet bytes. */
  bytes: Uint8Array;
}

export interface BundleEditorAssetsResult {
  /** Site-relative URL of the emitted bundle, e.g. `/_conloca/editor-bundle.<hash16>.js`. */
  url: string;
  /** FULL sha-256 hex of the bundle bytes — the editor hash-verifies against this. */
  hash: string;
  /** The emitted bundle bytes. */
  bytes: Uint8Array;
  /**
   * Companion stylesheet for the editing canvas (styled canvas):
   * any siteStyles, then the config graph's compiled CSS/SCSS modules.
   * Absent when neither carries styles.
   */
  stylesheet?: BundledStylesheet;
  /**
   * `_headers` paths granted CORS for the stylesheet's own assets, so the
   * mirrored asset set (a deployment that serves the site and the preview from
   * one Cloudflare Worker) can be given the same rules.
   */
  assetCorsPaths: string[];
}

/**
 * Bundles the site's puck config into a browser ESM file plus (when the
 * graph carries styles) a companion stylesheet, both under `<dir>/_conloca/`,
 * content-addressed by the first 16 hex chars of their sha-256, and ensures
 * `<dir>/_headers` carries the CORS rule the editor needs to load them
 * cross-origin.
 *
 * The siteStyles compile first, through the site's own Vite pipeline (see
 * `compileSiteStyles`); one that fails to compile fails the build.
 *
 * Component styles compile in the SAME esbuild pass as the JS: CSS-module
 * class names are hashed consistently across both outputs, so `styles.foo` in
 * a component always matches a selector in the emitted stylesheet. SCSS
 * compiles through `sass`; a component stylesheet that fails to compile is
 * stripped with a warning instead of failing the build (one broken component
 * stylesheet must not cost the site its registration).
 */
export async function bundleEditorAssets(input: BundleEditorAssetsInput): Promise<BundleEditorAssetsResult> {
  const siteCss = await compileSiteStyles({
    root: input.root,
    vite: input.vite,
    siteStyles: typeof input.siteStyles === 'string' ? [input.siteStyles] : (input.siteStyles ?? []),
    dir: input.dir,
  });

  const entryPath = resolve(input.puckConfigPath);
  const descriptors = input.descriptors;
  const discovered = descriptors?.discoveredMdxComponents ?? [];
  const virtualEntry = [
    `export { default } from ${JSON.stringify(entryPath)};`,
    // Third bundle leg: editor descriptors ride next to the puck
    // config as named exports. The namespace import is deliberate — an
    // `export { x } from` of a name the host's schemas module doesn't
    // declare fails esbuild, so a partial module cannot fail the
    // site's build; missing names just export undefined.
    ...(descriptors?.schemasPath
      ? [
          `import * as __conlocaSchemas from ${JSON.stringify(resolve(descriptors.schemasPath))};`,
          ...SCHEMA_MODULE_EXPORTS.map((name) => `export const ${name} = __conlocaSchemas.${name};`),
        ]
      : []),
    ...(discovered.length > 0 ? [`export const discoveredMdxComponents = ${JSON.stringify(discovered)};`] : []),
    ...(descriptors?.templates ? [`export const templates = ${JSON.stringify(descriptors.templates)};`] : []),
    ...(descriptors?.dataBindings ? [`export const dataBindings = ${JSON.stringify(descriptors.dataBindings)};`] : []),
  ].join('\n');

  const result = await build({
    stdin: {
      contents: virtualEntry,
      resolveDir: dirname(entryPath),
      sourcefile: 'conloca-canvas-entry.js',
      loader: 'js',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    minify: true,
    treeShaking: true,
    write: false,
    // Never written (write: false) — gives the stdin entry's outputs real
    // .js/.css extensions so they can be told apart.
    outdir: join(input.dir, '_conloca'),
    // Automatic JSX so .tsx configs compile against react/jsx-runtime —
    // which is externalized and supplied by the editor.
    jsx: 'automatic',
    external: [...EDITOR_BUNDLE_EXTERNALS, ...STYLESHEET_ASSET_EXTERNALS],
    plugins: [sassCompiler(input.logger)],
    // No compiler is wired for these preprocessors in the component graph;
    // strip them like all stylesheets used to be stripped (`{}` module, no
    // rules) rather than failing the site's registration over one exotic
    // import. siteStyles never reach here: the site's Vite pipeline compiles them.
    loader: { '.less': 'empty', '.styl': 'empty' },
    // esbuild would print warnings straight to stderr, outside the build's
    // log stream; silence it and forward them through the Astro logger below.
    logLevel: 'silent',
  });

  // The virtual entry re-exports the three descriptor names through a
  // namespace import so a schemas module that declares only some of them
  // cannot fail the site's build — absent names export undefined by
  // design, and esbuild flags each one with an always-undefined warning on
  // every build. Absence of an OPTIONAL name is the contract working, not a
  // diagnostic; a schemas module yielding NONE of the names is one (a wrong
  // path, or misspelled exports), so exactly that case is reported once, in
  // this package's own words.
  const softContractAbsences = new Set<string>();
  for (const warning of result.warnings) {
    const absentName = warning.location?.file.endsWith('conloca-canvas-entry.js')
      ? SCHEMA_EXPORT_ABSENCE.exec(warning.text)?.[1]
      : undefined;
    if (absentName) {
      softContractAbsences.add(absentName);
      continue;
    }
    const location = warning.location;
    input.logger.warn(
      `esbuild: ${warning.text}${location ? ` (${location.file}:${location.line}:${location.column})` : ''}`,
    );
  }
  if (softContractAbsences.size === SCHEMA_MODULE_EXPORTS.length && descriptors?.schemasPath) {
    input.logger.warn(
      `${PACKAGE_NAME}: the schemas module at ${descriptors.schemasPath} exports none of ` +
        'pageSchemas, dataSchemas or mdxComponents — check the path and the export names.',
    );
  }

  const jsFiles = result.outputFiles.filter((file) => file.path.endsWith('.js'));
  const cssFiles = result.outputFiles.filter((file) => file.path.endsWith('.css'));
  if (jsFiles.length !== 1 || cssFiles.length > 1 || jsFiles.length + cssFiles.length !== result.outputFiles.length) {
    throw new Error(
      `${PACKAGE_NAME}: expected the puck config to bundle to one ESM file (plus at most one stylesheet), ` +
        `got ${result.outputFiles.map((file) => file.path).join(', ')}. A non-JS import that esbuild emits ` +
        'as its own asset (e.g. an image or font) is not supported in the editor bundle ' +
        '— keep it out of the puck config graph.',
    );
  }

  const outDir = join(input.dir, '_conloca');
  await mkdir(outDir, { recursive: true });

  const bytes = jsFiles[0].contents;
  const hash = createHash('sha256').update(bytes).digest('hex');
  const filename = `editor-bundle.${hash.slice(0, 16)}.js`;
  await writeFile(join(outDir, filename), bytes);

  let stylesheet: BundledStylesheet | undefined;
  let assetCorsPaths: string[] = [];
  const componentCss = cssFiles[0] ? new TextDecoder().decode(cssFiles[0].contents) : '';
  // Site styles first, so component rules keep the final word. esbuild emits
  // an empty CSS file when every component stylesheet was stripped, and an
  // empty registered stylesheet would only add a wasted fetch.
  const rawCss = [siteCss, componentCss].filter(Boolean).join('\n');
  if (rawCss !== '') {
    // Asset URLs are rewritten BEFORE hashing: the editor hash-verifies the
    // stylesheet it fetches, so the rewrite has to be part of the bytes that
    // get hashed, written, and registered.
    let css = rawCss;
    if (input.publicBaseUrl) {
      const rewritten = rewriteStylesheetAssetUrls(rawCss, input.publicBaseUrl, input.logger);
      css = rewritten.css;
      assetCorsPaths = rewritten.assetCorsPaths;
    }
    const cssBytes = new TextEncoder().encode(css);
    const cssHash = createHash('sha256').update(cssBytes).digest('hex');
    const cssFilename = `editor-bundle.${cssHash.slice(0, 16)}.css`;
    await writeFile(join(outDir, cssFilename), cssBytes);
    stylesheet = { url: `/_conloca/${cssFilename}`, hash: cssHash, bytes: cssBytes };
    input.logger.info(`editor stylesheet written: ${stylesheet.url} (${cssBytes.byteLength} bytes)`);
  }

  await ensureCorsHeaders(input.dir, assetCorsPaths);

  const url = `/_conloca/${filename}`;
  input.logger.info(`editor bundle written: ${url} (${bytes.byteLength} bytes)`);
  return { url, hash, bytes, stylesheet, assetCorsPaths };
}

/**
 * Compiles the siteStyles through the site's own Vite pipeline (its plugins,
 * PostCSS config and preprocessors), the way conlocaCMS's dev editor compiles
 * the same option, in a CSS-only build. The only files it writes are the
 * assets the stylesheets reference (fonts, images), under `<dir>/_conloca/`.
 * Returns the compiled CSS with the entries in listed order.
 *
 * A failure is rethrown naming the entries: the site's own build fails on the
 * same stylesheet, and a canvas stylesheet silently missing its site styles
 * must not register.
 */
async function compileSiteStyles({
  root,
  vite,
  siteStyles,
  dir,
}: {
  root: string;
  vite: UserConfig;
  siteStyles: string[];
  dir: string;
}): Promise<string> {
  if (siteStyles.length === 0) return '';
  const entryNames = siteStyles.map((_, index) => `site-style-${index}`);
  let result: Awaited<ReturnType<typeof buildWithVite>>;
  try {
    result = await buildWithVite(
      mergeConfig(vite, {
        configFile: false,
        root,
        // The assets are written under `dir`, which the site serves at its
        // origin root, so the URLs pointing at them must start there too.
        base: '/',
        logLevel: 'warn',
        build: {
          write: false,
          copyPublicDir: false,
          assetsDir: '_conloca',
          rolldownOptions: {
            input: Object.fromEntries(siteStyles.map((entry, index) => [entryNames[index], resolve(root, entry)])),
          },
        },
      }),
    );
  } catch (cause) {
    throw new Error(`${PACKAGE_NAME}: siteStyles failed to compile (${siteStyles.join(', ')}): ${messageOf(cause)}`, {
      cause,
    });
  }

  const assets = [result]
    .flat()
    .flatMap((bundle) => ('output' in bundle ? bundle.output : []))
    .filter((file) => file.type === 'asset');
  await Promise.all(
    assets
      .filter((asset) => !asset.fileName.endsWith('.css'))
      .map(async (asset) => {
        const target = join(dir, asset.fileName);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, asset.source);
      }),
  );
  return entryNames
    .map((name) => assets.find((asset) => asset.names.includes(`${name}.css`))?.source)
    .map((source) => (source instanceof Uint8Array ? new TextDecoder().decode(source) : (source ?? '')))
    .filter(Boolean)
    .join('\n');
}

/** Matches one `url(…)` token, with or without quotes (esbuild's minifier
 * drops the quotes, but an unminified or quote-requiring value keeps them). */
const CSS_URL_TOKEN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

/**
 * Re-points the registered stylesheet's asset references at the deployed site.
 *
 * Only ROOT-relative URLs (`/fonts/x.otf`) are rewritten — those name a path
 * on the site and nothing else. That includes the `/_conloca/` assets the
 * siteStyles build emitted, since Vite resolves their relative references.
 * Path-relative ones (`./x.otf`, `../x.otf`, `x.otf`) cannot be resolved here
 * and are reported instead of guessed: esbuild flattens every component
 * stylesheet into ONE output and copies url() paths through verbatim, so by
 * this point the emitted text no longer records WHICH source directory each
 * one was relative to. Absolute, protocol-relative, `data:` and fragment
 * (`#filter`) refs already resolve correctly and are left alone.
 *
 * Returns the rewritten CSS plus the `_headers` globs its assets need — one
 * per distinct directory rather than one per file, which keeps a font family
 * of forty weights to a single rule.
 */
export function rewriteStylesheetAssetUrls(
  css: string,
  publicBaseUrl: string,
  logger: BundleEditorAssetsInput['logger'],
): { css: string; assetCorsPaths: string[] } {
  const base = publicBaseUrl.replace(/\/+$/, '');
  const dirs = new Set<string>();
  const unresolved = new Set<string>();

  const rewritten = css.replace(CSS_URL_TOKEN, (token, _quote: string, ref: string) => {
    const value = ref.trim();
    if (value.startsWith('//') || value.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(value)) return token;
    if (!value.startsWith('/')) {
      unresolved.add(value);
      return token;
    }
    const dir = value.slice(0, value.lastIndexOf('/'));
    dirs.add(`${dir === '' ? '' : dir}/*`);
    return `url(${base}${value})`;
  });

  if (unresolved.size > 0) {
    logger.warn(
      'path-relative asset URLs in the registered stylesheet cannot be pointed at the deployed ' +
        `site and will not load in the editing canvas — make them root-relative: ${[...unresolved].join(', ')}`,
    );
  }

  return { css: rewritten, assetCorsPaths: [...dirs] };
}

/**
 * Compiles the component graph's `.scss`/`.sass` imports with `sass`, mapping
 * `*.module.*` files to esbuild's local-css semantics (hashed class names
 * exported to the JS side). A file that fails to compile degrades to the
 * pre-styled-canvas behavior — `{}` for a module (classNames become
 * undefined), no rules for a global — with a warning naming the file and the
 * compiler's reason. siteStyles never reach it: the site's Vite pipeline
 * compiles them, and a failure there fails the build.
 */
function sassCompiler(logger: BundleEditorAssetsInput['logger']): Plugin {
  return {
    name: 'conloca-sass',
    setup(build) {
      build.onLoad({ filter: /\.(scss|sass)$/ }, async (args) => {
        const isModule = /\.module\.(scss|sass)$/.test(args.path);
        try {
          const sass = await import('sass');
          const compiled = sass.compile(args.path, { style: 'expanded' });
          return { contents: compiled.css, loader: isModule ? 'local-css' : 'css' };
        } catch (error) {
          logger.warn(
            `stylesheet stripped from the editor bundle (${args.path}): ` +
              (error instanceof Error ? error.message : String(error)),
          );
          return isModule ? { contents: '', loader: 'empty' } : { contents: '', loader: 'css' };
        }
      });
    },
  };
}

/**
 * Writes the discovery route's collected CSS as a content-addressed artifact
 * next to the editor bundle: `_conloca/route-css.<hash16>.css`.
 * Same serving story as the editor stylesheet — the `/_conloca/*` CORS rule
 * already covers it, and `mirrorEditorAssets` copies the whole dir.
 */
export async function emitRouteCssArtifact(
  dir: string,
  css: string,
  publicBaseUrl: string | undefined,
  logger: BundleEditorAssetsInput['logger'],
): Promise<{ stylesheet: BundledStylesheet; assetCorsPaths: string[] } | undefined> {
  if (css.trim() === '') return undefined;
  // The discovered CSS is the site's FULL page CSS, so it carries the
  // site's asset URLs (fonts especially) as authored — root-relative. Applied
  // in the editor those resolve against the EDITOR's origin and 404, the same
  // failure the editor stylesheet had; same fix, same helper, and the same
  // CORS grant for the directories they live in.
  let assetCorsPaths: string[] = [];
  let text = css;
  if (publicBaseUrl) {
    const rewritten = rewriteStylesheetAssetUrls(css, publicBaseUrl, logger);
    text = rewritten.css;
    assetCorsPaths = rewritten.assetCorsPaths;
  }
  const bytes = new TextEncoder().encode(text);
  const outDir = join(dir, '_conloca');
  await mkdir(outDir, { recursive: true });
  const hash = createHash('sha256').update(bytes).digest('hex');
  const filename = `route-css.${hash.slice(0, 16)}.css`;
  await writeFile(join(outDir, filename), bytes);
  await ensureCorsHeaders(dir, assetCorsPaths);
  logger.info(`discovered route CSS written: /_conloca/${filename} (${bytes.byteLength} bytes)`);
  return { stylesheet: { url: `/_conloca/${filename}`, hash, bytes }, assetCorsPaths };
}

/**
 * Mirrors the emitted editor assets (`_conloca/` + the CORS rule) from the
 * primary build's output into another asset directory — the recursive preview
 * build's client dir. The bundle is only ever compiled into the PRIMARY
 * build's dist (the child build short-circuits `astro:build:done` to avoid
 * registration recursion), but in a deployment that serves the site and the
 * preview from one Cloudflare Worker, the child's client dir is the asset set
 * that actually serves the site, so without this mirror the editor at the
 * endpoint cannot load its component bundle.
 */
export async function mirrorEditorAssets(fromDir: string, toDir: string, assetCorsPaths: string[] = []): Promise<void> {
  await cp(join(fromDir, '_conloca'), join(toDir, '_conloca'), { recursive: true });
  await ensureCorsHeaders(toDir, assetCorsPaths);
}

/**
 * Adds the bundle's CORS rule — plus one per stylesheet asset directory — to
 * `<dir>/_headers`, appending to an existing file without clobbering other
 * rules and without duplicating any of ours. Each rule is checked
 * individually, so a dist that already carries `/_conloca/*` from an earlier
 * build still picks up newly referenced asset directories.
 */
async function ensureCorsHeaders(dir: string, assetCorsPaths: string[] = []): Promise<void> {
  const headersPath = join(dir, '_headers');
  let existing = '';
  try {
    existing = await readFile(headersPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  let updated = existing;
  for (const path of [BUNDLE_CORS_PATH, ...assetCorsPaths]) {
    if (updated.includes(`${path}\n`)) continue;
    const separator = updated === '' || updated.endsWith('\n') ? '' : '\n';
    updated = `${updated}${separator}${corsRule(path)}`;
  }
  if (updated === existing) return;
  await writeFile(headersPath, updated);
}
