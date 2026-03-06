import { describe, expect, test } from 'bun:test';
import { validateFetchUrl } from '../src/url-validation';

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
