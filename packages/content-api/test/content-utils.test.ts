import { describe, expect, test } from 'bun:test';
import {
  extractBlockName,
  generateContentId,
  getCurrentISODate,
  isContentPublished,
  isMetadataTooLarge,
  resolvePublishDate,
} from '../src/content-utils';

describe('content-utils', () => {
  describe('isContentPublished', () => {
    test('returns true when no publish dates are set', () => {
      const meta = {};
      expect(isContentPublished(meta)).toBe(true);
    });

    test('returns false when publishAt is in the future', () => {
      const future = new Date();
      future.setDate(future.getDate() + 1);
      const meta = { publishAt: future.toISOString() };
      expect(isContentPublished(meta)).toBe(false);
    });

    test('returns true when publishAt is in the past', () => {
      const past = new Date();
      past.setDate(past.getDate() - 1);
      const meta = { publishAt: past.toISOString() };
      expect(isContentPublished(meta)).toBe(true);
    });

    test('returns false when unpublishAt is in the past', () => {
      const past = new Date();
      past.setDate(past.getDate() - 1);
      const meta = { unpublishAt: past.toISOString() };
      expect(isContentPublished(meta)).toBe(false);
    });

    test('respects both publishAt and unpublishAt', () => {
      const past = new Date();
      past.setDate(past.getDate() - 2);
      const future = new Date();
      future.setDate(future.getDate() + 1);

      const meta = {
        publishAt: past.toISOString(),
        unpublishAt: future.toISOString(),
      };
      expect(isContentPublished(meta)).toBe(true);
    });

    test('uses provided now parameter', () => {
      const publishAt = new Date('2024-01-15');
      const unpublishAt = new Date('2024-01-20');
      const meta = {
        title: 'Test',
        publishAt: publishAt.toISOString(),
        unpublishAt: unpublishAt.toISOString(),
      };

      // Before publish
      expect(isContentPublished(meta, new Date('2024-01-10'))).toBe(false);
      // During publish window
      expect(isContentPublished(meta, new Date('2024-01-17'))).toBe(true);
      // After unpublish
      expect(isContentPublished(meta, new Date('2024-01-25'))).toBe(false);
    });

    test('handles falsy date values gracefully', () => {
      // Empty string dates should be treated as not set
      expect(isContentPublished({ publishAt: '' })).toBe(true);
      expect(isContentPublished({ unpublishAt: '' })).toBe(true);
      expect(isContentPublished({ publishAt: '', unpublishAt: '' })).toBe(true);

      // Invalid date strings should be treated as not set
      expect(isContentPublished({ publishAt: 'invalid-date' })).toBe(true);
      expect(isContentPublished({ unpublishAt: 'not-a-date' })).toBe(true);

      // Null/undefined values should work (TypeScript allows these in Pick)
      expect(isContentPublished({ publishAt: null as any })).toBe(true);
      expect(isContentPublished({ unpublishAt: undefined as any })).toBe(true);
    });
  });

  describe('isMetadataTooLarge', () => {
    test('returns false for small metadata', () => {
      const meta = { title: 'Test', description: 'A short description' };
      expect(isMetadataTooLarge(meta)).toBe(false);
    });

    test('returns true for metadata over 4KB', () => {
      const meta = {
        title: 'Test',
        // Create a string larger than 4KB
        longField: 'x'.repeat(5000),
      };
      expect(isMetadataTooLarge(meta)).toBe(true);
    });

    test('handles nested objects', () => {
      const meta = {
        title: 'Test',
        nested: {
          deep: {
            field: 'x'.repeat(5000),
          },
        },
      };
      expect(isMetadataTooLarge(meta)).toBe(true);
    });
  });

  describe('extractBlockName', () => {
    test('extracts name from .mdx filename', () => {
      expect(extractBlockName('hero.en.mdx')).toBe('hero');
      expect(extractBlockName('feature-grid.nl.mdx')).toBe('feature-grid');
      expect(extractBlockName('cta.mdx')).toBe('cta');
    });

    test('extracts name from collection/name path', () => {
      expect(extractBlockName('heroes/main')).toBe('main');
      expect(extractBlockName('features/grid')).toBe('grid');
    });

    test('creates name from content ID', () => {
      expect(extractBlockName('vx-12345678')).toBe('block-12345');
    });

    test('returns source for unrecognized formats', () => {
      expect(extractBlockName('some-random-string')).toBe('some-random-string');
    });
  });

  describe('generateContentId', () => {
    test('generates ID with correct format', () => {
      const id = generateContentId();
      expect(id).toMatch(/^vx-[a-zA-Z0-9_-]{8}$/);
    });

    test('generates unique IDs', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateContentId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('getCurrentISODate', () => {
    test('returns ISO date string', () => {
      const date = getCurrentISODate();
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    test('returns current time', () => {
      const before = new Date().toISOString();
      const date = getCurrentISODate();
      const after = new Date().toISOString();

      expect(date >= before).toBe(true);
      expect(date <= after).toBe(true);
    });
  });

  describe('resolvePublishDate', () => {
    test('returns string value when updateValue is a valid string', () => {
      expect(resolvePublishDate('2024-01-01', undefined)).toBe('2024-01-01');
      expect(resolvePublishDate('2024-01-01', '2023-01-01')).toBe('2024-01-01');
    });

    test('returns undefined when updateValue is null or false', () => {
      const result1 = resolvePublishDate(null, '2023-01-01');
      const result2 = resolvePublishDate(false, '2023-01-01');
      expect(result1).toBeUndefined();
      expect(result2).toBeUndefined();
    });

    test('returns undefined when updateValue is empty string', () => {
      expect(resolvePublishDate('', '2023-01-01')).toBeUndefined();
    });

    test('returns current value when updateValue is undefined', () => {
      expect(resolvePublishDate(undefined, '2023-01-01')).toBe('2023-01-01');
      expect(resolvePublishDate(undefined, undefined)).toBeUndefined();
    });

    test('explicitly set values override current values', () => {
      // Setting null clears the date
      expect(resolvePublishDate(null, '2023-01-01')).toBeUndefined();
      // Setting false clears the date
      expect(resolvePublishDate(false, '2023-01-01')).toBeUndefined();
      // Setting empty string clears the date
      expect(resolvePublishDate('', '2023-01-01')).toBeUndefined();
    });
  });
});
