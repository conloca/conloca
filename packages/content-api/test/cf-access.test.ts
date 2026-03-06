import { describe, expect, test } from 'bun:test';

import { extractCFAccessToken } from '../src/cf-access';

describe('extractCFAccessToken', () => {
  test('returns header token from Cf-Access-Jwt-Assertion', () => {
    const request = new Request('http://test.local', {
      headers: { 'Cf-Access-Jwt-Assertion': 'my-jwt-token-123' },
    });
    expect(extractCFAccessToken(request)).toBe('my-jwt-token-123');
  });

  test('returns null when no header or cookie', () => {
    const request = new Request('http://test.local');
    expect(extractCFAccessToken(request)).toBeNull();
  });

  test('extracts token from CF_Authorization cookie when no header', () => {
    const request = new Request('http://test.local', {
      headers: { Cookie: 'CF_Authorization=cookie-jwt-token; other=value' },
    });
    expect(extractCFAccessToken(request)).toBe('cookie-jwt-token');
  });

  test('prefers header over cookie when both present', () => {
    const request = new Request('http://test.local', {
      headers: {
        'Cf-Access-Jwt-Assertion': 'header-token',
        Cookie: 'CF_Authorization=cookie-token',
      },
    });
    expect(extractCFAccessToken(request)).toBe('header-token');
  });

  test('returns null for cookie with wrong name', () => {
    const request = new Request('http://test.local', {
      headers: { Cookie: 'OtherCookie=some-value; session_id=abc' },
    });
    expect(extractCFAccessToken(request)).toBeNull();
  });
});
