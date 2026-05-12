/**
 * Conloca's view of a site's locales.
 *
 * `list` is the full set of locales the site supports; `defaultLocale`
 * is the one that lives at the root in the `'directory'` mdx-pages
 * strategy. Pass this shape into `conlocaCMS({ locales })`.
 */
export interface ConlocaLocales {
  list: string[];
  defaultLocale: string;
}

/**
 * Translate Astro's native `i18n` config into Conloca's locale shape.
 *
 * Astro 4+ accepts both bare strings and `{ codes, path }` objects in
 * its `locales` array — this helper flattens both forms.
 *
 * Usage:
 * ```ts
 * import { conlocaCMS, localesFromAstroI18n } from '@conloca/astro-cms/node';
 * const i18n = { defaultLocale: 'en', locales: ['en', 'de'] };
 * defineConfig({
 *   i18n,
 *   integrations: [conlocaCMS({ locales: localesFromAstroI18n(i18n) })],
 * });
 * ```
 */
export function localesFromAstroI18n(i18n: {
  defaultLocale: string;
  locales: ReadonlyArray<string | { codes: string[]; path: string }>;
}): ConlocaLocales {
  return {
    defaultLocale: i18n.defaultLocale,
    list: i18n.locales.flatMap((l) => (typeof l === 'string' ? [l] : l.codes)),
  };
}

/**
 * Translate Starlight's i18n config into Conloca's locale shape.
 *
 * Starlight shape: `{ defaultLocale: 'en', locales: { en: { label, lang? }, de: { ... } } }`.
 * The default locale falls back to the first key in `locales` if unset,
 * then to `'en'`.
 *
 * Usage:
 * ```ts
 * import { conlocaCMS, localesFromStarlight } from '@conloca/astro-cms/node';
 * const starlightConfig = { defaultLocale: 'en', locales: { en: { label: 'English' } } };
 * defineConfig({
 *   integrations: [
 *     starlight(starlightConfig),
 *     conlocaCMS({ locales: localesFromStarlight(starlightConfig) }),
 *   ],
 * });
 * ```
 */
export function localesFromStarlight(starlight: {
  defaultLocale?: string;
  locales?: Record<string, { label?: string; lang?: string }>;
}): ConlocaLocales {
  const list = Object.keys(starlight.locales ?? {});
  const fallback = starlight.defaultLocale ?? list[0] ?? 'en';
  return {
    defaultLocale: fallback,
    list: list.length > 0 ? list : [fallback],
  };
}
