import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import type { TemplateConfig } from '@conloca/astro-cms';
import type { EditorDataBindings } from '@conloca/content-api';
import { compile as compileSass } from 'sass';
import { build as buildWithVite, mergeConfig, type Plugin, type UserConfig } from 'vite';
import { PACKAGE_NAME } from '../constants.js';
import { messageOf } from '../message-of.js';

/**
 * Modules the editor bundle must NEVER contain. The editor page maps them to
 * the workspace editor's own copies, so the site's components
 * execute on the editor's React instance — a second bundled React breaks
 * hooks/context. `@puckeditor/core` is the puck editor package the site's
 * config builds its component definitions against.
 *
 * KEEP IN SYNC with `EDITOR_UI_MODULE_FILES`: every specifier externalized
 * here needs a file there or the site's bundle fails bare-specifier resolution
 * in the browser. The editor page tests pin the two lists to each other.
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
 * Editor descriptors compiled into the bundle, next to the puck config and
 * the site styles. Sourced from what `conlocaCMS` resolved and published —
 * this package never grows its own option for them.
 */
export interface EditorBundleDescriptors {
  /**
   * Absolute path of the host's schemas module (conlocaCMS `schemasPath`).
   * Its `pageSchemas` / `dataSchemas` / `mdxComponents` exports are
   * re-exported by the bundle.
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
   * bundle verbatim, so the editor builds each page's data context from the
   * same routes the published page resolves with.
   */
  dataBindings?: EditorDataBindings;
}

export interface EditorPageBundleInput {
  /** Build output directory (Astro's `dir`, as a filesystem path). */
  dir: string;
  /** The Astro project root, as a filesystem path: styles resolve against it. */
  root: string;
  /** The site's Vite config, including the transforms needed by components and schemas. */
  vite: UserConfig;
  /** Entry module of the site's puck config. */
  puckConfigPath: string;
  /**
   * Stylesheets for the editing canvas, siteStyles then editorStyles, compiled
   * in this order ahead of the component modules so component rules keep the
   * final word.
   */
  styles: string[];
  /** Editor descriptors published by conlocaCMS for this build. */
  descriptors?: EditorBundleDescriptors;
  logger: { info(message: string): void; warn(message: string): void };
}

export interface EditorPageBundle {
  /** File name in `<dir>/_conloca/editor/`, `site.<first 16 hex of its sha-256>.js`. */
  site: string;
  /** `site.<first 16 hex of its sha-256>.css` in the same folder, or null when there is no CSS. */
  css: string | null;
}

/** File extensions a component imports as a file, written beside the bundle. */
const EDITOR_ASSET_EXTENSIONS: readonly string[] = [
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'avif',
];

/** The asset extensions a component imports as an image, which the site's build hands over as Astro's image object. */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif']);

/**
 * Optional exports transported from the site's schemas module to the editor.
 * A namespace copy keeps absent names optional without generating missing-export
 * diagnostics; the build plugin reports a module that declares none of them.
 */
const SCHEMA_MODULE_EXPORTS = ['pageSchemas', 'dataSchemas', 'mdxComponents'] as const;

/** The folder, relative to the build output, that holds every file of the editor page. */
const EDITOR_DIR = '_conloca/editor';

/** Where Vite writes the files the bundle and its stylesheets reference. */
const EDITOR_ASSETS_DIR = `${EDITOR_DIR}/assets`;

/** A file the bundle's JavaScript imports, written as `assets/<sha256>.<ext>` beside the bundle. */
interface EditorAsset {
  /** Full sha-256 hex of the bytes. */
  sha256: string;
  /** Lower-case extension, without the dot. */
  ext: string;
  bytes: Uint8Array;
}

interface PreRenderedAssetNames {
  names: readonly string[];
}

/** Stylesheets go beside the bundle, where the combined stylesheet is written, so their relative `url()`s stay valid. */
function editorAssetFileNames(info: PreRenderedAssetNames): string {
  return info.names.some((name) => name.endsWith('.css'))
    ? `${EDITOR_DIR}/[name][extname]`
    : `${EDITOR_ASSETS_DIR}/[name]-[hash][extname]`;
}

/**
 * Compiles the puck config, its components and the schemas module through the
 * site's Vite config into `<dir>/_conloca/editor/`: one ESM file plus, when the
 * graph or `styles` carry CSS, one stylesheet, each named by the first 16 hex
 * chars of its sha-256. Every file they reference is written under
 * `_conloca/editor/assets/` and addressed relative to them. Content-file and
 * `astro:` imports are refused.
 *
 * `styles` compile first so component rules keep the final word. Component Sass
 * keeps its warn-and-strip fallback; configured JavaScript transforms and
 * `styles` failures fail the build.
 */
