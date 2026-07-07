/**
 * A93 Stryker mutation pilot fixture (spec 14 §Conformance tests, §Why these
 * decisions: "Pilot on content-api before rollout"). This file is deliberately
 * a real Vitest spec, separate from the package's normal `bun:test` suite
 * (`vxjson-*.test.ts`) — Stryker's official vitest-runner cannot drive
 * `bun:test`, and per A94 (single-runner policy) this package must not gain a
 * second, permanent bun:test-vs-vitest split for its regular test target.
 * This file is NOT part of the `content-api:test` Nx target; it is read only
 * by `stryker.pilot.config.mjs` via the dedicated `mutation` Nx target, kept
 * intentionally out of the default (build/lint/test) pipelines.
 *
 * Scope: `src/vxjson.ts` only — spec 14's own example of the "VxJSON/
 * content-write path" mutation scope. The assertions below are drawn from
 * the existing bun:test coverage of the same module
 * (vxjson-validation/vxjson-scanning/vxjson-empty-strings.test.ts) so the
 * pilot's mutation score reflects real, already-shipped test intent rather
 * than a thinner ad hoc rewrite.
 */
import { describe, expect, it } from 'vitest';
import type { VXJSONFile } from '../src/types';
import { VXJSON } from '../src/vxjson';

describe('VXJSON.calculateETags — content-last validation', () => {
  it('rejects content not being the last root field', () => {
    const buffer = Buffer.from(
      JSON.stringify({ id: 'x', content: { a: 1 }, meta: { title: 'Test' } }),
      'utf-8',
    ) as Uint8Array;
    const result = VXJSON.calculateETags(buffer);
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.error).toBe('content_not_last');
  });

  it('accepts content as the last root field and returns both etags', () => {
    const buffer = Buffer.from(
      JSON.stringify({ id: 'x', meta: { title: 'Test' }, content: { a: 1 } }),
      'utf-8',
    ) as Uint8Array;
    const result = VXJSON.calculateETags(buffer);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.metaEtag).toBeTruthy();
    expect(result.contentEtag).toBeTruthy();
    expect(result.contentStartPos).toBeGreaterThan(0);
  });

  it('succeeds with no content field at all (contentEtag undefined, contentStartPos -1)', () => {
    const buffer = Buffer.from(JSON.stringify({ id: 'x', meta: { title: 'Test' } }), 'utf-8') as Uint8Array;
    const result = VXJSON.calculateETags(buffer);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.contentEtag).toBeUndefined();
    expect(result.contentStartPos).toBe(-1);
  });

  it('ignores nested "content" keys and only cares about the root-level one', () => {
    const buffer = Buffer.from(
      JSON.stringify({
        id: 'x',
        meta: { nested: { content: 'not root' } },
        content: { nested: { content: 'also not root' } },
      }),
      'utf-8',
    ) as Uint8Array;
    const result = VXJSON.calculateETags(buffer);
    expect(result.success).toBe(true);
  });

  it('rejects duplicate root-level content keys', () => {
    const json = '{"id":"x","content":{"a":1},"meta":{},"content":{"b":2}}';
    const result = VXJSON.calculateETags(Buffer.from(json, 'utf-8') as Uint8Array);
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    // The second "content" key arrives after the first was already found,
    // so it is reported the same way any other post-content key would be.
    expect(result.error).toBe('content_not_last');
  });

  it('does not mistake the string "content" inside a value for the key', () => {
    const json = JSON.stringify({
      id: 'x',
      description: 'mentions "content": but is a string value',
      content: { real: true },
    });
    const result = VXJSON.calculateETags(Buffer.from(json, 'utf-8') as Uint8Array);
    expect(result.success).toBe(true);
  });

  it('rejects malformed JSON (non-object root, unclosed string, unquoted key)', () => {
    const badInputs = ['[{"content":1}]', '"content"', '{"unclosed": "string', '{content: 1}'];
    for (const json of badInputs) {
      const result = VXJSON.calculateETags(Buffer.from(json, 'utf-8') as Uint8Array);
      expect(result.success).toBe(false);
    }
  });

  it('ignores whitespace layout when computing etags (same content -> same etag)', () => {
    const variants = [
      '{"id":"x","content":{"a":1}}',
      '{ "id" : "x" , "content" : { "a" : 1 } }',
      '{\n  "id": "x",\n  "content": {\n    "a": 1\n  }\n}',
    ];
    const etags = variants.map((json) => {
      const result = VXJSON.calculateETags(Buffer.from(json, 'utf-8') as Uint8Array);
      if (!result.success) throw new Error('expected success');
      return `${result.metaEtag}.${result.contentEtag ?? ''}`;
    });
    expect(new Set(etags).size).toBe(1);
  });

  it('finds the exact byte position of the "content" key', () => {
    const data = { id: 'x', meta: { title: 'Test' }, content: { a: 1 } };
    const json = JSON.stringify(data, null, 2);
    const buffer = Buffer.from(json, 'utf-8') as Uint8Array;
    const result = VXJSON.calculateETags(buffer);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.contentStartPos).toBe(json.indexOf('"content":'));
  });
});

