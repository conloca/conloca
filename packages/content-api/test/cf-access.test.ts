import { describe, expect, test } from 'bun:test';

import { extractCFAccessToken, validateCFAccessRequest } from '../src/cf-access';

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

describe('validateCFAccessRequest', () => {
  /**
   * Limitation: cf-access.ts reads CF_ACCESS_TEAM_NAME and CF_ACCESS_AUD from env at module load time
   * (lines 11-12) as const bindings. In the test environment, these env vars are not set, so the function
   * always returns { valid: true, required: false } -- the "not configured / local dev" path.
   * Testing the JWT verification path would require refactoring the module to accept config injection.
   */
  test('returns { valid: true, required: false } when env vars not set (local dev)', async () => {
    const request = new Request('http://test.local');
    const result = await validateCFAccessRequest(request);
    expect(result).toEqual({ valid: true, required: false });
  });

  test('returns same result regardless of token presence when not configured', async () => {
    const request = new Request('http://test.local', {
      headers: { 'Cf-Access-Jwt-Assertion': 'some-token' },
    });
    const result = await validateCFAccessRequest(request);
    expect(result).toEqual({ valid: true, required: false });
  });
});