export async function bundleEditorPage(input: EditorPageBundleInput): Promise<EditorPageBundle> {
  const stylesCss = await compileSiteStyles({
    root: input.root,
    vite: input.vite,
    styles: input.styles,
    dir: input.dir,
  });

  const entryPath = resolve(input.root, input.puckConfigPath);
  const descriptors = input.descriptors;
  const discovered = descriptors?.discoveredMdxComponents ?? [];
  const virtualEntry = [
    `export { default } from ${JSON.stringify(entryPath)};`,
    // Copy the namespace before selecting optional names: a direct named
    // re-export would reject schemas modules that declare only some of them.
    ...(descriptors?.schemasPath
      ? [
          `import * as __conlocaSchemas from ${JSON.stringify(resolve(descriptors.schemasPath))};`,
          'const __conlocaDescriptors = { ...__conlocaSchemas };',
          ...SCHEMA_MODULE_EXPORTS.map((name) => `export const ${name} = __conlocaDescriptors.${name};`),
        ]
      : []),
    ...(discovered.length > 0 ? [`export const discoveredMdxComponents = ${JSON.stringify(discovered)};`] : []),
    ...(descriptors?.templates ? [`export const templates = ${JSON.stringify(descriptors.templates)};`] : []),
    ...(descriptors?.dataBindings ? [`export const dataBindings = ${JSON.stringify(descriptors.dataBindings)};`] : []),
  ].join('\n');

  const jsAssets: EditorAsset[] = [];
  const entryId = '\0conloca-editor-page-entry.js';
  const bundlePlugin: Plugin = {
    name: 'conloca-editor-entry',
    resolveId(id) {
      return id === entryId ? id : null;
    },
    load(id) {
      return id === entryId ? virtualEntry : null;
    },
    async generateBundle() {
      if (!descriptors?.schemasPath) return;
      // Vite resolves symlinks (macOS's /var → /private/var), so look the module up by its resolved id.
      const schemasId = (await this.resolve(resolve(descriptors.schemasPath)))?.id;
      const exports = (schemasId && this.getModuleInfo(schemasId)?.exports) || [];
      if (!SCHEMA_MODULE_EXPORTS.some((name) => exports.includes(name))) {
        input.logger.warn(
          `${PACKAGE_NAME}: the schemas module at ${descriptors.schemasPath} exports none of ` +
            'pageSchemas, dataSchemas or mdxComponents — check the path and the export names.',
        );
      }
    },
  };
  const siteConfig = {
    ...normalizeBundlerOptions(input.vite),
    plugins: [importedFiles(jsAssets), componentStyles(input.logger), bundlePlugin, ...(input.vite.plugins ?? [])],
  };
  const config = mergeConfig(siteConfig, {
    configFile: false,
    root: input.root,
    base: './',
    logLevel: 'warn',
    oxc: { jsx: { runtime: 'automatic' } },
    build: {
      write: false,
      copyPublicDir: false,
      outDir: input.dir,
      assetsDir: EDITOR_ASSETS_DIR,
      assetsInlineLimit: 0,
      cssCodeSplit: false,
      minify: true,
      sourcemap: false,
      ssr: false,
      watch: null,
      lib: false,
      manifest: false,
      ssrManifest: false,
      rolldownOptions: {
        preserveEntrySignatures: 'strict',
        onwarn(warning: { message: string }) {
          input.logger.warn(`vite: ${warning.message}`);
        },
      },
    },
  });
  // The editor page is one browser entry, not the site's configured app or
  // library outputs. Keep all site plugins, but replace its output topology.
  config.build.rolldownOptions.input = entryId;
  config.build.rolldownOptions.external = editorExternal;
  const configuredOutput = config.build.rolldownOptions.output;
  if (Array.isArray(configuredOutput) && configuredOutput.length > 1) {
    throw new Error(`${PACKAGE_NAME}: the editor page bundle requires a single Vite output configuration.`);
  }
  const output = Array.isArray(configuredOutput) ? configuredOutput[0] : configuredOutput;
  config.build.rolldownOptions.output = {
    plugins: output?.plugins,
    format: 'es',
    codeSplitting: false,
    entryFileNames: `${EDITOR_DIR}/site.js`,
    assetFileNames: editorAssetFileNames,
  };
  const result = await buildWithVite(config);
  const files = [result].flat().flatMap((bundle) => ('output' in bundle ? bundle.output : []));
  type BuiltAsset = Extract<(typeof files)[number], { type: 'asset' }>;
  const jsFiles = files.filter((file) => file.type === 'chunk');
  const cssFiles = files.filter((file): file is BuiltAsset => file.type === 'asset' && file.fileName.endsWith('.css'));
  const assetFiles = files.filter(
    (file): file is BuiltAsset => file.type === 'asset' && !file.fileName.endsWith('.css'),
  );
  if (jsFiles.length !== 1 || cssFiles.length > 1) {
    throw new Error(
      `${PACKAGE_NAME}: expected the puck config to bundle to one ESM file (plus at most one stylesheet), ` +
        `got ${files.map((file) => file.fileName).join(', ')}.`,
    );
  }

  const outDir = join(input.dir, EDITOR_DIR);
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    ...assetFiles.map((file) => writeOutputFile(join(input.dir, file.fileName), file.source)),
    ...jsAssets.map((asset) =>
      writeOutputFile(join(input.dir, EDITOR_ASSETS_DIR, `${asset.sha256}.${asset.ext}`), asset.bytes),
    ),
  ]);

  const bytes = new TextEncoder().encode(jsFiles[0].code);
  const site = `site.${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.js`;
  await writeFile(join(outDir, site), bytes);
  input.logger.info(`editor page bundle written: ${EDITOR_DIR}/${site} (${bytes.byteLength} bytes)`);

  const cssSource = cssFiles[0]?.source;
  const componentCss = typeof cssSource === 'string' ? cssSource : new TextDecoder().decode(cssSource);
  // Styles first, so component rules keep the final word.
  const rawCss = [stylesCss, componentCss].filter(Boolean).join('\n');
  if (rawCss === '') return { site, css: null };
  const cssBytes = new TextEncoder().encode(rawCss);
  const css = `site.${createHash('sha256').update(cssBytes).digest('hex').slice(0, 16)}.css`;
  await writeFile(join(outDir, css), cssBytes);
  input.logger.info(`editor page stylesheet written: ${EDITOR_DIR}/${css} (${cssBytes.byteLength} bytes)`);
  return { site, css };
}

