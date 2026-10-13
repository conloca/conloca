import { describe, expect, test } from 'bun:test';
import { isPrivateFetchHost, validateFetchUrl } from '../src/url-validation.js';

describe('validateFetchUrl', () => {
  describe('valid public URLs', () => {
    test('accepts http URL to public domain', () => {
      expect(() => validateFetchUrl('http://example.com/image.jpg')).not.toThrow();
    });

    test('accepts https URL to CDN', () => {
      expect(() => validateFetchUrl('https://cdn.example.com/photo.png')).not.toThrow();
    });

    test('accepts 172.32.0.1 (outside private 172.16-31 range)', () => {
      expect(() => validateFetchUrl('http://172.32.0.1/x')).not.toThrow();
    });

    test('returns parsed URL object on success', () => {
      const result = validateFetchUrl('https://example.com/img.jpg');
      expect(result).toBeInstanceOf(URL);
      expect(result.hostname).toBe('example.com');
    });
  });

  describe('blocked private/reserved IP addresses', () => {
    test('rejects loopback 127.0.0.1', () => {
      expect(() => validateFetchUrl('http://127.0.0.1/secret')).toThrow('URL points to a private/reserved IP address');
    });

    test('rejects localhost written as a fully-qualified name (trailing root dot)', () => {
      // `http://localhost./x` parses to the hostname `localhost.`, which
      // resolves to loopback exactly like `localhost`.
      expect(() => validateFetchUrl('http://localhost./x')).toThrow('URL points to a private/reserved IP address');
    });

    test('rejects localhost', () => {
      expect(() => validateFetchUrl('http://localhost/secret')).toThrow('URL points to a private/reserved IP address');
    });

    test('rejects Class A private 10.0.0.1', () => {
      expect(() => validateFetchUrl('http://10.0.0.1/internal')).toThrow('URL points to a private/reserved IP address');
    });

    test('rejects Class B private 172.16.0.1', () => {
      expect(() => validateFetchUrl('http://172.16.0.1/internal')).toThrow(
        'URL points to a private/reserved IP address',
      );
    });

    test('rejects top end of 172.16-31 range (172.31.255.255)', () => {
      expect(() => validateFetchUrl('http://172.31.255.255/x')).toThrow('URL points to a private/reserved IP address');
    });

    test('rejects Class C private 192.168.1.1', () => {
      expect(() => validateFetchUrl('http://192.168.1.1/router')).toThrow(
        'URL points to a private/reserved IP address',
      );
    });

    test('rejects link-local / cloud metadata 169.254.169.254', () => {
      expect(() => validateFetchUrl('http://169.254.169.254/metadata')).toThrow(
        'URL points to a private/reserved IP address',
      );
    });

    test('rejects IPv6 loopback [::1]', () => {
      expect(() => validateFetchUrl('http://[::1]/secret')).toThrow('URL points to a private/reserved IP address');
    });

    test('rejects unspecified address 0.0.0.0', () => {
      expect(() => validateFetchUrl('http://0.0.0.0/x')).toThrow('URL points to a private/reserved IP address');
    });

    test('rejects the IPv4-mapped IPv6 form of loopback [::ffff:127.0.0.1]', () => {
      expect(() => validateFetchUrl('http://[::ffff:127.0.0.1]/x')).toThrow(
        'URL points to a private/reserved IP address',
      );
    });
  });

  describe('blocked URL schemes', () => {
    test('rejects file:// scheme', () => {
      expect(() => validateFetchUrl('file:///etc/passwd')).toThrow('URL scheme must be http or https');
    });

    test('rejects ftp:// scheme', () => {
      expect(() => validateFetchUrl('ftp://ftp.example.com/file')).toThrow('URL scheme must be http or https');
    });

    test('rejects data: scheme', () => {
      expect(() => validateFetchUrl('data:text/html,<h1>hi</h1>')).toThrow('URL scheme must be http or https');
    });

    test('rejects javascript: scheme', () => {
      expect(() => validateFetchUrl('javascript:alert(1)')).toThrow();
    });
  });

  describe('invalid URLs', () => {
    test('rejects non-URL string', () => {
      expect(() => validateFetchUrl('not-a-url')).toThrow();
    });

    test('rejects empty string', () => {
      expect(() => validateFetchUrl('')).toThrow();
    });
  });
});

