import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin } from 'vite';
import {
  bundleEditorPage,
  EDITOR_BUNDLE_EXTERNALS,
  type EditorBundleDescriptors,
  type EditorPageBundle,
  type EditorPageBundleInput,
} from '../editor-page/bundle.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A miniature site puck config: a React component (hooks + JSX) plus a
 * runtime import from the puck editor package. Both `react` and
 * `@puckeditor/core` MUST stay external — the editor supplies them at
 * runtime so the site's components execute on the editor's own React
 * instance.
 */
const FIXTURE_ENTRY = [
  "import { DropZone } from '@puckeditor/core';",
  "import { useState } from 'react';",
  '',
  'function Counter() {',
  '  const [count] = useState(0);',
  '  return (',
  '    <div>',
  '      {count}',
  '      <DropZone zone="content" />',
  '    </div>',
  '  );',
  '}',
  '',
  'export default {',
  '  components: {',
  '    Counter: { render: () => <Counter /> },',
  '  },',
  '};',
  '',
].join('\n');

/** A valid 1×1 PNG. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** Matches one `url(…)` token, with or without quotes. */
const CSS_URL_TOKEN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

let projectDir: string;
let distDir: string;
let editorDir: string;
let entryPath: string;

/** The logger the bundle writes to, keeping its warnings for assertions. */
type TestLogger = EditorPageBundleInput['logger'] & { warnings: string[] };

function makeLogger(): TestLogger {
  const warnings: string[] = [];
  return {
    info: () => {},
    warn: (message: string) => {
      warnings.push(message);
    },
    warnings,
  };
}

interface BundleRun {
  result: EditorPageBundle;
  js: string;
  css: string;
  logger: TestLogger;
}

async function runBundle(overrides: Partial<EditorPageBundleInput> = {}): Promise<BundleRun> {
  const logger = makeLogger();
  const result = await bundleEditorPage({
    dir: distDir,
    root: projectDir,
    vite: {},
    puckConfigPath: entryPath,
    styles: [],
    logger,
    ...overrides,
  });
  const js = await readFile(join(editorDir, result.site), 'utf8');
  const css = result.css === null ? '' : await readFile(join(editorDir, result.css), 'utf8');
  return { result, js, css, logger };
}

