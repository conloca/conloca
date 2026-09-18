import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverStyleContext, extractRouteCssRefs } from '../discovery.js';

let dir: string;

function makeLogger() {
  const warnings: string[] = [];
  const messages: string[] = [];
  return {
    info: (m: string) => void messages.push(m),
    warn: (m: string) => void warnings.push(m),
    warnings,
    messages,
  };
}

const PAGE_HTML = [
  '<!doctype html><html><head>',
  '<link rel="stylesheet" href="/_astro/a.css">',
  '<style>.inline-rule{letter-spacing:1px}</style>',
  '<link rel="stylesheet" href="/_astro/b.css">',
  '</head><body>',
  '<main><article class="post-body"><h1>T</h1><p>a</p><p>b</p><p>c</p></article></main>',
  '</body></html>',
].join('\n');

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'style-discovery-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('extractRouteCssRefs', () => {
  it('collects stylesheet links and inline style blocks in document order', () => {
    const refs = extractRouteCssRefs(PAGE_HTML);
    expect(refs).toEqual([
      { kind: 'link', href: '/_astro/a.css' },
      { kind: 'inline', css: '.inline-rule{letter-spacing:1px}' },
      { kind: 'link', href: '/_astro/b.css' },
    ]);
  });

  it('ignores non-stylesheet links and preloads', () => {
    const refs = extractRouteCssRefs(
      '<link rel="preload" href="/x.css" as="style"><link rel="icon" href="/f.svg"><link rel="stylesheet" href="/y.css">',
    );
    expect(refs).toEqual([{ kind: 'link', href: '/y.css' }]);
  });
});

describe('discoverStyleContext — prerendered file source', () => {
  it('reads the built page, resolves its CSS from the client dir, and finds the wrapper', async () => {
    await mkdir(join(dir, 'prose-parity'), { recursive: true });
    await mkdir(join(dir, '_astro'), { recursive: true });
    await writeFile(join(dir, 'prose-parity', 'index.html'), PAGE_HTML);
    await writeFile(join(dir, '_astro', 'a.css'), '.a{color:red}');
    await writeFile(join(dir, '_astro', 'b.css'), '.b{color:blue}');

    const logger = makeLogger();
    const result = await discoverStyleContext({ clientDir: dir, route: '/prose-parity', logger });

    expect(result).toBeDefined();
    expect(result?.hostWrappers.content?.className).toBe('post-body');
    // Document order: a.css, the inline block, b.css.
    const css = result?.routeCss ?? '';
    expect(css.indexOf('.a{color:red}')).toBeGreaterThanOrEqual(0);
    expect(css.indexOf('.a{color:red}')).toBeLessThan(css.indexOf('.inline-rule'));
    expect(css.indexOf('.inline-rule')).toBeLessThan(css.indexOf('.b{color:blue}'));
  });

  it('accepts the flat <route>.html shape too', async () => {
    await writeFile(join(dir, 'about.html'), PAGE_HTML.replace('href="/_astro/a.css"', 'href="/missing.css"'));
    const logger = makeLogger();
    const result = await discoverStyleContext({ clientDir: dir, route: '/about', logger });
    expect(result).toBeDefined();
    // Missing CSS files degrade to a warning, never a throw.
    expect(logger.warnings.join('\n')).toContain('/missing.css');
  });
});

describe('discoverStyleContext — booted server entry source', () => {
  it('boots the entry, fetches the route and its CSS over http, then shuts down', async () => {
    // A stand-in for the node adapter's dist/server/entry.mjs: a plain http
    // server honoring HOST/PORT, serving the fixture page + one stylesheet.
    const entry = join(dir, 'entry.mjs');
    await writeFile(
      entry,
      [
        "import { createServer } from 'node:http';",
        `const PAGE = ${JSON.stringify(PAGE_HTML.replace('<link rel="stylesheet" href="/_astro/b.css">', ''))};`,
        'const server = createServer((req, res) => {',
        "  if (req.url === '/_astro/a.css') { res.setHeader('content-type', 'text/css'); res.end('.served{color:teal}'); return; }",
        "  res.setHeader('content-type', 'text/html'); res.end(PAGE);",
        '});',
        "server.listen(Number(process.env.PORT), process.env.HOST ?? '127.0.0.1');",
      ].join('\n'),
    );

    const logger = makeLogger();
    const result = await discoverStyleContext({ clientDir: dir, serverEntry: entry, route: '/prose-parity', logger });

    expect(result).toBeDefined();
    expect(result?.hostWrappers.content?.className).toBe('post-body');
    expect(result?.routeCss).toContain('.served{color:teal}');
    expect(result?.routeCss).toContain('.inline-rule');
  });
});

describe('discoverStyleContext — nothing to stand on', () => {
  it('warns and returns undefined instead of failing the build', async () => {
    const logger = makeLogger();
    const result = await discoverStyleContext({ clientDir: dir, route: '/nowhere', logger });
    expect(result).toBeUndefined();
    expect(logger.warnings.join('\n')).toContain('/nowhere');
  });
});
