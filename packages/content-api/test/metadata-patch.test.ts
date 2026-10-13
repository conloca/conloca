import { describe, expect, it } from 'bun:test';
import { applyMetaPatch, applyNullClearPatch } from '../src/content-utils.js';
import type { ContentMetaPatch } from '../src/types.js';

describe('metadata patches', () => {
  it('treats a JSON __proto__ field as data without changing the result prototype', () => {
    const patch: ContentMetaPatch = JSON.parse('{"__proto__":{"inherited":"not metadata"},"description":null}');
    const current = { title: 'Page', description: 'Remove me' };
    const result = applyMetaPatch(current, patch);

    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.hasOwn(result, '__proto__')).toBe(true);
    expect(result.inherited).toBeUndefined();
    expect(JSON.parse(JSON.stringify(result))).toEqual(
      JSON.parse('{"title":"Page","__proto__":{"inherited":"not metadata"}}'),
    );
    expect(current).toEqual({ title: 'Page', description: 'Remove me' });
  });

  it('preserves falsy values and omitted fields while removing only explicit nulls', () => {
    const current = { title: 'Page', description: 'Keep', count: 3, enabled: true, category: 'Old' };
    expect(applyNullClearPatch(current, { description: undefined, count: 0, enabled: false, category: null })).toEqual({
      title: 'Page',
      description: 'Keep',
      count: 0,
      enabled: false,
    });
  });
});