async function writeOutputFile(path: string, source: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source);
}

/** The virtual module for a file a component imports. */
const ASSET_MODULE_PREFIX = '\0conloca-editor-file:';

/** MDX pages and content files are user content, never bundle code. */
const CONTENT_FILE = /\.(mdx|vxjson)$/i;

/**
 * Rolldown checks unresolved imports before calling resolvers, then resolved
 * imports too. Reject content and Astro's virtual modules here so a site's pre
 * resolver or Vite alias cannot turn them into executable JavaScript first.
 */
function editorExternal(id: string, importer: string | undefined): boolean {
  if (CONTENT_FILE.test(id)) {
    throw new Error(
      `${PACKAGE_NAME}: ${id} is an MDX page or a content file, which the editor's users write; ` +
        'the editor page never runs one as code. Keep it out of the puck config graph.',
    );
  }
  if (id.startsWith('astro:')) {
    throw new Error(
      `${PACKAGE_NAME}: ${importer ?? 'the puck config'} imports ${id}, an Astro module that exists only inside ` +
        "Astro's own build. The editor page cannot load it; keep it out of the puck config graph.",
    );
  }
  return EDITOR_BUNDLE_EXTERNALS.some((specifier) => specifier === id);
}

/**
 * Turns a file a component imports into a module that addresses it beside the
 * bundle, the way Astro hands an image import over as an image object.
 * Stylesheet references stay with Vite's CSS pipeline.
 */
function importedFiles(collected: EditorAsset[]): Plugin {
  const assetFile = new RegExp(`\\.(${EDITOR_ASSET_EXTENSIONS.join('|')})$`, 'i');
  return {
    name: 'conloca-editor-files',
    enforce: 'pre',
    async resolveId(id, importer) {
      if (!assetFile.test(id) || (importer && /\.(css|scss|sass|less|styl)(?:\?|$)/.test(importer))) return null;
      const resolved = await this.resolve(id, importer, { skipSelf: true });
      if (!resolved) throw new Error(`${PACKAGE_NAME}: cannot resolve editor asset ${id}`);
      if (resolved.external) return resolved;
      return ASSET_MODULE_PREFIX + resolved.id;
    },
    async load(id) {
      return id.startsWith(ASSET_MODULE_PREFIX) ? assetModule(id.slice(ASSET_MODULE_PREFIX.length), collected) : null;
    },
  };
}

/**
 * Preserve the component-style contract: Sass compiles once, failing softly;
 * unsupported Less/Stylus imports remain empty. Give the resulting CSS to Vite
 * at the original directory so CSS modules and relative assets resolve together.
 * `styles` do not pass through this plugin.
 */
