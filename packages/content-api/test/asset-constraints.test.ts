import { describe, expect, test } from 'bun:test';
import { DEFAULT_ACCEPTED_FORMATS, DEFAULT_MAX_FILE_SIZE, IMAGE_EXTENSION_MIME } from '../src/asset-constraints.js';
import * as browserEntry from '../src/index.js';

/**
 * The upload ceiling and the image allowlist are a cross-package contract:
 * the values here are the source of truth and other asset backends consume
 * them. They therefore have to live in a module with no `node:` imports so a
 * runtime without `node:fs` can reach them through the browser entry.
 */
describe('asset upload constraints', () => {
  test('the ceiling is 10 MB', () => {
    expect(DEFAULT_MAX_FILE_SIZE).toBe(10 * 1024 * 1024);
  });

  test('the allowlist is images only, raster plus SVG and ICO', () => {
    expect([...DEFAULT_ACCEPTED_FORMATS].sort()).toEqual(
      ['avif', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'webp'].sort(),
    );
  });

  test('every accepted extension maps to a canonical content type', () => {
    for (const ext of DEFAULT_ACCEPTED_FORMATS) {
      expect(IMAGE_EXTENSION_MIME[ext]).toMatch(/^image\//);
    }
    expect([...new Set<string>(Object.values(IMAGE_EXTENSION_MIME))].sort()).toEqual(
      ['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/svg+xml', 'image/webp', 'image/x-icon'].sort(),
    );
  });

  test('the MIME map carries a null prototype so inherited keys never resolve', () => {
    // Backends look extensions up by arbitrary user-supplied strings; on a
    // plain object, `constructor` and `__proto__` would resolve to inherited
    // values and pass an allowlist gate.
    expect(Object.getPrototypeOf(IMAGE_EXTENSION_MIME)).toBeNull();
    expect(IMAGE_EXTENSION_MIME.constructor).toBeUndefined();
    expect(IMAGE_EXTENSION_MIME.toString).toBeUndefined();
  });

  test('the own keys are exactly the eight extensions', () => {
    // Guards the way the prototype is nulled: a `__proto__` entry in an object
    // literal sets the prototype rather than becoming an own key, so a form
    // that leaked it as a real key would surface here (and in the accepted formats).
    expect(Object.keys(IMAGE_EXTENSION_MIME).sort()).toEqual(
      ['avif', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'webp'].sort(),
    );
  });

  test('the accepted formats are exactly the keys of the MIME map', () => {
    expect([...DEFAULT_ACCEPTED_FORMATS].sort()).toEqual(Object.keys(IMAGE_EXTENSION_MIME).sort());
  });

  test('the browser entry re-exports the upload constraints and the fetch-host guard', () => {
    expect(browserEntry.DEFAULT_MAX_FILE_SIZE).toBe(DEFAULT_MAX_FILE_SIZE);
    expect(browserEntry.IMAGE_EXTENSION_MIME).toBe(IMAGE_EXTENSION_MIME);
    expect(typeof browserEntry.isPrivateFetchHost).toBe('function');
  });
});
