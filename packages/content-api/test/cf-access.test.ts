import { afterEach, describe, expect, test } from 'bun:test';

import { extractCFAccessToken, validateCFAccessRequest } from '../src/cf-access.js';

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

describe('validateCFAccessRequest configuration', () => {
  const saved = { team: process.env.CF_ACCESS_TEAM_NAME, aud: process.env.CF_ACCESS_AUD };

  function setEnv(team: string | undefined, aud: string | undefined): void {
    if (team === undefined) delete process.env.CF_ACCESS_TEAM_NAME;
    else process.env.CF_ACCESS_TEAM_NAME = team;
    if (aud === undefined) delete process.env.CF_ACCESS_AUD;
    else process.env.CF_ACCESS_AUD = aud;
  }

  afterEach(() => setEnv(saved.team, saved.aud));

  // Setting one of the two variables means Access was meant to be on; treating that as local dev
  // would leave the CMS open to anyone, so a half-set config refuses every request instead.
  test('refuses a request when only the team name is set', async () => {
    setEnv('acme', undefined);
    const result = await validateCFAccessRequest(new Request('http://test.local'));
    expect(result.valid).toBe(false);
    expect(result.required).toBe(true);
  });

  test('refuses a request when only the audience is set', async () => {
    setEnv(undefined, 'aud-tag');
    const result = await validateCFAccessRequest(new Request('http://test.local'));
    expect(result.valid).toBe(false);
    expect(result.required).toBe(true);
  });

  test('a team name with a whitespace-only audience is partial and refuses', async () => {
    setEnv('acme', '  ');
    const result = await validateCFAccessRequest(new Request('http://test.local'));
    expect(result.valid).toBe(false);
    expect(result.required).toBe(true);
  });

  test('skips validation when neither variable is set', async () => {
    setEnv(undefined, undefined);
    expect(await validateCFAccessRequest(new Request('http://test.local'))).toEqual({ valid: true, required: false });
  });

  test('requires a token when both variables are set', async () => {
    setEnv('acme', 'aud-tag');
    expect(await validateCFAccessRequest(new Request('http://test.local'))).toEqual({
      valid: false,
      required: true,
      error: 'No token provided',
    });
  });
});