function componentStyles(logger: EditorPageBundleInput['logger']): Plugin {
  const suffix = '.conloca-editor.css';
  const moduleSuffix = '.conloca-editor.module.css';
  return {
    name: 'conloca-editor-component-styles',
    enforce: 'pre',
    async resolveId(id, importer) {
      if (!/\.(scss|sass|less|styl)$/.test(id)) return null;
      const resolved = await this.resolve(id, importer, { skipSelf: true });
      if (!resolved || resolved.external) return resolved;
      return resolved.id + (/\.module\.(scss|sass|less|styl)$/.test(id) ? moduleSuffix : suffix);
    },
    async load(id) {
      const ending = id.endsWith(moduleSuffix) ? moduleSuffix : id.endsWith(suffix) ? suffix : undefined;
      if (!ending) return null;
      const path = id.slice(0, -ending.length);
      if (/\.(less|styl)$/.test(path)) return '';
      try {
        return compileSass(path, { style: 'expanded' }).css;
      } catch (error) {
        logger.warn(`stylesheet stripped from the editor page (${path}): ${messageOf(error)}`);
        return '';
      }
    },
  };
}

/** The module a file import evaluates to: its address, resolved against the bundle's own URL. */
async function assetModule(path: string, collected: EditorAsset[]): Promise<string> {
  const bytes = new Uint8Array(await readFile(path));
  const ext = extname(path).slice(1).toLowerCase();
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (!collected.some((asset) => asset.sha256 === sha256 && asset.ext === ext)) collected.push({ sha256, ext, bytes });
  // @vite-ignore keeps Vite from resolving the name against this virtual module at build time.
  const lines = [
    `const src = new URL(/* @vite-ignore */ ${JSON.stringify(`./assets/${sha256}.${ext}`)}, import.meta.url).href;`,
  ];
  if (IMAGE_EXTENSIONS.has(ext)) {
    lines.push(`export default { src, ...${JSON.stringify(await imageFacts(bytes, path))} };`);
  } else {
    lines.push('export default src;');
  }
  return lines.join('\n');
}

/** An image's width, height and format as Astro reports them for an import; none of them when unreadable. */
async function imageFacts(
  bytes: Uint8Array,
  path: string,
): Promise<{ width?: number; height?: number; format?: string }> {
  const { imageMetadata } = await import('astro/assets/utils');
  try {
    const { width, height, format } = await imageMetadata(bytes, path);
    return { width, height, format };
  } catch {
    return {};
  }
}

/** Normalize Vite's deprecated alias before adding either editor build's options. */
function normalizeBundlerOptions(vite: UserConfig): UserConfig {
  const { rollupOptions, ...build } = vite.build ?? {};
  return { ...vite, build: { ...build, rolldownOptions: build.rolldownOptions ?? rollupOptions } };
}

/**
 * Compiles `styles` through the site's own Vite pipeline (its plugins, PostCSS
 * config and preprocessors) in a CSS-only build. The only files it writes are
 * the assets the stylesheets reference (fonts, images), under
 * `<dir>/_conloca/editor/assets/`, addressed relative to the stylesheet.
 * Returns the compiled CSS with the entries in listed order.
 *
 * A failure is rethrown naming the entries: the site's own build fails on the
 * same stylesheet, and a canvas stylesheet silently missing its site styles
 * must not ship.
 */
async function compileSiteStyles({
  root,
  vite,
  styles,
  dir,
}: {
  root: string;
  vite: UserConfig;
  styles: string[];
  dir: string;
}): Promise<string> {
  if (styles.length === 0) return '';
  const entryNames = styles.map((_, index) => `site-style-${index}`);
  let result: Awaited<ReturnType<typeof buildWithVite>>;
  try {
    result = await buildWithVite(
      mergeConfig(normalizeBundlerOptions(vite), {
        configFile: false,
        root,
        base: './',
        logLevel: 'warn',
        build: {
          write: false,
          copyPublicDir: false,
          assetsDir: EDITOR_ASSETS_DIR,
          rolldownOptions: {
            input: Object.fromEntries(styles.map((entry, index) => [entryNames[index], resolve(root, entry)])),
            output: { assetFileNames: editorAssetFileNames },
          },
        },
      }),
    );
  } catch (cause) {
    throw new Error(`${PACKAGE_NAME}: siteStyles failed to compile (${styles.join(', ')}): ${messageOf(cause)}`, {
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
      .map((asset) => writeOutputFile(join(dir, asset.fileName), asset.source)),
  );
  return entryNames
    .map((name) => assets.find((asset) => asset.names.includes(`${name}.css`))?.source)
    .map((source) => (source instanceof Uint8Array ? new TextDecoder().decode(source) : (source ?? '')))
    .filter(Boolean)
    .join('\n');
}
