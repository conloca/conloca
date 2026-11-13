import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';
import { frontMatterText } from '../src/front-matter.js';
import { testTempDir } from './test-temp-dir.js';

/** A three-paragraph body as lines, its middle paragraph opening with `word`. */
const paragraphs = (word: string) => ['First.', '', `${word} paragraph.`, '', 'Third.', ''];

describe('front matter dates in files', () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = testTempDir('content-api-front-matter-dates');
    await mkdir(join(tempDir, 'fragments/general'), { recursive: true });
    const sites = { sites: { default: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] };
    await writeFile(join(tempDir, 'sites.json'), JSON.stringify(sites));
    filePath = join(tempDir, 'fragments/general/notes.en.mdx');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('the repair of a file without id or modified keeps its lines as written and adds the missing keys', async () => {
    const block =
      "title: Notes\ncreated: 2024-01-01\ndate: 2024-01-01\nquoted: '2024-01-01'\nat: 2024-01-01T10:00:00Z\n";
    await writeFile(filePath, `---\n${block}---\n# One\n`);
    await FileSystemContentAPI.create({ contentRoot: tempDir });

    const repaired = frontMatterText(await readFile(filePath, 'utf-8'));
    expect(repaired).toMatch(new RegExp(`^${block}id: \\S+\\nmodified: '\\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z'\\n$`));
  });

  test('a save keeps every date and date-time, quoted or not, as written: only the edit and modified change', async () => {
    const block = [
      'id: fragment-notes',
      'created: 2024-01-01',
      'modified: 2024-01-01',
      'title: Notes',
      'date: 2024-01-01',
      "quoted: '2024-01-01'",
      'at: 2024-01-01T10:00:00Z',
      "quotedAt: '2024-01-01T10:00:00.000Z'",
      '',
    ].join('\n');
    await writeFile(filePath, `---\n${block}---\n# One\n`);
    const api = await FileSystemContentAPI.create({ contentRoot: tempDir });
    const current = await api.getLocalized('fragment-notes', 'en');
    expect(current?.localized.created).toBe('2024-01-01');
    expect(current?.localized.meta).toMatchObject({ date: '2024-01-01', quoted: '2024-01-01' });

    const saved = await api.updateLocalized({
      id: 'fragment-notes',
      locale: 'en',
      data: { content: { mdx: '# One\n' }, meta: { title: 'Renamed' } },
      etag: current?.localized.etag ?? '',
    });
    expect(saved.success).toBe(true);
    const written = frontMatterText(await readFile(filePath, 'utf-8'));
    const modified = /\nmodified: '(\d{4}-\d{2}-\d{2}T[\d:.]+Z)'\n/.exec(written)?.[1];
    expect(written).toBe(block.replace('modified: 2024-01-01', `modified: '${modified}'`).replace('Notes', 'Renamed'));
  });

  test('a save of a CRLF file keeps its comments, quoting and CRLF ends, and only modified changes', async () => {
    const block = [
      'id: fragment-notes',
      'created: 2024-01-01',
      'modified: 2024-01-01',
      '# shown in lists',
      'title: Notes # the page name',
      "quoted: '2024-01-01'",
      '',
    ].join('\r\n');
    await writeFile(filePath, `---\r\n${block}---\r\n# One\r\n`);
    const api = await FileSystemContentAPI.create({ contentRoot: tempDir });
    const current = await api.getLocalized('fragment-notes', 'en');
    const saved = await api.updateLocalized({
      id: 'fragment-notes',
      locale: 'en',
      data: { meta: { title: 'Renamed' } },
      etag: current?.localized.etag ?? '',
    });
    expect(saved.success).toBe(true);
    const file = await readFile(filePath, 'utf-8');
    const modified = /\nmodified: '(\d{4}-\d{2}-\d{2}T[\d:.]+Z)'\r\n/.exec(file)?.[1];
    const expected = block.replace('modified: 2024-01-01', `modified: '${modified}'`).replace('Notes', 'Renamed');
    expect(file).toBe(`---\r\n${expected}---\r\n# One\r\n`);
  });

  test.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
  ])('a raw read of an %s file splits front matter from body as a page read does', async (_name, eol) => {
    await writeFile(filePath, ['---', 'id: fragment-notes', 'title: Notes', '---', '', '# One', ''].join(eol));
    const api = await FileSystemContentAPI.create({ contentRoot: tempDir });
    const raw = await api.getContentAsBuffer('fragment-notes', 'en');
    expect(raw?.etag).toBe((await api.getLocalized('fragment-notes', 'en'))?.localized.etag);
  });

  test.each([
    ['LF', '\n', '\n'],
    ['CRLF', '\r\n', '\r\n'],
    ['LF without a final line end', '\n', ''],
    ['CRLF without a final line end', '\r\n', ''],
  ])('a read of a multi-line %s body and a save of it keep the body byte-equal', async (_n, eol, end) => {
    const block = ['id: fragment-notes', 'title: Notes', 'created: 2026-01-05', "modified: '2026-11-10T13:07:19.432Z'"];
    const lines = ['---', ...block, '---', '', '# One', '', 'Two'];
    const seed = `${lines.join(eol)}${end}`;
    await writeFile(filePath, seed);
    const api = await FileSystemContentAPI.create({ contentRoot: tempDir });
    const current = await api.getLocalized('fragment-notes', 'en');
    const body = `# One${eol}${eol}Two`;
    expect(current?.localized.content).toEqual({ mdx: `${body}${end}` });
    // The editor sends the body back without its final line end.
    const saved = await api.updateLocalized({
      id: 'fragment-notes',
      locale: 'en',
      data: { content: { mdx: body }, meta: { title: 'Renamed' } },
      etag: current?.localized.etag ?? '',
    });
    expect(saved.success).toBe(true);
    const file = await readFile(filePath, 'utf-8');
    const modified = /\nmodified: '(\d{4}-\d{2}-\d{2}T[\d:.]+Z)'\r?\n/.exec(file)?.[1];
    expect(file).toBe(seed.replace('2026-11-10T13:07:19.432Z', modified ?? '').replace('Notes', 'Renamed'));
  });

  test.each([
    ['the body as read', 'Second'],
    ['an edit', 'Edited second'],
  ])('a save of %s of a CRLF multi-paragraph body sent with LF breaks writes CRLF throughout', async (_n, second) => {
    const block = ['id: fragment-notes', 'title: Notes', 'created: 2026-01-05', "modified: '2026-11-10T13:07:19.432Z'"];
    const lines = ['---', ...block, '---', ''];
    await writeFile(filePath, [...lines, ...paragraphs('Second')].join('\r\n'));
    const api = await FileSystemContentAPI.create({ contentRoot: tempDir });
    const current = await api.getLocalized('fragment-notes', 'en');
    const saved = await api.updateLocalized({
      id: 'fragment-notes',
      locale: 'en',
      data: { content: { mdx: paragraphs(second).join('\n').trimEnd() }, meta: { title: 'Renamed' } },
      etag: current?.localized.etag ?? '',
    });
    expect(saved.success).toBe(true);
    const file = await readFile(filePath, 'utf-8');
    const modified = /\nmodified: '(\d{4}-\d{2}-\d{2}T[\d:.]+Z)'\r\n/.exec(file)?.[1] ?? '';
    const expected = [...lines, ...paragraphs(second)].join('\r\n');
    expect(file).toBe(expected.replace('2026-11-10T13:07:19.432Z', modified).replace('Notes', 'Renamed'));
  });

  test.each([
    ['no blank line', '', '\n'],
    ['one blank line', '\n', '\n'],
    ['two blank lines', '\n\n', '\n'],
    ['one blank line, CRLF', '\n', '\r\n'],
  ])('a save keeps %s between the front matter and the body', async (_name, gap, eol) => {
    const text = 'A page whose front matter keeps its dates unquoted.\n';
    const block = [
      '# a comment line',
      'title: Dates check',
      'id: fragment-notes',
      'created: 2026-01-05',
      'date: 2026-02-10 # publish date',
      "modified: '2026-11-10T13:07:19.432Z'",
      '',
    ].join('\n');
    await writeFile(filePath, `---\n${block}---\n${gap}${text}`.replaceAll('\n', eol));
    const api = await FileSystemContentAPI.create({ contentRoot: tempDir });
    const current = await api.getLocalized('fragment-notes', 'en');
    const saved = await api.updateLocalized({
      id: 'fragment-notes',
      locale: 'en',
      data: { content: { mdx: text.replaceAll('\n', eol) }, meta: { title: 'Renamed' } },
      etag: current?.localized.etag ?? '',
    });
    expect(saved.success).toBe(true);
    const file = await readFile(filePath, 'utf-8');
    const modified = /\nmodified: '(\d{4}-\d{2}-\d{2}T[\d:.]+Z)'\r?\n/.exec(file)?.[1];
    const stamped = block.replace(/^modified: .*$/m, `modified: '${modified}'`).replace('Dates check', 'Renamed');
    const expected = `---\n${stamped}---\n${gap}${text}`;
    expect(file).toBe(expected.replaceAll('\n', eol));
  });

  test.each([
    ['the body as the editor sends it', { content: { mdx: 'A page.' } }],
    ['the page settings as they were', { meta: { title: 'Notes' } }],
  ])('a save with no edits leaves the file as it was: %s', async (_name, data) => {
    const file =
      "---\nid: fragment-notes\ncreated: 2026-01-05\ntitle: Notes\nmodified: '2026-11-10T13:07:19.432Z'\n---\n\nA page.\n";
    await writeFile(filePath, file);
    const api = await FileSystemContentAPI.create({ contentRoot: tempDir });
    const current = await api.getLocalized('fragment-notes', 'en');
    const etag = current?.localized.etag ?? '';
    expect((await api.updateLocalized({ id: 'fragment-notes', locale: 'en', data, etag })).success).toBe(true);
    expect(await readFile(filePath, 'utf-8')).toBe(file);
  });

  // A file read gets the created it lacks (the repair above), so a save writes that date, never an empty one.
  test('a save of a file without created writes the date it was read with, never an empty created', async () => {
    const block = "title: Dates check\nid: fragment-notes\nmodified: '2026-11-10T13:07:19.432Z'\n";
    const api = await FileSystemContentAPI.create({ contentRoot: tempDir });
    await writeFile(filePath, `---\n${block}---\n\nA page.\n`);
    const current = await api.getLocalized('fragment-notes', 'en');
    const created = current?.localized.created ?? '';
    expect(created).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    const saved = await api.updateLocalized({
      id: 'fragment-notes',
      locale: 'en',
      data: { content: { mdx: 'An edited page.\n' } },
      etag: current?.localized.etag ?? '',
    });
    expect(saved.success).toBe(true);
    const file = await readFile(filePath, 'utf-8');
    expect(file).toContain(`\ncreated: '${created}'\n`);
    expect(file).not.toContain("created: ''");
    expect(file.endsWith('---\n\nAn edited page.\n')).toBe(true);
  });
});
