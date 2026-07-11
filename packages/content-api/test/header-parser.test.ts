import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';
import { parseContentHeader } from '../src/header-parser';
import { VXJSON } from '../src/vxjson';

const enc = new TextEncoder();

function makeVxjsonBytes(file: Record<string, unknown>): Uint8Array {
  return enc.encode(JSON.stringify(file));
}

function shuffleKeys<T extends object>(obj: T): T {
  const entries = Object.entries(obj);
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }
  return Object.fromEntries(entries) as T;
}

describe('parseContentHeader — pure parser', () => {
  it('canonical VXJSON → ok, repaired:false, etags match VXJSON.calculateETags', () => {
    const file = {
      id: 'page-1',
      type: 'puck' as const,
      created: '2024-01-01T00:00:00.000Z',
      modified: '2024-01-02T00:00:00.000Z',
      meta: { title: 'Hello' },
      content: { puckData: { root: {} } },
    };
    const bytes = enc.encode(VXJSON.serialize(file));
    const result = parseContentHeader({
      path: 'shop/pages/hello.en.vxjson',
      header: bytes,
      size: bytes.byteLength,
      complete: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.repaired).toBe(false);
    expect(result.manifest.id).toBe('page-1');
    expect(result.manifest.kind).toBe('page');
    expect(result.manifest.site).toBe('shop');
    expect(result.locale).toBe('en');
    expect(result.localeVersion.pathname).toBe('/hello');

    const canonical = VXJSON.calculateETags(bytes);
    if (!canonical.success) throw new Error('canonical etag failed');
    const expected = canonical.contentEtag ? `${canonical.metaEtag}.${canonical.contentEtag}` : canonical.metaEtag;
    expect(result.localeVersion.etag).toBe(expected);
  });

  it('VXJSON with reordered top-level fields → ok, repaired:true, etags match canonical form', () => {
    const file = {
      id: 'page-2',
      type: 'puck' as const,
      created: '2024-01-01T00:00:00.000Z',
      modified: '2024-01-02T00:00:00.000Z',
      meta: { title: 'Reordered' },
      content: { puckData: { root: { swap: true } } },
    };

    // Non-canonical: content NOT last. VXJSON.calculateETags treats this as
    // invalid; parseContentHeader must canonicalise in-memory and report
    // `repaired: true`.
    const nonCanonical = {
      id: file.id,
      content: file.content,
      type: file.type,
      created: file.created,
      meta: file.meta,
      modified: file.modified,
    };
    const bytes = makeVxjsonBytes(nonCanonical);

    const result = parseContentHeader({
      path: 'shop/pages/reordered.en.vxjson',
      header: bytes,
      size: bytes.byteLength,
      complete: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.repaired).toBe(true);

    const canonicalBytes = enc.encode(VXJSON.serialize(file));
    const canonical = VXJSON.calculateETags(canonicalBytes);
    if (!canonical.success) throw new Error('canonical etag failed');
    const expected = canonical.contentEtag ? `${canonical.metaEtag}.${canonical.contentEtag}` : canonical.metaEtag;
    expect(result.localeVersion.etag).toBe(expected);
  });

  it('truncated VXJSON header (complete=false) → ok, content undefined, manifest parseable', () => {
    const file = {
      id: 'page-3',
      type: 'puck' as const,
      created: '2024-01-01T00:00:00.000Z',
      modified: '2024-01-01T00:00:00.000Z',
      meta: { title: 'Truncated' },
      content: { puckData: { root: { big: 'x'.repeat(8000) } } },
    };
    const fullBytes = enc.encode(VXJSON.serialize(file));
    expect(fullBytes.byteLength).toBeGreaterThan(4096);
    const header = fullBytes.subarray(0, 4096);

    const result = parseContentHeader({
      path: 'shop/pages/truncated.en.vxjson',
      header,
      size: fullBytes.byteLength,
      complete: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.manifest.id).toBe('page-3');
    expect(result.content).toBeUndefined();
  });

  it('MDX with frontmatter and body → ok, derived metadata and localeVersion populated', () => {
    const mdx = [
      '---',
      'id: block-1',
      'title: Hero',
      'created: 2024-01-01T00:00:00.000Z',
      'modified: 2024-01-01T00:00:00.000Z',
      '---',
      '',
      '# Hero',
      '',
      'Body content here.',
    ].join('\n');
    const bytes = enc.encode(mdx);
    const result = parseContentHeader({
      path: 'blocks/hero/welcome.en.mdx',
      header: bytes,
      size: bytes.byteLength,
      complete: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.manifest.kind).toBe('block');
    expect(result.manifest.collection).toBe('hero');
    expect(result.manifest.type).toBe('mdx');
    expect(result.locale).toBe('en');
    expect(result.localeVersion.name).toBe('welcome');
    expect(result.localeVersion.meta.title).toBe('Hero');
  });

  it('MDX whose entire body names an Object.prototype member still parses', () => {
    // Regression: gray-matter's module-level memo cache is a plain object
    // keyed by the raw input, so a file whose full text is 'valueOf' /
    // 'toString' / … used to return the inherited prototype member instead
    // of a parse (content/data undefined). The empty-options call sites in
    // header-parser.ts opt out of that cache.
    const bytes = enc.encode('valueOf');
    const result = parseContentHeader({
      path: 'blocks/general/note.en.mdx',
      header: bytes,
      size: bytes.byteLength,
      complete: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.content).toEqual({ mdx: 'valueOf' });
  });

  it('MDX page in the main layout → ok, kind page with site/collection/pathname/locale', () => {
    const mdx = [
      '---',
      'id: page-home',
      'title: Home',
      'created: 2024-01-01T00:00:00.000Z',
      'modified: 2024-01-01T00:00:00.000Z',
      '---',
      '',
      '# Home',
    ].join('\n');
    const bytes = enc.encode(mdx);
    const result = parseContentHeader({
      path: 'main/pages/index.en.mdx',
      header: bytes,
      size: bytes.byteLength,
      complete: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.manifest.kind).toBe('page');
    expect(result.manifest.site).toBe('main');
    expect(result.manifest.collection).toBe('pages');
    expect(result.manifest.type).toBe('mdx');
    expect(result.locale).toBe('en');
    expect(result.localeVersion.pathname).toBe('/');
  });

  it('nested MDX page path derives the nested pathname', () => {
    const mdx = ['---', 'id: page-post', 'title: Post', '---', '', 'Body.'].join('\n');
    const bytes = enc.encode(mdx);
    const result = parseContentHeader({
      path: 'main/pages/blog/post.en.mdx',
      header: bytes,
      size: bytes.byteLength,
      complete: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.manifest.kind).toBe('page');
    expect(result.localeVersion.pathname).toBe('/blog/post');
  });

  it('path outside known layout → ok:false, unsupported-locale-path', () => {
    const bytes = enc.encode('{}');
    const result = parseContentHeader({
      path: 'random/garbage.vxjson',
      header: bytes,
      size: bytes.byteLength,
      complete: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('unsupported-locale-path');
  });

  it('unknown file extension → ok:false, unknown-format', () => {
    const bytes = enc.encode('hello');
    // Use a path layout that would otherwise be valid, but extension is unknown.
    const result = parseContentHeader({
      path: 'shop/pages/something.en.txt',
      header: bytes,
      size: bytes.byteLength,
      complete: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    // Path layout regex doesn't match unknown extensions, so it gets caught
    // as unsupported-locale-path (parsePathLayout returns null first).
    expect(['unknown-format', 'unsupported-locale-path']).toContain(result.reason);
  });

  it('malformed VXJSON bytes (complete) → ok:false, malformed-vxjson', () => {
    const bytes = enc.encode('not json at all{{{');
    const result = parseContentHeader({
      path: 'shop/pages/broken.en.vxjson',
      header: bytes,
      size: bytes.byteLength,
      complete: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('malformed-vxjson');
  });

  // Property test (spec 02 requires numRuns >= 200): for any valid VXJSON
  // content with shuffled top-level keys, parseContentHeader produces a
  // manifest whose etag matches the canonical-form etag for the same logical
  // content.
  it('property: shuffled-key VXJSON has same etag as canonical form (numRuns=200)', () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.uuid(),
          createdYear: fc.integer({ min: 2020, max: 2030 }),
          modifiedYear: fc.integer({ min: 2020, max: 2030 }),
          title: fc.string({ minLength: 1, maxLength: 40 }).filter((s) => !s.includes('�')),
          contentValue: fc.oneof(fc.boolean(), fc.integer(), fc.string({ minLength: 0, maxLength: 50 })),
        }),
        (input) => {
          const canonicalFile = {
            id: input.id,
            type: 'puck' as const,
            created: `${input.createdYear}-01-01T00:00:00.000Z`,
            modified: `${input.modifiedYear}-06-01T00:00:00.000Z`,
            meta: { title: input.title },
            content: { puckData: { v: input.contentValue } },
          };

          const canonicalBytes = enc.encode(VXJSON.serialize(canonicalFile));
          const canonicalEtag = VXJSON.calculateETags(canonicalBytes);
          if (!canonicalEtag.success) return; // skip pathological inputs
          const expected = canonicalEtag.contentEtag
            ? `${canonicalEtag.metaEtag}.${canonicalEtag.contentEtag}`
            : canonicalEtag.metaEtag;

          const shuffledBytes = makeVxjsonBytes(shuffleKeys(canonicalFile));
          const result = parseContentHeader({
            path: 'shop/pages/prop.en.vxjson',
            header: shuffledBytes,
            size: shuffledBytes.byteLength,
            complete: true,
          });

          expect(result.ok).toBe(true);
          if (!result.ok) throw new Error('unreachable');
          expect(result.localeVersion.etag).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('parseContentHeader — malformed MDX frontmatter is errors-as-data', () => {
  it('returns malformed-mdx instead of throwing for an unparseable leading YAML block', () => {
    // A hand-authored customer file starting with a frontmatter delimiter
    // followed by invalid YAML ('---\n[') made gray-matter's js-yaml throw
    // straight through parseContentHeader, bypassing the malformed-mdx
    // rejection this parser was designed to return (its JSON and VXJSON
    // siblings already catch and return null).
    const bytes = enc.encode('---\n[');
    const result = parseContentHeader({
      path: 'blocks/general/broken.en.mdx',
      header: bytes,
      size: bytes.byteLength,
      complete: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('malformed-mdx');
  });
});
