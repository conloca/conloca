import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';

/** Content root with one valid site config and one unparseable page. */
function seedRootWithBrokenFile(): string {
  const root = mkdtempSync(join(tmpdir(), 'conloca-diag-'));
  mkdirSync(join(root, 'default', 'pages'), { recursive: true });
  writeFileSync(
    join(root, 'sites.json'),
    JSON.stringify({ sites: { default: { defaultLocale: 'en', locales: ['en'] } } }),
  );
  writeFileSync(join(root, 'default', 'pages', 'broken.en.vxjson'), 'THIS IS NOT JSON');
  return root;
}

/**
 * Same, plus one readable page — so the index is NOT empty afterwards, which
 * is what makes a later API instance skip indexing and reuse the cached index.
 */
function seedRootWithBrokenAndReadableFile(): string {
  const root = seedRootWithBrokenFile();
  writeFileSync(
    join(root, 'default', 'pages', 'readable.en.vxjson'),
    JSON.stringify({
      id: 'readable-page',
      type: 'puck',
      kind: 'page',
      site: 'default',
      collection: 'pages',
      pathname: '/readable',
      created: '2020-01-01T00:00:00.000Z',
      modified: '2020-01-01T00:00:00.000Z',
      meta: { title: 'Readable' },
      content: { root: {}, content: [] },
    }),
  );
  return root;
}

describe('FileSystemContentAPI indexing diagnostics', () => {
  it('reports the unreadable file instead of silently dropping it', async () => {
    const root = seedRootWithBrokenFile();
    try {
      const api = await FileSystemContentAPI.create({ contentRoot: root });
      const problems = api.getIndexProblems();
      expect(problems).toHaveLength(1);
      expect(problems[0]?.path).toContain('broken.en.vxjson');
      expect(problems[0]?.message).toBeTruthy();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps the broken file out of the content listing', async () => {
    const root = seedRootWithBrokenFile();
    try {
      const api = await FileSystemContentAPI.create({ contentRoot: root });
      expect([...api.listAllContent()]).toHaveLength(0);
      expect(api.getIndexProblems()).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports the same problems to a second API over the same content root', async () => {
    const root = seedRootWithBrokenAndReadableFile();
    try {
      const first = await FileSystemContentAPI.create({ contentRoot: root });
      expect([...first.listAllContent()]).toHaveLength(1);
      expect(first.getIndexProblems()).toHaveLength(1);

      // The index is cached per content root, so this instance never indexes.
      // The problems belong to that index, not to whoever hydrated it.
      const second = await FileSystemContentAPI.create({ contentRoot: root });
      expect([...second.listAllContent()]).toHaveLength(1);
      const problems = second.getIndexProblems();
      expect(problems).toHaveLength(1);
      expect(problems[0]?.path).toContain('broken.en.vxjson');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('FileSystemContentAPI indexing diagnostics logging', () => {
  it('logs the unreadable file without handing console a raw Error', async () => {
    const root = seedRootWithBrokenFile();
    const originalError = console.error;
    const calls: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      calls.push(args);
    };
    let recorded: string;
    try {
      const api = await FileSystemContentAPI.create({ contentRoot: root });
      recorded = api.getIndexProblems()[0]?.message ?? '';
    } finally {
      console.error = originalError;
      rmSync(root, { recursive: true, force: true });
    }

    // The line dev users rely on stays: it names the file and carries the same
    // reason the recorded problem does.
    expect(recorded).toBeTruthy();
    const logged = calls.map((args) => args.map((arg) => String(arg)).join(' '));
    const indexLine = logged.find((line) => line.includes('broken.en.vxjson'));
    expect(indexLine).toBeDefined();
    expect(indexLine).toContain(recorded);

    // A raw Error argument makes the console print its stack, which for an
    // indexing failure is frames of library internals — noise ahead of the
    // caller's own report. The recorded problem message carries the signal.
    const errorArguments = calls.flat().filter((arg) => arg instanceof Error);
    expect(errorArguments).toEqual([]);
  });
});
