import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Tree-shake gate for the @conloca/content-api browser entries.
 *
 * The browser entry must expose schemas, types, validators, and pure
 * utilities without pulling node-only modules (`FileSystemContentAPI`,
 * `ContentIndex`, `parseContentHeader`) or their transitive native deps
 * (`@node-rs/xxhash`, `gray-matter`) into consumers' bundles. We bundle a
 * synthetic entry with Bun's built-in bundler (tree-shaking + minify) and
 * scan the output for symbols and specifiers that must not appear.
 *
 * Bun.build has no stdin, so the entry is written to a temp file that imports the
 * package SOURCE directly (`src/index.ts`) — the test runs from a git worktree
 * that doesn't materialize a `node_modules/@conloca/...` symlink, and pointing at
 * the source mirrors the published artifact, which is `tsc`'s per-file emit of those same sources.
 */
describe('@conloca/content-api tree-shaking', () => {
  const pkgDir = resolve(__dirname, '..');

  // `typia` replaced `zod` in this list with the validator migration. Bun.build
  // does not run the ttsc transform, so the validator module bundles as its
  // untransformed source; the gate is about what gets LINKED IN, and no
  // generated validator is invoked here.
  const external = [
    'node:*',
    'crypto',
    '@node-rs/*',
    'fast-glob',
    'gray-matter',
    'nanoid',
    'yaml',
    'sort-keys',
    'typia',
  ];

  async function bundle(entrySource: (src: string) => string, entryModule: string): Promise<string> {
    // Temp dir INSIDE the package so bare imports resolve up to the real
    // node_modules regardless of the runner's cwd — Bun anchors resolution at the entry.
    const dir = mkdtempSync(join(pkgDir, '.tree-shake-'));
    const entry = join(dir, 'tree-shake-entry.ts');
    writeFileSync(entry, entrySource(join(pkgDir, 'src', entryModule)));
    try {
      const result = await Bun.build({
        entrypoints: [entry],
        root: pkgDir,
        target: 'browser',
        format: 'esm',
        minify: true,
        external,
      });
      expect(result.success).toBe(true);
      return await result.outputs[0].text();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('importing browser-safe symbols does not pull in node-only implementations', async () => {
    const out = await bundle(
      (src) =>
        `import { ErrorCodes, normalizeAndValidatePathname, IMAGE_EXTENSION_MIME } from ${JSON.stringify(src)};\n` +
        'console.log(ErrorCodes, normalizeAndValidatePathname, IMAGE_EXTENSION_MIME);\n',
      'index.ts',
    );
    // Node-only implementations and their native deps must not be linked in
    // by the browser entry — they live behind `@conloca/content-api/node`.
    expect(out).not.toMatch(/FileSystemContentAPI/);
    expect(out).not.toMatch(/@node-rs\/xxhash/);
    expect(out).not.toMatch(/gray-matter/);
  });

  it('the browser barrel re-exports the schema shapes as types only, so no validator code rides along', async () => {
    const out = await bundle(
      (src) => `import { ErrorCodes } from ${JSON.stringify(src)};\nconsole.log(ErrorCodes);\n`,
      'index.ts',
    );
    expect(out).not.toMatch(/typia/);
    expect(out).not.toMatch(/parsePageMeta|parseDataMeta|parseFragmentEditable/);
  });

  it('the schemas subpath carries the validators without dragging node-only modules in', async () => {
    const out = await bundle(
      (src) => `import { parseFragmentEditable } from ${JSON.stringify(src)};\nconsole.log(parseFragmentEditable);\n`,
      join('schemas', 'index.ts'),
    );
    expect(out).toMatch(/typia/);
    expect(out).not.toMatch(/FileSystemContentAPI/);
    expect(out).not.toMatch(/@node-rs\/xxhash/);
    expect(out).not.toMatch(/gray-matter/);
  });
});