describe('VXJSON.parse4KB — first-4KB metadata extraction', () => {
  it('parses a small complete buffer and extracts every field', () => {
    const data = {
      id: 'x',
      created: '2024-01-01',
      modified: '2024-01-02',
      pathname: '/x',
      name: 'X',
      meta: { title: 'Test' },
      content: { a: 1 },
    };
    const buffer = Buffer.from(JSON.stringify(data), 'utf-8') as Uint8Array;
    const parsed = VXJSON.parse4KB(buffer, buffer.length);
    expect(parsed.id).toBe('x');
    expect(parsed.pathname).toBe('/x');
    expect(parsed.name).toBe('X');
    expect(parsed.meta).toEqual({ title: 'Test' });
    expect(parsed.content).toEqual({ a: 1 });
    expect(parsed.contentStartPos).toBeGreaterThan(0);
  });

  it('defaults meta to {} when the field is absent', () => {
    const buffer = Buffer.from(JSON.stringify({ id: 'x' }), 'utf-8') as Uint8Array;
    const parsed = VXJSON.parse4KB(buffer, buffer.length);
    expect(parsed.meta).toEqual({});
  });

  it('throws with a message naming the violation for a truncated, structurally-invalid buffer', () => {
    // A 4096-byte read whose root is an array (not an object), and that
    // neither ends on '}' nor terminates on '"content":', is truncated AND
    // invalid — parse4KB must surface the specific reason.
    const padding = 'x'.repeat(4096 - 10);
    const json = `[${padding}`.padEnd(4096, ' ');
    const buffer = new TextEncoder().encode(json);
    expect(buffer.length).toBe(4096);
    expect(() => VXJSON.parse4KB(buffer, 4096)).toThrow(/Invalid VXJSON format: invalid_json/);
  });

  it('parses a genuinely truncated 4KB read that ends exactly on the content marker', () => {
    const prefix = '{"id":"x","meta":{},';
    const padded = prefix.padEnd(4096 - '"content":'.length, ' ');
    const json = `${padded}"content":`;
    const buffer = new TextEncoder().encode(json);
    expect(buffer.length).toBe(4096);
    const parsed = VXJSON.parse4KB(buffer, 4096);
    expect(parsed.id).toBe('x');
    expect(parsed.contentStartPos).toBeGreaterThan(0);
  });
});

describe('VXJSON.findContentPosition', () => {
  it('returns the content key start position when present', () => {
    const json = JSON.stringify({ id: 'x', content: { a: 1 } });
    expect(VXJSON.findContentPosition(Buffer.from(json, 'utf-8') as Uint8Array)).toBe(json.indexOf('"content"'));
  });

  it('returns -1 when the buffer fails validation', () => {
    const json = '{"id": bad}';
    expect(VXJSON.findContentPosition(Buffer.from(json, 'utf-8') as Uint8Array)).toBe(-1);
  });
});

describe('VXJSON.calculateEtagsOnly / createEtag', () => {
  it('calculateEtagsOnly returns null for an invalid (non-object-root) buffer', () => {
    expect(VXJSON.calculateEtagsOnly(Buffer.from('[1,2,3]', 'utf-8') as Uint8Array)).toBeNull();
  });

  it('createEtag returns null for an invalid (non-object-root) buffer', () => {
    expect(VXJSON.createEtag(Buffer.from('[1,2,3]', 'utf-8') as Uint8Array)).toBeNull();
  });

  it('createEtag joins meta and content etags with a dot when content exists', () => {
    const json = JSON.stringify({ id: 'x', meta: {}, content: { a: 1 } });
    const etag = VXJSON.createEtag(Buffer.from(json, 'utf-8') as Uint8Array);
    expect(etag).toMatch(/^[^.]+\.[^.]+$/);
  });

  it('createEtag returns only the meta etag (no dot) when there is no content field', () => {
    const json = JSON.stringify({ id: 'x', meta: {} });
    const etag = VXJSON.createEtag(Buffer.from(json, 'utf-8') as Uint8Array);
    expect(etag).not.toBeNull();
    expect(etag).not.toContain('.');
  });
});