describe('isPrivateFetchHost', () => {
  test('accepts a public hostname and a public address', () => {
    expect(isPrivateFetchHost('example.com')).toBe(false);
    expect(isPrivateFetchHost('8.8.8.8')).toBe(false);
    expect(isPrivateFetchHost('172.32.0.1')).toBe(false);
  });

  test('rejects the blocked names and every private/reserved range', () => {
    expect(isPrivateFetchHost('localhost')).toBe(true);
    expect(isPrivateFetchHost('LOCALHOST')).toBe(true);
    expect(isPrivateFetchHost('0.0.0.1')).toBe(true);
    expect(isPrivateFetchHost('10.0.0.1')).toBe(true);
    expect(isPrivateFetchHost('127.0.0.1')).toBe(true);
    expect(isPrivateFetchHost('169.254.169.254')).toBe(true);
    expect(isPrivateFetchHost('172.16.0.1')).toBe(true);
    expect(isPrivateFetchHost('192.168.1.1')).toBe(true);
  });

  test('rejects the IPv6 reserved forms in bare form', () => {
    expect(isPrivateFetchHost('::1')).toBe(true);
    expect(isPrivateFetchHost('::')).toBe(true);
    expect(isPrivateFetchHost('fe80::1')).toBe(true);
    expect(isPrivateFetchHost('fd00::1')).toBe(true);
  });

  test('rejects an IPv4-mapped IPv6 address whose embedded v4 is private', () => {
    expect(isPrivateFetchHost('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateFetchHost('[::ffff:127.0.0.1]')).toBe(true);
    // Hex form of the same address (7f00:0001), which is what URL parsing yields.
    expect(isPrivateFetchHost('::ffff:7f00:1')).toBe(true);
    expect(isPrivateFetchHost('::ffff:169.254.169.254')).toBe(true);
    // A mapped PUBLIC address stays reachable — the mapping is not blanket-blocked.
    expect(isPrivateFetchHost('::ffff:8.8.8.8')).toBe(false);
  });

  test('accepts a public domain that merely starts with fc or fd', () => {
    expect(isPrivateFetchHost('fdic.gov')).toBe(false);
    expect(isPrivateFetchHost('fcbarcelona.com')).toBe(false);
    // Real unique-local addresses (fc00::/7) are still rejected.
    expect(isPrivateFetchHost('fd00::1')).toBe(true);
    expect(isPrivateFetchHost('fc00::1')).toBe(true);
  });

  test('strips IPv6 brackets itself, as URL.hostname keeps them', () => {
    expect(isPrivateFetchHost('[::1]')).toBe(true);
    // 2001:db8::/32 is the documentation range; the tables treat it as public —
    // blocking non-private special ranges is the platform blocklist's job.
    expect(isPrivateFetchHost('[2001:db8::1]')).toBe(false);
  });

  test('reads a trailing root-label dot as the same host', () => {
    // The root dot is valid syntax for any name and resolves identically, so
    // it must not carry a host past the tables…
    expect(isPrivateFetchHost('localhost.')).toBe(true);
    expect(isPrivateFetchHost('127.0.0.1.')).toBe(true);
    // …and, being plain syntax rather than a signal, it must not turn a public
    // host into a private one either.
    expect(isPrivateFetchHost('example.com.')).toBe(false);
    expect(isPrivateFetchHost('8.8.8.8.')).toBe(false);
    // Repeated dots are not a valid name, but URL parsing preserves them, so
    // they must not spell a blocked host either.
    expect(isPrivateFetchHost('localhost..')).toBe(true);
  });

  test('is the predicate validateFetchUrl throws on', () => {
    expect(() => validateFetchUrl('http://127.0.0.1/x')).toThrow();
    expect(isPrivateFetchHost('127.0.0.1')).toBe(true);
  });
});
