import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  bundleEditorAssets,
  type EditorBundleDescriptors,
  emitRouteCssArtifact,
  mirrorEditorAssets,
} from '../bundle.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A miniature site puck config: a React component (hooks + JSX) plus a
 * runtime import from the puck editor package. Both `react` and
 * `@puckeditor/core` MUST stay external — the editor supplies them at
 * runtime so the site's components execute on the editor's own React
 * instance (decision invariant).
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

const EXISTING_HEADERS = ['/admin/*', '  X-Robots-Tag: noindex', ''].join('\n');

let projectDir: string;
let distDir: string;
let entryPath: string;

function makeLogger(): {
  info: (message: string) => void;
  warn: (message: string) => void;
  messages: string[];
  warnings: string[];
} {
  const messages: string[] = [];
  const warnings: string[] = [];
  return {
    info: (message: string) => {
      messages.push(message);
    },
    warn: (message: string) => {
      warnings.push(message);
    },
    messages,
    warnings,
  };
}

async function runBundle() {
  return bundleEditorAssets({
    dir: distDir,
    root: projectDir,
    vite: {},
    puckConfigPath: entryPath,
    logger: makeLogger(),
  });
}

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'editor-bundle-'));
  distDir = join(projectDir, 'dist');
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

describe('bundleEditorAssets — output file', () => {
  it('writes the bundle under _conloca with a 16-hex-char hashed filename', async () => {
    const result = await runBundle();
    expect(result.url).toMatch(/^\/_conloca\/editor-bundle\.[0-9a-f]{16}\.js$/);
    const written = await readFile(join(distDir, result.url));
    expect(written.equals(Buffer.from(result.bytes))).toBe(true);
  });

  it('returns the FULL sha-256 of the bytes; the filename embeds its first 16 chars', async () => {
    const result = await runBundle();
    const expected = createHash('sha256').update(result.bytes).digest('hex');
    expect(result.hash).toBe(expected);
    expect(result.hash).toHaveLength(64);
    expect(result.url).toContain(result.hash.slice(0, 16));
  });

  it('emits minified output', async () => {
    const result = await runBundle();
    const text = new TextDecoder().decode(result.bytes);
    expect(text).not.toContain('\n  ');
  });
});

// ---------------------------------------------------------------------------
// Externals — the contract with the editor (decision invariant: no second React)
// ---------------------------------------------------------------------------

