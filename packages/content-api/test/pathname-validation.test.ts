import { describe, expect, test } from 'bun:test';
import { normalizeAndValidatePathname } from '../src/content-utils';

describe('normalizeAndValidatePathname', () => {
  describe('silent normalization', () => {
    test('prepends missing leading slash', () => {
      const r = normalizeAndValidatePathname('foo');
      expect(r.valid).toBe(true);
      expect(r.value).toBe('/foo');
    });

    test('collapses doubled slashes', () => {
      const r = normalizeAndValidatePathname('/foo//bar');
      expect(r.valid).toBe(true);
      expect(r.value).toBe('/foo/bar');
    });

    test('collapses leading doubled slashes', () => {
      const r = normalizeAndValidatePathname('//foo');
      expect(r.valid).toBe(true);
      expect(r.value).toBe('/foo');
    });

    test('strips trailing slash', () => {
      const r = normalizeAndValidatePathname('/foo/');
      expect(r.valid).toBe(true);
      expect(r.value).toBe('/foo');
    });

    test('preserves root slash', () => {
      const r = normalizeAndValidatePathname('/');
      expect(r.valid).toBe(true);
      expect(r.value).toBe('/');
    });

    test('trims surrounding whitespace before validating', () => {
      const r = normalizeAndValidatePathname('  /foo  ');
      expect(r.valid).toBe(true);
      expect(r.value).toBe('/foo');
    });
  });

  describe('hard rejects', () => {
    test('rejects empty input', () => {
      const r = normalizeAndValidatePathname('');
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('empty');
    });

    test('rejects whitespace-only input', () => {
      const r = normalizeAndValidatePathname('   ');
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('empty');
    });

    test('rejects null', () => {
      const r = normalizeAndValidatePathname(null);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('empty');
    });

    test('rejects undefined', () => {
      const r = normalizeAndValidatePathname(undefined);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('empty');
    });

    test('rejects internal whitespace', () => {
      const r = normalizeAndValidatePathname('/foo bar');
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('whitespace');
    });

    test('rejects tab character', () => {
      const r = normalizeAndValidatePathname('/foo\tbar');
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('whitespace');
    });

    test('rejects `?`', () => {
      const r = normalizeAndValidatePathname('/foo?x=1');
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('forbidden_char');
    });

    test('rejects `#`', () => {
      const r = normalizeAndValidatePathname('/foo#frag');
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('forbidden_char');
    });

    test('rejects `\\`', () => {
      const r = normalizeAndValidatePathname('/foo\\bar');
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('forbidden_char');
    });

    test('rejects control characters', () => {
      const r = normalizeAndValidatePathname('/foo\x07bar');
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('control_char');
    });

    test('rejects uppercase letters', () => {
      const r = normalizeAndValidatePathname('/About-Us');
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('uppercase');
    });

    test('rejects accented characters', () => {
      const r = normalizeAndValidatePathname('/café');
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('non_ascii');
    });

    test('rejects CJK characters', () => {
      const r = normalizeAndValidatePathname('/日本語');
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('non_ascii');
    });

    test('rejects emoji', () => {
      const r = normalizeAndValidatePathname('/foo🎉');
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('non_ascii');
    });

    test('rejects `..` traversal segment', () => {
      const r = normalizeAndValidatePathname('/foo/../bar');
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('traversal_segment');
    });

    test('rejects `.` segment', () => {
      const r = normalizeAndValidatePathname('/foo/./bar');
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('traversal_segment');
    });

    test('rejects trailing `..`', () => {
      const r = normalizeAndValidatePathname('/foo/..');
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('traversal_segment');
    });

    test('rejects stray dot inside segment', () => {
      const r = normalizeAndValidatePathname('/foo.bar');
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('disallowed_char');
    });

    test('rejects `:` and other URL meta', () => {
      const r = normalizeAndValidatePathname('/foo:bar');
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('disallowed_char');
    });
  });

  describe('happy path', () => {
    test('accepts simple lowercase path', () => {
      const r = normalizeAndValidatePathname('/about');
      expect(r.valid).toBe(true);
      expect(r.value).toBe('/about');
    });

    test('accepts nested path with hyphens', () => {
      const r = normalizeAndValidatePathname('/docs/getting-started');
      expect(r.valid).toBe(true);
      expect(r.value).toBe('/docs/getting-started');
    });

    test('accepts path with digits and underscores', () => {
      const r = normalizeAndValidatePathname('/v2/feature_flag_1');
      expect(r.valid).toBe(true);
      expect(r.value).toBe('/v2/feature_flag_1');
    });
  });

  describe('every result includes a message when invalid', () => {
    test('every reject path carries a non-empty message', () => {
      const cases = [
        '',
        '/foo bar',
        '/foo?x',
        '/foo#x',
        '/foo\\x',
        '/foo\x07',
        '/About',
        '/café',
        '/foo/../bar',
        '/foo.bar',
      ];
      for (const input of cases) {
        const r = normalizeAndValidatePathname(input);
        expect(r.valid).toBe(false);
        expect(r.message).toBeTruthy();
        expect(r.message!.length).toBeGreaterThan(0);
      }
    });
  });
});
