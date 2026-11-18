import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileSystemContentAPI } from '@conloca/content-api/node';
import { checkFragmentComponents } from '../src/build/check-fragment-components.js';

const PAST = '2000-01-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';

/** Front matter is 7 lines (two fences, five keys), then a blank line; body line 2 is file line 9. */
function fragment(id: string, body: string, schedule: Record<string, string> = {}): string {
  const keys = { title: id, id, created: PAST, modified: PAST, ...schedule };
  const lines = Object.entries(keys).map(([k, v]) => `${k}: '${v}'`);
  while (lines.length < 5) lines.push(`x${lines.length}: y`);
  return `---\n${lines.slice(0, 5).join('\n')}\n---\n${body}`;
}

/** The problem line of fragment `e`, whose MDX does not parse. */
const parseLine = (lines: string[]) => lines.find((l) => l.startsWith('e (en) '));

describe('checkFragmentComponents', () => {
  let root: string;
  let contentRoot: string;
  const warn = mock((_message: string) => {});
  const logger = { warn };

  const check = (fragmentComponentsPath: string | undefined) =>
    checkFragmentComponents({ contentRoot, root, vite: {}, fragmentComponentsPath, logger });

  beforeEach(async () => {
    warn.mockClear();
    root = await mkdtemp(join(tmpdir(), 'conloca-fragment-check-'));
    contentRoot = join(root, 'content');
    const dir = join(contentRoot, 'fragments', 'general');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(contentRoot, 'sites.json'),
      JSON.stringify({ sites: { main: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] }),
    );
    // title, id, created, modified fill four keys; the fifth is the schedule or a filler.
    await writeFile(join(dir, 'a.en.mdx'), fragment('a', '\n<Nope/>\n'));
    await writeFile(join(dir, 'b.en.mdx'), fragment('b', '\n<Nope/>\n', { unpublishAt: PAST }));
    await writeFile(join(dir, 'c.en.mdx'), fragment('c', '\n<Nope/>\n', { publishAt: FUTURE }));
    await writeFile(join(dir, 'f.en.mdx'), fragment('f', '\n<Nope/>\n', { unpublishAt: FUTURE }));
    await writeFile(join(dir, 'd.en.mdx'), fragment('d', '\n<Callout/>\n'));
    await writeFile(join(dir, 'e.en.mdx'), fragment('e', '\n<Callout>\n'));
    // A Puck fragment: JSON, not MDX, so the check must not parse it.
    await writeFile(
      join(dir, 'g.en.vxjson'),
      JSON.stringify({ id: 'g', type: 'puck', created: PAST, modified: PAST, meta: { title: 'g' }, content: {} }),
    );
    await writeFile(
      join(root, 'good.mjs'),
      'export const fragmentComponents = { components: { Callout: () => null }, elements: {} };\n',
    );
    await writeFile(join(root, 'broken.mjs'), "throw new Error('cannot load here');\n");
    await writeFile(join(root, 'empty.mjs'), 'export const fragmentComponents = {};\n');
  });

  afterEach(async () => {
    FileSystemContentAPI.clearCaches();
    await rm(root, { recursive: true, force: true });
  });

  test('reports live fragments using undeclared components, skips expired, includes scheduled', async () => {
    const lines = await check('./good.mjs');
    expect(lines).toContain('a (en) content/fragments/general/a.en.mdx:9: <Nope> is not in ./good.mjs');
    expect(lines).toContain('c (en) content/fragments/general/c.en.mdx:9: <Nope> is not in ./good.mjs');
    expect(lines).toContain('f (en) content/fragments/general/f.en.mdx:9: <Nope> is not in ./good.mjs');
    expect(lines.some((l) => l.startsWith('b '))).toBe(false);
    expect(lines.some((l) => l.startsWith('d '))).toBe(false);
    expect(parseLine(lines)).toStartWith('e (en) content/fragments/general/e.en.mdx: ');
    expect(lines).toHaveLength(4);
  });

  test('without fragmentComponentsPath every component is unknown', async () => {
    const lines = await check(undefined);
    const named = lines.filter((l) => l.includes('is not in fragmentComponentsPath (not set)')).map((l) => l[0]);
    // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh local array.
    expect(named.sort()).toEqual(['a', 'c', 'd', 'f']);
    expect(parseLine(lines)).toBeDefined();
  });

  test('a module that fails to load warns and skips the name and hydration checks', async () => {
    const lines = await check('./broken.mjs');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('./broken.mjs');
    expect(warn.mock.calls[0]?.[0]).toContain('cannot load here');
    expect(warn.mock.calls[0]?.[0]).toContain('nor the hydration mapping');
    expect(lines).toHaveLength(1);
    expect(parseLine(lines)).toBeDefined();
  });

  test('a module exporting something other than a vocabulary is one problem line', async () => {
    const lines = await check('./empty.mjs');
    expect(lines.filter((l) => l.includes('./empty.mjs'))).toHaveLength(1);
    expect(parseLine(lines)).toBeDefined();
  });

  describe('hydrated fragment components', () => {
    // The fixture sits outside any package, so the hydration entry resolves to this package's source.
    const vite = {
      resolve: {
        alias: { '@conloca/astro-cms/hydration': fileURLToPath(new URL('../src/hydration.ts', import.meta.url)) },
      },
    };
    const hydration = "import { withHydration } from '@conloca/astro-cms/hydration';\n";
    const checkWithHydration = (fragmentComponentsPath: string) =>
      checkFragmentComponents({ contentRoot, root, vite, fragmentComponentsPath, logger });

    test('one the build cannot map is a problem line with the render error', async () => {
      await writeFile(
        join(root, 'inline.mjs'),
        `${hydration}const Counter = withHydration(() => null, 'load');\nexport const fragmentComponents = { components: { Counter }, elements: {} };\n`,
      );
      const lines = await checkWithHydration('./inline.mjs');
      expect(lines).toContain(
        'Fragment component <Counter> is wrapped in withHydration(), but the build found no module for it. Import it into the render module by name from the file that calls withHydration().',
      );
    });

    test('one imported by name from its own module passes, and names are still checked', async () => {
      await mkdir(join(root, 'islands'));
      await writeFile(
        join(root, 'islands', 'Counter.mjs'),
        `${hydration}export const Counter = withHydration(() => null, 'load');\n`,
      );
      await writeFile(
        join(root, 'mapped.mjs'),
        "import { Counter } from './islands/Counter.mjs';\nexport const fragmentComponents = { components: { Counter, Callout: () => null }, elements: {} };\n",
      );
      const lines = await checkWithHydration('./mapped.mjs');
      expect(warn).not.toHaveBeenCalled();
      expect(lines.some((line) => line.includes('withHydration'))).toBe(false);
      expect(lines).toContain('a (en) content/fragments/general/a.en.mdx:9: <Nope> is not in ./mapped.mjs');
    });

    test('one imported under another name maps by that name', async () => {
      await mkdir(join(root, 'islands'));
      await writeFile(
        join(root, 'islands', 'Counter.mjs'),
        `${hydration}export const Counter = withHydration(() => null, 'load');\n`,
      );
      await writeFile(
        join(root, 'renamed.mjs'),
        "import { Counter as Clicker } from './islands/Counter.mjs';\nexport const fragmentComponents = { components: { Clicker }, elements: {} };\n",
      );
      const lines = await checkWithHydration('./renamed.mjs');
      expect(warn).not.toHaveBeenCalled();
      expect(lines.some((line) => line.includes('withHydration'))).toBe(false);
    });
  });
});