describe('VXJSON.isValid', () => {
  it('is true for a well-formed VXJSON buffer', () => {
    const json = JSON.stringify({ id: 'x', meta: {}, content: { a: 1 } });
    expect(VXJSON.isValid(Buffer.from(json, 'utf-8') as Uint8Array)).toBe(true);
  });

  it('is false when content is not last', () => {
    const json = JSON.stringify({ id: 'x', content: { a: 1 }, meta: {} });
    expect(VXJSON.isValid(Buffer.from(json, 'utf-8') as Uint8Array)).toBe(false);
  });
});

describe('VXJSON.parse / parseBuffer', () => {
  it('parse round-trips a JSON string to a VXJSONFile', () => {
    const file: VXJSONFile = {
      id: 'x',
      type: 'puck',
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-01T00:00:00Z',
      meta: { title: 'Test' },
      content: { puckData: { root: {}, content: [] } },
    };
    expect(VXJSON.parse(JSON.stringify(file))).toEqual(file);
  });

  it('parseBuffer decodes UTF-8 bytes before parsing', () => {
    const file: VXJSONFile = {
      id: 'x',
      type: 'puck',
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-01T00:00:00Z',
      meta: { title: 'Tëst' },
      content: { puckData: { root: {}, content: [] } },
    };
    const buffer = new TextEncoder().encode(JSON.stringify(file));
    expect(VXJSON.parseBuffer(buffer)).toEqual(file);
  });
});

describe('VXJSON.calculateSimpleEtag', () => {
  it('is deterministic for the same buffer', () => {
    const buffer = Buffer.from('{"a":1}', 'utf-8') as Uint8Array;
    expect(VXJSON.calculateSimpleEtag(buffer)).toBe(VXJSON.calculateSimpleEtag(buffer));
  });

  it('differs for different buffers', () => {
    const a = Buffer.from('{"a":1}', 'utf-8') as Uint8Array;
    const b = Buffer.from('{"a":2}', 'utf-8') as Uint8Array;
    expect(VXJSON.calculateSimpleEtag(a)).not.toBe(VXJSON.calculateSimpleEtag(b));
  });
});

describe('VXJSON.serialize', () => {
  const baseFile: VXJSONFile = {
    id: 'test-123',
    type: 'puck',
    created: '2024-01-01T00:00:00Z',
    modified: '2024-01-01T00:00:00Z',
    meta: { title: 'Test Page' },
    content: { puckData: { root: {}, content: [] } },
  };

  it('throws when content is missing', () => {
    const { content: _content, ...withoutContent } = baseFile;
    expect(() => VXJSON.serialize(withoutContent as VXJSONFile)).toThrow(/requires a "content" field/);
  });

  it('throws when content is explicitly null', () => {
    expect(() => VXJSON.serialize({ ...baseFile, content: null as unknown as VXJSONFile['content'] })).toThrow(
      /requires a "content" field/,
    );
  });

  it('serializes with content as the last field and re-parses to the same shape', () => {
    const serialized = VXJSON.serialize(baseFile);
    expect(serialized.trimEnd().endsWith('}')).toBe(true);
    const parsed = JSON.parse(serialized);
    expect(Object.keys(parsed).at(-1)).toBe('content');
    expect(parsed.content).toEqual(baseFile.content);
  });

  it('sorts metadata keys alphabetically', () => {
    const serialized = VXJSON.serialize(baseFile);
    const parsed = JSON.parse(serialized);
    const { content: _c, ...metaOnly } = parsed;
    expect(Object.keys(metaOnly)).toEqual([...Object.keys(metaOnly)].sort());
  });

  it('strips empty-string fields from metadata but keeps non-empty values', () => {
    const withEmpty: VXJSONFile = {
      ...baseFile,
      meta: { title: 'Test Page', description: '' } as VXJSONFile['meta'],
    };
    const parsed = JSON.parse(VXJSON.serialize(withEmpty));
    expect(parsed.meta.description).toBeUndefined();
    expect(parsed.meta.title).toBe('Test Page');
  });

  it('round-trips through calculateETags to find the same content position it wrote', () => {
    const serialized = VXJSON.serialize(baseFile);
    const buffer = Buffer.from(serialized, 'utf-8') as Uint8Array;
    const result = VXJSON.calculateETags(buffer);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    const decoded = new TextDecoder().decode(buffer.slice(result.contentStartPos, result.contentStartPos + 10));
    expect(decoded).toBe('"content":');
  });

  it('throws a size-violation error when metadata pushes "content": past the 4KB boundary', () => {
    const hugeMeta = { title: 'x'.repeat(5000) } as VXJSONFile['meta'];
    expect(() => VXJSON.serialize({ ...baseFile, meta: hugeMeta })).toThrow(/metadata too large/);
  });
});