describe('bundleEditorAssets — externals', () => {
  it('keeps react external (imported, not bundled)', async () => {
    const result = await runBundle();
    const text = new TextDecoder().decode(result.bytes);
    expect(text.includes('from"react"') || text.includes('from "react"')).toBe(true);
    // A bundled React copy would carry hook implementations the fixture
    // never references; their absence is the no-second-React tripwire.
    expect(text).not.toContain('useReducer');
  });

  it('keeps the puck editor package external', async () => {
    const result = await runBundle();
    const text = new TextDecoder().decode(result.bytes);
    expect(text.includes('from"@puckeditor/core"') || text.includes('from "@puckeditor/core"')).toBe(true);
  });

  it('pins the externals contract shared with the editor', async () => {
    // Mirrored literal of the modules the editor supplies — its tests pin
    // the same list. If either side changes, this test forces a conscious
    // update of the other.
    const { EDITOR_BUNDLE_EXTERNALS } = await import('../bundle.js');
    expect(([...EDITOR_BUNDLE_EXTERNALS] as string[]).sort()).toEqual(
      [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-dom/client',
        '@puckeditor/core',
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Stylesheet imports — compiled into a companion stylesheet the editor
// injects into the canvas iframe (styled canvas)
// ---------------------------------------------------------------------------

describe('bundleEditorAssets — component stylesheet compilation', () => {
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

  it('emits a companion stylesheet carrying the compiled SCSS-module rules', async () => {
    const result = await runBundle();
    expect(result.stylesheet).toBeDefined();
    expect(result.stylesheet?.url).toMatch(/^\/_conloca\/editor-bundle\.[0-9a-f]{16}\.css$/);
    const css = new TextDecoder().decode(result.stylesheet?.bytes);
    expect(css).toContain('color:red');
  });

  it('hashes the stylesheet independently: full sha-256 returned, first 16 chars in the filename', async () => {
    const result = await runBundle();
    const expected = createHash('sha256')
      .update(Buffer.from(result.stylesheet?.bytes ?? new Uint8Array()))
      .digest('hex');
    expect(result.stylesheet?.hash).toBe(expected);
    expect(result.stylesheet?.url).toContain(expected.slice(0, 16));
    const written = await readFile(join(distDir, result.stylesheet?.url ?? ''));
    expect(written.equals(Buffer.from(result.stylesheet?.bytes ?? new Uint8Array()))).toBe(true);
  });

  it('keeps the JS class names and the stylesheet selectors in sync (same-pass CSS modules)', async () => {
    const result = await runBundle();
    const js = new TextDecoder().decode(result.bytes);
    const css = new TextDecoder().decode(result.stylesheet?.bytes);
    // The hashed local class name must appear in BOTH outputs, or the
    // component's className points at a selector that doesn't exist.
    const match = css.match(/\.([A-Za-z0-9_-]+)\{color:red\}/) ?? css.match(/\.([A-Za-z0-9_-]+)\s*\{[^}]*color:red/);
    expect(match).not.toBeNull();
    expect(js).toContain(match?.[1] ?? '<<no-class>>');
  });

  it('omits the stylesheet entirely for a config with no styles', async () => {
    await writeFile(entryPath, FIXTURE_ENTRY);
    const result = await runBundle();
    expect(result.stylesheet).toBeUndefined();
  });

  it('leaves font/image url() references unresolved (they load from the deployed site, not the bundle)', async () => {
    await writeFile(join(projectDir, 'hero.module.scss'), ".root { background: url('./bg.png'); color: red; }\n");
    const result = await runBundle();
    const css = new TextDecoder().decode(result.stylesheet?.bytes);
    expect(css).toContain('bg.png');
  });

  it('strips a stylesheet that fails to compile and keeps the bundle alive (fail-soft, warn)', async () => {
    await writeFile(join(projectDir, 'hero.module.scss'), '.root { color: $undefined-variable; }\n');
    const logger = makeLogger();
    const result = await bundleEditorAssets({
      dir: distDir,
      root: projectDir,
      vite: {},
      puckConfigPath: entryPath,
      logger,
    });
    // The JS bundle still ships; the broken stylesheet is dropped like before.
    expect(result.url).toMatch(/\.js$/);
    expect(logger.warnings.join('\n')).toContain('hero.module.scss');
  });
});

// ---------------------------------------------------------------------------
// siteStyles — site CSS for accurate preview rendering,
// compiled by the site's own Vite pipeline into the same registered
// stylesheet, ahead of the component modules
// ---------------------------------------------------------------------------

describe('bundleEditorAssets — siteStyles', () => {
  beforeEach(async () => {
    await writeFile(entryPath, FIXTURE_ENTRY);
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

  async function bundleSiteStyles(siteStyles: string[], puckConfigPath = entryPath) {
    const logger = makeLogger();
    const result = await bundleEditorAssets({
      dir: distDir,
      root: projectDir,
      vite: {},
      puckConfigPath,
      siteStyles,
      logger,
    });
    return { result, logger, css: new TextDecoder().decode(result.stylesheet?.bytes) };
  }

  it('resolves siteStyles against the Astro root even when the puck config lives in a subdirectory', async () => {
    // A common layout: puckConfigPath './src/puck.config.tsx' with
    // siteStyles './src/styles/index.scss' — both project-root-relative.
    // Anchoring the entries to the config's OWN directory would look for
    // src/src/styles and fail the whole bundle.
    await mkdir(join(projectDir, 'src', 'styles'), { recursive: true });
    await writeFile(join(projectDir, 'src', 'puck.config.tsx'), FIXTURE_ENTRY);
    await writeFile(join(projectDir, 'src', 'styles', 'global.scss'), 'body { color: teal; }\n');

    const { css } = await bundleSiteStyles(['./src/styles/global.scss'], join(projectDir, 'src', 'puck.config.tsx'));

    expect(css).toContain('color:teal');
  });

  it('compiles the listed global entries into the companion stylesheet as plain (non-module) CSS', async () => {
    const { css } = await bundleSiteStyles(['./global.scss', './plain.css']);

    // Global selectors survive un-hashed, in listed order.
    expect(css).toContain('font-family:Site Sans');
    expect(css).toContain('letter-spacing:1px');
    expect(css.indexOf('font-family')).toBeLessThan(css.indexOf('letter-spacing'));
  });

  it('puts the site styles ahead of the component stylesheets, so component rules keep the final word', async () => {
    await writeFile(entryPath, `import './widget.css';\n${FIXTURE_ENTRY}`);
    await writeFile(join(projectDir, 'widget.css'), '.widget { outline-offset: 3px; }\n');

    const { css } = await bundleSiteStyles(['./plain.css']);

    expect(css).toContain('letter-spacing');
    expect(css.indexOf('letter-spacing')).toBeLessThan(css.indexOf('outline-offset'));
  });

  it('a siteStyles entry that fails to compile stops the build and names it', async () => {
    // Parity with the site's own build, which fails on the same stylesheet: a
    // canvas stylesheet that silently lost its site styles must not register.
    const broken = join(projectDir, 'broken.scss');
    await writeFile(broken, '.root { color: $undefined-variable; }\n');

    await expect(bundleSiteStyles([broken])).rejects.toThrow(
      new RegExp(`${broken.replaceAll('.', '\\.')}[\\s\\S]*Undefined variable`),
    );
  });
});

// ---------------------------------------------------------------------------
// Stylesheet asset URLs — the registered stylesheet is injected into the
// editor's canvas, so its asset references resolve against the EDITOR's
// origin unless absolutized against the deployed site
// ---------------------------------------------------------------------------

describe('bundleEditorAssets — stylesheet asset URLs', () => {
  const FONT_CSS = [
    '@font-face { font-family: Body; src: url("/fonts/Body-Regular.otf") format("opentype"); }',
    '@font-face { font-family: Display; src: url("/fonts/display/Display-400.ttf") format("truetype"); }',
    '.hero { background: url("/img/hero.png"); }',
    '',
  ].join('\n');

  beforeEach(async () => {
    await writeFile(entryPath, FIXTURE_ENTRY);
    await writeFile(join(projectDir, 'fonts.css'), FONT_CSS);
    // Root-relative refs name files the site serves from its public dir.
    for (const asset of ['fonts/Body-Regular.otf', 'fonts/display/Display-400.ttf', 'img/hero.png']) {
      await mkdir(dirname(join(projectDir, 'public', asset)), { recursive: true });
      await writeFile(join(projectDir, 'public', asset), '');
    }
  });

  async function bundleWithFonts(publicBaseUrl?: string) {
    const logger = makeLogger();
    const result = await bundleEditorAssets({
      dir: distDir,
      root: projectDir,
      vite: {},
      puckConfigPath: entryPath,
      siteStyles: [join(projectDir, 'fonts.css')],
      publicBaseUrl,
      logger,
    });
    return { result, logger, css: new TextDecoder().decode(result.stylesheet?.bytes) };
  }

  it('absolutizes root-relative url() against the deployed site', async () => {
    const { css } = await bundleWithFonts('https://site.example.com');
    expect(css).toContain('url(https://site.example.com/fonts/Body-Regular.otf)');
    expect(css).toContain('url(https://site.example.com/fonts/display/Display-400.ttf)');
    expect(css).toContain('url(https://site.example.com/img/hero.png)');
    expect(css).not.toContain('url(/fonts/');
  });

  it('rewrites BEFORE hashing, so the editor hash-verifies the bytes it fetches', async () => {
    const { result, css } = await bundleWithFonts('https://site.example.com');
    const written = await readFile(join(distDir, result.stylesheet?.url ?? ''), 'utf8');
    expect(written).toBe(css);
    expect(written).toContain('https://site.example.com/fonts/');
    const expected = createHash('sha256')
      .update(Buffer.from(result.stylesheet?.bytes ?? new Uint8Array()))
      .digest('hex');
    expect(result.stylesheet?.hash).toBe(expected);
  });

  it('leaves already-absolute, protocol-relative, data: and fragment refs alone', async () => {
    await writeFile(
      join(projectDir, 'fonts.css'),
      [
        '.a { background: url("https://cdn.example.com/x.png"); }',
        '.b { background: url("//cdn.example.com/y.png"); }',
        '.c { background: url("data:image/svg+xml;base64,AAA"); }',
        '.d { filter: url("#blur"); }',
        '',
      ].join('\n'),
    );
    const { css } = await bundleWithFonts('https://site.example.com');
    expect(css).toContain('url(https://cdn.example.com/x.png)');
    expect(css).toContain('url(//cdn.example.com/y.png)');
    expect(css).toContain('url(data:image/svg+xml;base64,AAA)');
    expect(css).toContain('url(#blur)');
    expect(css).not.toContain('site.example.com/');
  });

  it('leaves path-relative url() in a component stylesheet alone and warns — the emitted sheet has lost the source directory', async () => {
    // esbuild flattens every component stylesheet in the graph into ONE output
    // and keeps url() paths exactly as authored, so `./x.woff2` no longer says
    // WHICH directory it was relative to. Guessing would silently emit dead URLs.
    await writeFile(entryPath, `import './widget.css';\n${FIXTURE_ENTRY}`);
    await writeFile(join(projectDir, 'widget.css'), '@font-face { font-family: R; src: url("./rel/R.woff2"); }\n');
    const { css, logger } = await bundleWithFonts('https://site.example.com');
    expect(css).toContain('url(./rel/R.woff2)');
    expect(logger.warnings.join('\n')).toContain('./rel/R.woff2');
  });

  it('leaves every url() untouched when no public base URL is known', async () => {
    const { css } = await bundleWithFonts(undefined);
    expect(css).toContain('url(/fonts/Body-Regular.otf)');
  });

  it('grants CORS on the referenced asset directories — webfonts are CORS-gated', async () => {
    await bundleWithFonts('https://site.example.com');
    const headers = await readFile(join(distDir, '_headers'), 'utf8');
    expect(headers).toContain('/fonts/*');
    expect(headers).toContain('/fonts/display/*');
    expect(headers).toContain('/img/*');
    // One rule per distinct directory, not one per file.
    expect(headers.match(/Access-Control-Allow-Origin/g)).toHaveLength(4);
  });

  it('does not duplicate asset CORS rules when bundling twice', async () => {
    await bundleWithFonts('https://site.example.com');
    await bundleWithFonts('https://site.example.com');
    const headers = await readFile(join(distDir, '_headers'), 'utf8');
    expect(headers.match(/\/fonts\/\*/g)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// _headers — CORS contract for cross-origin loading from the editor's origin
// ---------------------------------------------------------------------------

describe('bundleEditorAssets — _headers CORS rule', () => {
  it('creates _headers with the /_conloca/* CORS rule when none exists', async () => {
    await runBundle();
    const headers = await readFile(join(distDir, '_headers'), 'utf8');
    expect(headers).toContain('/_conloca/*');
    expect(headers).toContain('Access-Control-Allow-Origin: *');
  });

  it('appends to an existing _headers without clobbering its rules', async () => {
    await writeFile(join(distDir, '_headers'), EXISTING_HEADERS);
    await runBundle();
    const headers = await readFile(join(distDir, '_headers'), 'utf8');
    expect(headers).toContain('/admin/*');
    expect(headers).toContain('X-Robots-Tag: noindex');
    expect(headers).toContain('/_conloca/*');
    expect(headers).toContain('Access-Control-Allow-Origin: *');
  });

  it('does not duplicate the rule when bundling twice', async () => {
    await runBundle();
    await runBundle();
    const headers = await readFile(join(distDir, '_headers'), 'utf8');
    expect(headers.split('/_conloca/*').length - 1).toBe(1);
  });
});

describe('emitRouteCssArtifact', () => {
  it('writes a content-addressed route-css artifact under _conloca', async () => {
    const result = await emitRouteCssArtifact(distDir, '.post-body p{font-size:17px}', undefined, makeLogger());
    expect(result?.stylesheet.url).toMatch(/^\/_conloca\/route-css\.[0-9a-f]{16}\.css$/);
    const written = await readFile(join(distDir, result?.stylesheet.url ?? ''), 'utf8');
    expect(written).toBe('.post-body p{font-size:17px}');
    const expected = createHash('sha256').update(Buffer.from(written)).digest('hex');
    expect(result?.stylesheet.hash).toBe(expected);
  });

  it('absolutizes the site asset URLs it carries — the discovered CSS is applied at the EDITOR origin', async () => {
    const css = '@font-face{font-family:N;src:url(/fonts/N.otf)}.a{color:red}';
    const result = await emitRouteCssArtifact(distDir, css, 'https://site.example', makeLogger());
    const written = await readFile(join(distDir, result?.stylesheet.url ?? ''), 'utf8');
    expect(written).toContain('url(https://site.example/fonts/N.otf)');
    expect(written).not.toContain('url(/fonts/');
    // …and grants those directories CORS, since webfonts are CORS-gated.
    expect(result?.assetCorsPaths).toEqual(['/fonts/*']);
    const headers = await readFile(join(distDir, '_headers'), 'utf8');
    expect(headers).toContain('/fonts/*');
  });

  it('empty css → no artifact (registering an empty sheet would only add a wasted fetch)', async () => {
    expect(await emitRouteCssArtifact(distDir, '', undefined, makeLogger())).toBeUndefined();
  });
});

describe('mirrorEditorAssets', () => {
  let fromDir: string;
  let toDir: string;

  beforeEach(async () => {
    fromDir = await mkdtemp(join(tmpdir(), 'conloca-mirror-from-'));
    toDir = await mkdtemp(join(tmpdir(), 'conloca-mirror-to-'));
    await mkdir(join(fromDir, '_conloca'), { recursive: true });
    await writeFile(join(fromDir, '_conloca', 'editor-bundle.abc.js'), 'export default 1;');
    await writeFile(join(fromDir, '_headers'), '/_conloca/*\n  Access-Control-Allow-Origin: *\n');
  });

  afterEach(async () => {
    await rm(fromDir, { recursive: true, force: true });
    await rm(toDir, { recursive: true, force: true });
  });

  it('copies _conloca into the target and adds the CORS rule to its _headers', async () => {
    // The target simulates the preview build's client dir, which ships its own
    // _headers (e.g. hashed-asset caching) that must survive the merge.
    await writeFile(join(toDir, '_headers'), '/_astro/*\n  Cache-Control: public, max-age=31536000, immutable\n');

    await mirrorEditorAssets(fromDir, toDir);

    expect(await readFile(join(toDir, '_conloca', 'editor-bundle.abc.js'), 'utf8')).toBe('export default 1;');
    const headers = await readFile(join(toDir, '_headers'), 'utf8');
    expect(headers).toContain('/_astro/*');
    expect(headers).toContain('/_conloca/*');
  });

  it('creates _headers when the target has none, and is idempotent', async () => {
    await mirrorEditorAssets(fromDir, toDir);
    await mirrorEditorAssets(fromDir, toDir);

    const headers = await readFile(join(toDir, '_headers'), 'utf8');
    expect(headers.match(/\/_conloca\/\*/g)).toHaveLength(1);
    expect(await readFile(join(toDir, '_conloca', 'editor-bundle.abc.js'), 'utf8')).toBe('export default 1;');
  });

  it('carries the stylesheet asset CORS rules across too', async () => {
    // When one Cloudflare Worker serves the site and the preview, the MIRRORED dir is what actually serves
    // the site, so a font rule that only exists in the primary dist leaves
    // the editor's canvas without its webfonts.
    await mirrorEditorAssets(fromDir, toDir, ['/fonts/*']);

    const headers = await readFile(join(toDir, '_headers'), 'utf8');
    expect(headers).toContain('/_conloca/*');
    expect(headers).toContain('/fonts/*');
  });
});

// ---------------------------------------------------------------------------
// Editor descriptors — the bundle's third leg
// ---------------------------------------------------------------------------

describe('bundleEditorAssets — editor descriptors', () => {
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

  async function bundleWithDescriptors(descriptors?: EditorBundleDescriptors) {
    const logger = makeLogger();
    const result = await bundleEditorAssets({
      dir: distDir,
      root: projectDir,
      vite: {},
      puckConfigPath: plainEntry,
      logger,
      ...(descriptors ? { descriptors } : {}),
    });
    const bundleModule = (await import(pathToFileURL(join(distDir, result.url)).href)) as {
      default?: unknown;
      pageSchemas?: unknown;
      dataSchemas?: unknown;
      mdxComponents?: unknown;
      discoveredMdxComponents?: unknown;
      templates?: unknown;
      dataBindings?: unknown;
    };
    return { result, bundleModule, logger };
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

  it('tolerates a schemas module that declares only one of the exports, without warning', async () => {
    await writeFile(schemasPath, "export const pageSchemas = { 'type:mdx': { label: 'Only schemas' } };\n");

    const { bundleModule, logger } = await bundleWithDescriptors({ schemasPath });

    expect(bundleModule.pageSchemas).toEqual({ 'type:mdx': { label: 'Only schemas' } });
    expect(bundleModule.mdxComponents).toBeUndefined();
    expect(bundleModule.dataSchemas).toBeUndefined();
    // Absent optional names are the soft contract working as designed — most
    // sites have no dataSchemas — so the per-name always-undefined notices
    // stay out of the build log instead of polluting every single build.
    expect(logger.warnings.join('\n')).not.toContain('dataSchemas');
  });

  it('warns once when the schemas module exports none of the expected names', async () => {
    // A module yielding nothing recognizable is a wrong path or misspelled
    // exports — the one absence that IS a diagnostic, reported in this
    // package's own words instead of three raw esbuild notices.
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
