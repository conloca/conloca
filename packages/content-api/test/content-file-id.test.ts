import { describe, expect, it } from 'bun:test';
import { contentFileId } from '../src/content-file-id.js';
import { parseContentHeader } from '../src/header-parser.js';

const enc = new TextEncoder();

/** The id the index records for the same bytes under a content-layout path. */
function indexedId(layoutPath: string, bytes: Uint8Array): string | undefined {
  const parsed = parseContentHeader({ path: layoutPath, header: bytes, size: bytes.byteLength, complete: true });
  return parsed.ok ? parsed.manifest.id : undefined;
}

describe('contentFileId', () => {
  it('reads the id the index knows a file by, whatever its repository path', () => {
    // Over 4 KB with `id` after `content` and a trailing newline: the index
    // reads it only once canonicalized.
    const large = enc.encode(`${JSON.stringify({ content: { data: { heading: 'x'.repeat(4096) } }, id: 'hero' })}\n`);
    expect(contentFileId('site/content/fragments/hero.en.vxjson', large)).toBe('hero');
    expect(indexedId('fragments/general/hero.en.vxjson', large)).toBe('hero');

    // Frontmatter goes through the index's YAML parser: comments and CRLF included.
    for (const mdx of ['---\nid: hero # shared\n---\nBody\n', '---\r\nid: hero\r\n---\r\nBody\r\n']) {
      expect(contentFileId('docs/hero.mdx', enc.encode(mdx))).toBe('hero');
      expect(indexedId('fragments/general/hero.en.mdx', enc.encode(mdx))).toBe('hero');
    }
    expect(contentFileId('data/hero.json', enc.encode('{"id":"hero"}'))).toBe('hero');
  });

  it('answers null for a file that is not content, cannot be parsed or declares no id', () => {
    expect(contentFileId('README.md', enc.encode('# hero'))).toBeNull();
    expect(contentFileId('data/x.json', enc.encode('{"title":"no id"}'))).toBeNull();
    expect(contentFileId('data/x.json', enc.encode('not json'))).toBeNull();
    expect(contentFileId('data/x.vxjson', enc.encode('null'))).toBeNull();
    expect(contentFileId('docs/x.mdx', enc.encode('---\n['))).toBeNull();
    expect(contentFileId('docs/x.mdx', enc.encode('---\nid: 7\n---\n'))).toBeNull();
  });
});
