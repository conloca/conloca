import { describe, expect, test } from 'bun:test';
import { slugify } from './slugify.js';

describe('slugify', () => {
  test('makes a lowercase, hyphenated name out of a title', () => {
    expect(slugify('My Fragment Name!')).toBe('my-fragment-name');
    expect(slugify('  Hello World  ')).toBe('hello-world');
  });

  test('keeps the base letter of an accented Latin letter', () => {
    expect(slugify('Über uns')).toBe('uber-uns');
    expect(slugify('Café')).toBe('cafe');
    expect(slugify('naïve résumé')).toBe('naive-resume');
  });

  test('still gives an empty name for a title written only in another script', () => {
    expect(slugify('Фото галерея')).toBe('');
    expect(slugify('照片')).toBe('');
  });
});
