import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkEntryPlace } from '../src/content-operations.js';
import { FileSystemContentAPI, readSitesConfig } from '../src/filesystem-content-api.js';
import type { SitesConfig, VXJSONFile } from '../src/types.js';
import { VXJSON } from '../src/vxjson.js';
import { testTempDir } from './test-temp-dir.js';

function pageBytes(id: string, title: string): string {
  const file: VXJSONFile = {
    id,
    type: 'puck',
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-01-02T00:00:00.000Z',
    meta: { title },
    content: { puckData: { root: {} } },
  };
  return VXJSON.serialize(file);
}

/** What creating an entry in `locale` answers: the message every locale refusal shares. */
function createRefusal(locale: string): string {
  const refusal = checkEntryPlace('pages', [locale]);
  if (!refusal) throw new Error(`expected ${locale} to be refused`);
  return refusal.error;
}

/**
 * A site may declare a language the content file names cannot carry (pt-br,
 * zh-Hans, fil). Its pages can then be neither created nor read, so the
 * mismatch has to show where the site owner looks, not only on a failed save.
 */
describe('locales content files cannot carry', () => {
  let contentRoot: string;
  let warn: ReturnType<typeof spyOn>;

  const warnings = (): string[] => warn.mock.calls.map((call: unknown[]) => String(call[0]));

  beforeEach(async () => {
    contentRoot = testTempDir('locale-grammar');
    await mkdir(join(contentRoot, 'default/pages'), { recursive: true });
    warn = spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    warn.mockRestore();
    await rm(contentRoot, { recursive: true, force: true });
    FileSystemContentAPI.clearCaches();
  });

  test('loading sites.json warns once for each declared locale content cannot carry', async () => {
    const sites: SitesConfig = {
      sites: {
        default: { locales: ['en', 'pt-br', 'en-US'], defaultLocale: 'en' },
        other: { locales: ['fil', 'zh-Hans'], defaultLocale: 'fil' },
      },
      globalLocales: ['en', 'pt-br'],
    };
    await writeFile(join(contentRoot, 'sites.json'), JSON.stringify(sites));

    await readSitesConfig(contentRoot);
    await readSitesConfig(contentRoot);

    for (const locale of ['pt-br', 'fil', 'zh-Hans']) {
      expect(warnings().filter((warning) => warning.includes(createRefusal(locale)))).toHaveLength(1);
    }
    expect(warnings().some((warning) => /Invalid locale: en\b/.test(warning))).toBe(false);
  });

  test('a page file in such a locale is reported as an index problem in the words create uses', async () => {
    const sites: SitesConfig = {
      sites: { default: { locales: ['en', 'pt-br'], defaultLocale: 'en' } },
      globalLocales: ['en'],
    };
    await writeFile(join(contentRoot, 'sites.json'), JSON.stringify(sites));
    const pagePath = join(contentRoot, 'default/pages/about.pt-br.vxjson');
    await writeFile(pagePath, pageBytes('vx-about-ptbr', 'Sobre'));

    const api = await FileSystemContentAPI.create({ contentRoot });

    expect(Array.from(api.listAllContent()).map((manifest) => manifest.id)).not.toContain('vx-about-ptbr');
    const problem = api.getIndexProblems().find((recorded) => recorded.path === pagePath);
    expect(problem?.message).toContain(createRefusal('pt-br'));
    expect(warnings().some((warning) => warning.includes('without a locale suffix'))).toBe(false);
  });

  test('a page file whose name carries no locale is reported as an index problem', async () => {
    await writeFile(
      join(contentRoot, 'sites.json'),
      JSON.stringify({ sites: { default: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] }),
    );
    const pagePath = join(contentRoot, 'default/pages/orphan.vxjson');
    await writeFile(pagePath, pageBytes('vx-orphan', 'Orphan'));

    const api = await FileSystemContentAPI.create({ contentRoot });

    const problem = api.getIndexProblems().find((recorded) => recorded.path === pagePath);
    expect(problem?.message).toContain('orphan.vxjson');
    expect(problem?.message).toContain('no locale');
  });
});