function sha256Of(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The `url()` references a stylesheet makes, as written. */
function referencesOf(css: string): string[] {
  return [...css.matchAll(CSS_URL_TOKEN)].map((match) => match[2].trim());
}

/** True when a relative reference names a file that exists beside the stylesheet. */
function resolvesBesideStylesheet(reference: string): boolean {
  return existsSync(new URL(reference, pathToFileURL(join(editorDir, 'site.css'))));
}

beforeEach(async () => {
  // Real path: Vite resolves symlinks (macOS's /var), and the transform tests compare module ids.
  projectDir = await realpath(await mkdtemp(join(tmpdir(), 'editor-page-bundle-')));
  distDir = join(projectDir, 'dist');
  editorDir = join(distDir, '_conloca', 'editor');
  await mkdir(distDir, { recursive: true });
  entryPath = join(projectDir, 'puck.config.tsx');
  await writeFile(entryPath, FIXTURE_ENTRY);
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Output file + hash contract
// ---------------------------------------------------------------------------

describe('bundleEditorPage — output file', () => {
  it('writes the bundle under _conloca/editor as site.<16 hex of its sha-256>.js', async () => {
    const { result, js } = await runBundle();
    expect(result.site).toMatch(/^site\.[0-9a-f]{16}\.js$/);
    expect(result.site).toBe(`site.${sha256Of(js).slice(0, 16)}.js`);
  });

  it('emits minified output', async () => {
    const { js } = await runBundle();
    expect(js).not.toContain('\n  ');
  });

  it('reports no stylesheet for a config with no styles', async () => {
    const { result } = await runBundle();
    expect(result.css).toBeNull();
  });

  it('writes only under _conloca/editor', async () => {
    await writeFile(join(projectDir, 'hero.png'), PNG_1X1);
    await writeFile(join(projectDir, 'a.css'), '.a { color: red; }\n');
    await writeFile(
      entryPath,
      "import './a.css';\nimport hero from './hero.png';\nexport default { components: {}, hero };\n",
    );

    await runBundle({ styles: ['./a.css'] });

    expect(await readdir(distDir)).toEqual(['_conloca']);
    expect(await readdir(join(distDir, '_conloca'))).toEqual(['editor']);
    expect(existsSync(join(distDir, '_headers'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Externals — the contract with the editor: no second React
// ---------------------------------------------------------------------------

describe('bundleEditorPage — externals', () => {
  it('keeps react external (imported, not bundled)', async () => {
    const { js } = await runBundle();
    expect(js.includes('from"react"') || js.includes('from "react"')).toBe(true);
    // A bundled React copy would carry hook implementations the fixture
    // never references; their absence is the no-second-React tripwire.
    expect(js).not.toContain('useReducer');
  });

  it('keeps the puck editor package external', async () => {
    const { js } = await runBundle();
    expect(js.includes('from"@puckeditor/core"') || js.includes('from "@puckeditor/core"')).toBe(true);
  });

  it('refuses an astro: virtual module naming its importer', async () => {
    const hero = join(projectDir, 'Hero.tsx');
    await writeFile(
      hero,
      "import { getCollection } from 'astro:content';\nexport const Hero = () => <div>{String(getCollection)}</div>;\n",
    );
    await writeFile(entryPath, "import { Hero } from './Hero.tsx';\nexport default { components: { Hero } };\n");

    await Promise.resolve(expect(runBundle()).rejects.toThrow(/Hero\.tsx imports astro:content/));
  });

  it('pins the externals contract shared with the editor', () => {
    // Mirrored literal of the modules the editor supplies — its tests pin
    // the same list. If either side changes, this test forces a conscious
    // update of the other.
    expect(new Set<string>(EDITOR_BUNDLE_EXTERNALS)).toEqual(
      new Set([
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-dom/client',
        '@puckeditor/core',
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// Component stylesheets — compiled into the stylesheet beside the bundle
// ---------------------------------------------------------------------------

describe('bundleEditorPage — component stylesheet compilation', () => {
  const CSS_MODULE_ENTRY = [
    "import styles from './hero.module.scss';",
    '',
    'function Hero() {',
    '  return <div className={styles.root}>hero</div>;',
    '}',
    '',
    'export default { components: { Hero: { render: () => <Hero /> } } };',
    '',
  ].join('\n');

  beforeEach(async () => {
    await writeFile(entryPath, CSS_MODULE_ENTRY);
    await writeFile(join(projectDir, 'hero.module.scss'), '$c: red;\n.root { color: $c; }\n');
  });

  it('writes site.<16 hex of its sha-256>.css carrying the compiled SCSS-module rules', async () => {
    const { result, css } = await runBundle();
    expect(result.css).toBe(`site.${sha256Of(css).slice(0, 16)}.css`);
    expect(css).toContain('color:red');
  });

  it('keeps the JS class names and the stylesheet selectors in sync (same-pass CSS modules)', async () => {
    const { js, css } = await runBundle();
    const match = css.match(/\.([A-Za-z0-9_-]+)\{color:red\}/) ?? css.match(/\.([A-Za-z0-9_-]+)\s*\{[^}]*color:red/);
    expect(match).not.toBeNull();
    expect(js).toContain(match?.[1] ?? '<<no-class>>');
  });

  it('keeps a reference to a missing file as written, as the site build does', async () => {
    await writeFile(join(projectDir, 'hero.module.scss'), ".root { background: url('./bg.png'); color: red; }\n");
    const { css } = await runBundle();
    expect(referencesOf(css)).toEqual(['./bg.png']);
  });

  it('strips a stylesheet that fails to compile and keeps the bundle alive (fail-soft, warn)', async () => {
    await writeFile(join(projectDir, 'hero.module.scss'), '.root { color: $undefined-variable; }\n');
    const { result, logger } = await runBundle();
    expect(result.site).toMatch(/\.js$/);
    expect(logger.warnings.join('\n')).toContain('hero.module.scss');
  });
});

// ---------------------------------------------------------------------------
// Site and editor styles — compiled by the site's own Vite pipeline,
// ahead of the component modules
// ---------------------------------------------------------------------------

describe('bundleEditorPage — siteStyles', () => {
  beforeEach(async () => {
    await writeFile(join(projectDir, 'global.scss'), 'body { font-family: Site Sans; }\n');
    await writeFile(join(projectDir, 'plain.css'), 'h1 { letter-spacing: 1px; }\n');
    // Vite loads `sass` from the site, so the fixture site has it installed,
    // the way a real SCSS site does.
    await mkdir(join(projectDir, 'node_modules'), { recursive: true });
    await symlink(
      dirname(createRequire(import.meta.url).resolve('sass/package.json')),
      join(projectDir, 'node_modules', 'sass'),
    );
  });

  it('resolves styles against the Astro root even when the puck config lives in a subdirectory', async () => {
    await mkdir(join(projectDir, 'src', 'styles'), { recursive: true });
    await writeFile(join(projectDir, 'src', 'puck.config.tsx'), FIXTURE_ENTRY);
    await writeFile(join(projectDir, 'src', 'styles', 'global.scss'), 'body { color: teal; }\n');

    const { css } = await runBundle({
      styles: ['./src/styles/global.scss'],
      puckConfigPath: join(projectDir, 'src', 'puck.config.tsx'),
    });

    expect(css).toContain('color:teal');
  });

  it('compiles the listed global entries as plain (non-module) CSS, in listed order', async () => {
    const { css } = await runBundle({ styles: ['./global.scss', './plain.css'] });

    expect(css).toContain('font-family:Site Sans');
    expect(css).toContain('letter-spacing:1px');
    expect(css.indexOf('font-family')).toBeLessThan(css.indexOf('letter-spacing'));
  });

  it('puts editorStyles after siteStyles', async () => {
    await writeFile(join(projectDir, 'a.css'), '.a { outline-width: 1px; }\n');
    await writeFile(join(projectDir, 'b.css'), '.b { outline-width: 2px; }\n');

    const { css } = await runBundle({ styles: ['./a.css', './b.css'] });

    expect(css.indexOf('.a{')).toBeGreaterThanOrEqual(0);
    expect(css.indexOf('.a{')).toBeLessThan(css.indexOf('.b{'));
  });

  it('puts the site styles ahead of the component stylesheets, so component rules keep the final word', async () => {
    await writeFile(entryPath, `import './widget.css';\n${FIXTURE_ENTRY}`);
    await writeFile(join(projectDir, 'widget.css'), '.widget { outline-offset: 3px; }\n');

    const { css } = await runBundle({ styles: ['./plain.css'] });

    expect(css).toContain('letter-spacing');
    expect(css.indexOf('letter-spacing')).toBeLessThan(css.indexOf('outline-offset'));
  });

  it('a style entry that fails to compile stops the build and names it', async () => {
    const broken = join(projectDir, 'broken.scss');
    await writeFile(broken, '.root { color: $undefined-variable; }\n');

    await Promise.resolve(
      expect(runBundle({ styles: [broken] })).rejects.toThrow(
        new RegExp(`${broken.replaceAll('.', '\\.')}[\\s\\S]*Undefined variable`),
      ),
    );
  });

  it('resolves every relative url() in the stylesheet to a file beside it', async () => {
    await mkdir(join(projectDir, 'fonts'), { recursive: true });
    // Larger than Vite's inline limit, so the site styles reference a file.
    await writeFile(join(projectDir, 'fonts', 'b.woff2'), 'b'.repeat(8192));
    await writeFile(join(projectDir, 'fonts', 'display.woff2'), 'display font');
    await writeFile(join(projectDir, 'site.css'), '@font-face { font-family: B; src: url(./fonts/b.woff2); }\n');
    await writeFile(
      join(projectDir, 'hero.module.css'),
      '@font-face { font-family: Display; src: url(./fonts/display.woff2); }\n.root { font-family: Display; }\n',
    );
    await writeFile(
      entryPath,
      "import styles from './hero.module.css';\nexport default { components: {}, root: styles.root };\n",
    );

    const { css } = await runBundle({ styles: ['./site.css'] });
    const relative = referencesOf(css).filter((reference) => !/^(\/|[a-z][a-z0-9+.-]*:)/i.test(reference));

    expect(relative).toHaveLength(2);
    for (const reference of relative) expect(resolvesBesideStylesheet(reference)).toBe(true);
    const contents = await Promise.all(
      relative.map((reference) => readFile(new URL(reference, pathToFileURL(join(editorDir, 'site.css'))), 'utf8')),
    );
    expect(contents).toContain('display font');
    expect(contents).toContain('b'.repeat(8192));
  });

  it('leaves root-relative stylesheet references as written', async () => {
    await writeFile(join(projectDir, 'band.css'), '.band { background: url(/images/band.svg); }\n');
    await writeFile(join(projectDir, 'a.css'), '.bg { background: url(/bg.png); }\n');
    await writeFile(entryPath, `import './a.css';\n${FIXTURE_ENTRY}`);

    const { css } = await runBundle({ styles: ['./band.css'] });

    expect(referencesOf(css)).toEqual(['/images/band.svg', '/bg.png']);
  });
});

// ---------------------------------------------------------------------------
// Editor descriptors — exported next to the puck config
// ---------------------------------------------------------------------------

describe('bundleEditorPage — editor descriptors', () => {
  // A dependency-free fixture pair: no react/puck imports, so the emitted
  // bundle has NO external imports and can be imported back here to read its
  // real exports instead of pattern-matching minified text.
  const PLAIN_CONFIG = 'export default { components: { Hero: {} } };\n';
  const SCHEMAS = [
    "export const pageSchemas = { 'type:mdx': { label: 'MDX page' } };",
    "export const dataSchemas = { faq: { label: 'FAQ' } };",
    "export const mdxComponents = [{ name: 'Aside', kind: 'flow' }];",
    '',
  ].join('\n');

  let plainEntry: string;
  let schemasPath: string;

  beforeEach(async () => {
    plainEntry = join(projectDir, 'plain.config.tsx');
    schemasPath = join(projectDir, 'schemas.ts');
    await writeFile(plainEntry, PLAIN_CONFIG);
    await writeFile(schemasPath, SCHEMAS);
  });

  async function bundleWithDescriptors(descriptors?: EditorBundleDescriptors, plugins?: Plugin[]) {
    const { result, logger } = await runBundle({
      vite: { plugins },
      puckConfigPath: plainEntry,
      ...(descriptors ? { descriptors } : {}),
    });
    const bundleModule: {
      default?: unknown;
      pageSchemas?: unknown;
      dataSchemas?: unknown;
      mdxComponents?: unknown;
      discoveredMdxComponents?: unknown;
      templates?: unknown;
      dataBindings?: unknown;
    } = await import(pathToFileURL(join(editorDir, result.site)).href);
    return { bundleModule, logger };
  }

  it('exports the host schemas module alongside the puck config', async () => {
    const { bundleModule } = await bundleWithDescriptors({ schemasPath });

    expect(bundleModule.default).toEqual({ components: { Hero: {} } });
    expect(bundleModule.pageSchemas).toEqual({ 'type:mdx': { label: 'MDX page' } });
    expect(bundleModule.dataSchemas).toEqual({ faq: { label: 'FAQ' } });
    expect(bundleModule.mdxComponents).toEqual([{ name: 'Aside', kind: 'flow' }]);
  });

  it('exports the build-time discovered descriptors verbatim', async () => {
    const discovered = [{ name: 'Card', kind: 'flow', import: { from: '/src/components/mdx/Card.tsx' } }];

    const { bundleModule } = await bundleWithDescriptors({ discoveredMdxComponents: discovered });

    expect(bundleModule.discoveredMdxComponents).toEqual(discovered);
  });

  it('exports the page templates verbatim, without needing a schemas module', async () => {
    const templates = { blog: { label: 'Blog Post', component: 'BlogPostTemplate', pathPrefix: '/blog/' } };

    const { bundleModule } = await bundleWithDescriptors({ templates });

    expect(bundleModule.templates).toEqual(templates);
    expect(bundleModule.pageSchemas).toBeUndefined();
  });

  it('exports the data bindings the editor builds its data context from', async () => {
    const dataBindings = {
      siteName: 'default',
      locale: 'en',
      routes: { pages: { pages: { prefix: '/blog/', sort: 'date-desc' as const, limit: 2 } } },
    };

    const { bundleModule } = await bundleWithDescriptors({ dataBindings });

    expect(bundleModule.dataBindings).toEqual(dataBindings);
  });

  it('runs the site build-only Vite transforms over the schemas module', async () => {
    await writeFile(schemasPath, 'export const pageSchemas = __TRANSFORM_ME__;\n');
    const transform: Plugin = {
      name: 'test-transform',
      apply: 'build',
      transform(source, id) {
        if (id !== schemasPath) return null;
        return source.replace('__TRANSFORM_ME__', "{ '/blog/': { label: 'Blog' } }");
      },
    };

    const { bundleModule } = await bundleWithDescriptors({ schemasPath }, [transform]);

    expect(bundleModule.pageSchemas).toEqual({ '/blog/': { label: 'Blog' } });
  });

  it('fails the editor build when the site schema transform fails', async () => {
    const transform: Plugin = {
      name: 'failing-schema-transform',
      apply: 'build',
      transform(_source, id) {
        if (id === schemasPath) throw new Error('Schema compiler rejected the author type');
      },
    };

    await Promise.resolve(
      expect(bundleWithDescriptors({ schemasPath }, [transform])).rejects.toThrow(
        'Schema compiler rejected the author type',
      ),
    );
  });

  it('tolerates a schemas module that declares only one of the exports, without warning', async () => {
    await writeFile(schemasPath, "export const pageSchemas = { 'type:mdx': { label: 'Only schemas' } };\n");

    const { bundleModule, logger } = await bundleWithDescriptors({ schemasPath });

    expect(bundleModule.pageSchemas).toEqual({ 'type:mdx': { label: 'Only schemas' } });
    expect(bundleModule.mdxComponents).toBeUndefined();
    expect(bundleModule.dataSchemas).toBeUndefined();
    expect(logger.warnings.join('\n')).not.toContain('dataSchemas');
  });

  it('warns once when the schemas module exports none of the expected names', async () => {
    await writeFile(schemasPath, "export const somethingElse = 'not a descriptor export';\n");

    const { bundleModule, logger } = await bundleWithDescriptors({ schemasPath });

    expect(bundleModule.pageSchemas).toBeUndefined();
    const log = logger.warnings.join('\n');
    expect(log).toContain('exports none of');
    expect(log).toContain(schemasPath);
  });

  it('emits no descriptor exports when the CMS published none', async () => {
    const { bundleModule } = await bundleWithDescriptors();

    expect(bundleModule.pageSchemas).toBeUndefined();
    expect(bundleModule.dataSchemas).toBeUndefined();
    expect(bundleModule.mdxComponents).toBeUndefined();
    expect(bundleModule.discoveredMdxComponents).toBeUndefined();
    expect(bundleModule.dataBindings).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Imported files — written beside the bundle, addressed relative to it
// ---------------------------------------------------------------------------

/** An image import as the bundle evaluates it: Astro's image object. */
interface EvaluatedImage {
  src: string;
  width?: number;
  height?: number;
  format?: string;
}

/** The exports of the fixture puck configs these tests read. */
interface EvaluatedConfig {
  hero?: EvaluatedImage;
  broken?: EvaluatedImage;
  font?: string;
}

/** Imports the written bundle and returns its puck config. */
async function evaluate(result: EditorPageBundle): Promise<EvaluatedConfig> {
  const bundleModule: { default: EvaluatedConfig } = await import(pathToFileURL(join(editorDir, result.site)).href);
  return bundleModule.default;
}

/** Writes an MDX page and a content file, and a puck config that imports `page`. */
async function importContent(page: string): Promise<void> {
  await mkdir(join(projectDir, 'content', 'pages'), { recursive: true });
  await Promise.all([
    writeFile(join(projectDir, 'content', 'pages', 'home.mdx'), '# Home\n'),
    writeFile(join(projectDir, 'content', 'pages', 'home.en.vxjson'), '{}\n'),
    writeFile(entryPath, `import page from '${page}';\nexport default { components: {}, page };\n`),
  ]);
}

describe('bundleEditorPage — imported files', () => {
  it('turns an imported PNG into { src, width, height, format } with src beside the bundle', async () => {
    await writeFile(join(projectDir, 'hero.png'), PNG_1X1);
    await writeFile(entryPath, "import hero from './hero.png';\nexport default { components: {}, hero };\n");
    const sha = sha256Of(PNG_1X1);

    const { result, js } = await runBundle();

    // The minifier picks the quote character.
    expect(js).toMatch(new RegExp(`new URL\\([\`"']\\./assets/${sha}\\.png[\`"'],import\\.meta\\.url\\)`));
    expect(js).toContain('width:1');
    expect(js).toMatch(/format:[`"']png[`"']/);
    expect(js).not.toMatch(/["']\.\/hero\.png["']/);
    expect(await readFile(join(editorDir, 'assets', `${sha}.png`))).toEqual(PNG_1X1);
    expect((await evaluate(result)).hero).toEqual({
      src: pathToFileURL(join(editorDir, 'assets', `${sha}.png`)).href,
      width: 1,
      height: 1,
      format: 'png',
    });
  });

  it('leaves out the size and format of an image it cannot read', async () => {
    await writeFile(join(projectDir, 'broken.png'), 'not an image');
    await writeFile(entryPath, "import broken from './broken.png';\nexport default { components: {}, broken };\n");

    const config = await evaluate((await runBundle()).result);

    expect(config.broken).toEqual({
      src: pathToFileURL(join(editorDir, 'assets', `${sha256Of('not an image')}.png`)).href,
    });
  });

  it('hands a non-image asset import over as its address', async () => {
    await writeFile(join(projectDir, 'a.woff2'), 'font bytes');
    await writeFile(entryPath, "import font from './a.woff2';\nexport default { components: {}, font };\n");
    const name = `${sha256Of('font bytes')}.woff2`;

    const config = await evaluate((await runBundle()).result);

    expect(config.font).toBe(pathToFileURL(join(editorDir, 'assets', name)).href);
    expect(await readFile(join(editorDir, 'assets', name), 'utf8')).toBe('font bytes');
  });

  it('writes a file imported twice once, and the same bytes under another extension once more', async () => {
    await Promise.all(
      ['hero.png', 'copy.png', 'photo.jpg', 'photo.jpeg'].map((name) =>
        writeFile(join(projectDir, name), name.endsWith('.png') ? PNG_1X1 : 'jpeg bytes'),
      ),
    );
    await writeFile(
      entryPath,
      [
        "import hero from './hero.png';",
        "import copy from './copy.png';",
        "import jpg from './photo.jpg';",
        "import jpeg from './photo.jpeg';",
        'export default { components: {}, images: [hero, copy, jpg, jpeg] };',
        '',
      ].join('\n'),
    );

    await runBundle();

    expect(new Set(await readdir(join(editorDir, 'assets')))).toEqual(
      new Set([`${sha256Of(PNG_1X1)}.png`, `${sha256Of('jpeg bytes')}.jpeg`, `${sha256Of('jpeg bytes')}.jpg`]),
    );
  });

  it('treats upper-case asset extensions like lower-case ones', async () => {
    await writeFile(join(projectDir, 'B.PNG'), PNG_1X1);
    await writeFile(join(projectDir, 'A.PNG'), 'stylesheet image');
    await writeFile(join(projectDir, 'a.css'), '.a { background: url(./A.PNG); }\n');
    await writeFile(entryPath, "import './a.css';\nimport b from './B.PNG';\nexport default { components: {}, b };\n");

    const { css } = await runBundle();
    const references = referencesOf(css);

    expect(existsSync(join(editorDir, 'assets', `${sha256Of(PNG_1X1)}.png`))).toBe(true);
    expect(references).toHaveLength(1);
    expect(resolvesBesideStylesheet(references[0])).toBe(true);
  });

  it('keeps a component stylesheet reference to a missing file as written, as the site build does', async () => {
    await writeFile(join(projectDir, 'a.css'), '.f { background: url(./missing.png); }\n');
    await writeFile(entryPath, "import './a.css';\nexport default { components: {} };\n");

    const { css } = await runBundle();

    expect(referencesOf(css)).toEqual(['./missing.png']);
  });

  it('bundles an image from the content folder as a file, never as code', async () => {
    await mkdir(join(projectDir, 'content', 'media'), { recursive: true });
    await writeFile(join(projectDir, 'content', 'media', 'photo.png'), PNG_1X1);
    await writeFile(
      entryPath,
      "import photo from './content/media/photo.png';\nexport default { components: {}, photo };\n",
    );

    const { js } = await runBundle();

    expect(await readdir(join(editorDir, 'assets'))).toEqual([`${sha256Of(PNG_1X1)}.png`]);
    expect(js).not.toContain('\x89PNG');
    expect(js).not.toContain(PNG_1X1.toString('base64').slice(0, 16));
  });

  const CONTENT_IMPORTS = [
    ['./content/pages/home.mdx', /home\.mdx/],
    ['./content/pages/home.en.vxjson', /home\.en\.vxjson/],
  ] as const;

  it.each(CONTENT_IMPORTS)('refuses to bundle %s, an MDX page or a content file', async (page, name) => {
    await importContent(page);

    await Promise.resolve(expect(runBundle()).rejects.toThrow(name));
  });

  it.each(CONTENT_IMPORTS)('refuses %s even when a site plugin could compile it', async (page, name) => {
    await importContent(page);
    const compileContent: Plugin = {
      name: 'compile-content',
      load(id) {
        if (/\.(mdx|vxjson)$/.test(id)) return 'export default "compiled";';
        return null;
      },
    };

    await Promise.resolve(expect(runBundle({ vite: { plugins: [compileContent] } })).rejects.toThrow(name));
  });

  it.each(CONTENT_IMPORTS)('refuses %s before a pre-plugin can resolve it as JavaScript', async (page, name) => {
    await importContent(page);
    const virtualContent = '\0compiled-content.js';
    const resolveContent: Plugin = {
      name: 'resolve-content-before-builtins',
      enforce: 'pre',
      resolveId(id) {
        return id === page ? virtualContent : null;
      },
      load(id) {
        return id === virtualContent ? 'export default "compiled content";' : null;
      },
    };

    await Promise.resolve(expect(runBundle({ vite: { plugins: [resolveContent] } })).rejects.toThrow(name));
  });
});
