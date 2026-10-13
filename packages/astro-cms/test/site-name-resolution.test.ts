import { describe, expect, test } from 'bun:test';

import { resolveSiteName } from '../src/lib/resolve-site-name.js';

describe('resolveSiteName', () => {
  test('prefers an explicitly configured site name', () => {
    expect(resolveSiteName('marketing', { blog: {}, marketing: {} })).toBe('marketing');
  });

  test('falls back to the first site in sites.json when none is configured', () => {
    expect(resolveSiteName(undefined, { marketing: {}, blog: {} })).toBe('marketing');
  });

  test("falls back to 'default' only when sites.json declares no sites", () => {
    expect(resolveSiteName(undefined, {})).toBe('default');
  });

  test('returns the configured name even when it is absent from sites.json, so the caller can report it', () => {
    expect(resolveSiteName('typo', { marketing: {} })).toBe('typo');
  });
});
