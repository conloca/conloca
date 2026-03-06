import { describe, expect, test } from 'bun:test';
import { safeJsonStringify } from '../src/safe-json-stringify';

describe('safeJsonStringify', () => {
  test('escapes </script> to use unicode escapes', () => {
    const input = { value: '</script>' };
    const result = safeJsonStringify(input);
    expect(result).not.toContain('</script>');
    expect(result).toContain('\\u003c/script\\u003e');
  });

  test('escapes <!-- HTML comment opener', () => {
    const input = { value: '<!-- comment -->' };
    const result = safeJsonStringify(input);
    expect(result).not.toContain('<!--');
    expect(result).toContain('\\u003c!--');
  });

  test('escapes lone < and > characters to \\u003c and \\u003e', () => {
    const input = { value: 'a < b > c' };
    const result = safeJsonStringify(input);
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).toContain('\\u003c');
    expect(result).toContain('\\u003e');
  });

  test('escapes & to \\u0026', () => {
    const input = { value: 'a & b' };
    const result = safeJsonStringify(input);
    expect(result).not.toContain('&');
    expect(result).toContain('\\u0026');
  });

  test("escapes single quote ' to \\u0027", () => {
    const input = { value: "it's dangerous" };
    const result = safeJsonStringify(input);
    expect(result).not.toContain("'");
    expect(result).toContain('\\u0027');
  });

  test('produces valid JSON that JSON.parse can round-trip back to original value', () => {
    const input = { value: '</script><b>alert("xss")</b>' };
    const result = safeJsonStringify(input);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual(input);
  });

  test('handles nested objects with dangerous values', () => {
    const input = {
      outer: {
        inner: '</script>',
        array: ['<img>', '<!--', "it's"],
      },
    };
    const result = safeJsonStringify(input);
    expect(result).not.toContain('</script>');
    expect(result).not.toContain('<img>');
    expect(result).not.toContain('<!--');
    expect(result).not.toContain("'");
    // Round-trip fidelity
    const parsed = JSON.parse(result);
    expect(parsed).toEqual(input);
  });

  test('handles null/undefined/numbers (non-string values pass through normally)', () => {
    expect(safeJsonStringify(null)).toBe('null');
    expect(safeJsonStringify(undefined)).toBe(undefined);
    expect(safeJsonStringify(42)).toBe('42');
    expect(safeJsonStringify(true)).toBe('true');
    expect(safeJsonStringify({ count: 0, active: false })).toBe('{"count":0,"active":false}');
  });
});
