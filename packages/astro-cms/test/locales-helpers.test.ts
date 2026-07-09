import { describe, expect, test } from 'vitest';
import { localesFromAstroI18n, localesFromStarlight } from '../src/locales-helpers';

describe('localesFromAstroI18n', () => {
  test('flattens bare string locales', () => {
    expect(
      localesFromAstroI18n({
        defaultLocale: 'en',
        locales: ['en', 'de', 'fr'],
      }),
    ).toEqual({ defaultLocale: 'en', list: ['en', 'de', 'fr'] });
  });

  test('expands { codes, path } entries into their codes', () => {
    expect(
      localesFromAstroI18n({
        defaultLocale: 'en',
        locales: ['en', { codes: ['es', 'es-MX'], path: 'spanish' }, 'de'],
      }),
    ).toEqual({ defaultLocale: 'en', list: ['en', 'es', 'es-MX', 'de'] });
  });

  test('handles empty locales array (defaultLocale stays)', () => {
    expect(localesFromAstroI18n({ defaultLocale: 'en', locales: [] })).toEqual({
      defaultLocale: 'en',
      list: [],
    });
  });
});

describe('localesFromStarlight', () => {
  test('extracts locale keys from the locales record', () => {
    expect(
      localesFromStarlight({
        defaultLocale: 'en',
        locales: {
          en: { label: 'English' },
          de: { label: 'Deutsch' },
        },
      }),
    ).toEqual({ defaultLocale: 'en', list: ['en', 'de'] });
  });

  test('falls back to the first key when defaultLocale is omitted', () => {
    expect(
      localesFromStarlight({
        locales: { de: { label: 'Deutsch' }, fr: { label: 'Français' } },
      }),
    ).toEqual({ defaultLocale: 'de', list: ['de', 'fr'] });
  });

  test('handles a Starlight config with only defaultLocale', () => {
    expect(localesFromStarlight({ defaultLocale: 'en' })).toEqual({
      defaultLocale: 'en',
      list: ['en'],
    });
  });

  test('falls back to "en" when both fields are missing', () => {
    expect(localesFromStarlight({})).toEqual({ defaultLocale: 'en', list: ['en'] });
  });
});
