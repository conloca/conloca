import { evaluateMDXToComponent } from './mdx/evaluate.js';
import type { MDXFragmentEvaluationResult } from './types.js';

interface FragmentLocaleSummary {
  meta?: {
    title?: string;
  };
  name?: string;
}

interface FragmentManifest {
  id: string;
  locales: Record<string, FragmentLocaleSummary | undefined>;
}

interface FragmentLocalizedEntry {
  localized?: {
    meta?: {
      title?: string;
    };
    name?: string;
    content?: {
      mdx?: string;
    };
  };
}

interface FragmentAPI {
  listAllContent(filters: { kind: 'fragment' }): Iterable<FragmentManifest>;
  getLocalized(id: string, locale: string): Promise<FragmentLocalizedEntry | null>;
}

/**
 * Evaluate all MDX fragments from a compatible content API.
 *
 * Returns structured success/error results so callers can decide how to
 * surface broken fragments instead of hardcoding fallback UI in this package.
 */
export async function evaluateMDXFragments(api: FragmentAPI, locale: string): Promise<MDXFragmentEvaluationResult[]> {
  const fragments = Array.from(api.listAllContent({ kind: 'fragment' }));

  return Promise.all(
    fragments.map(async (fragment) => {
      const locales = Object.keys(fragment.locales);
      const firstLocale = locales.length > 0 ? fragment.locales[locales[0]] : null;
      const manifestTitle = firstLocale?.meta?.title || firstLocale?.name || fragment.id;

      try {
        const fragmentLocalized = await api.getLocalized(fragment.id, locale);
        const fragmentTitle =
          fragmentLocalized?.localized?.meta?.title || fragmentLocalized?.localized?.name || manifestTitle;
        const mdxContent = fragmentLocalized?.localized?.content?.mdx;

        if (!mdxContent) {
          return {
            ok: false,
            id: fragment.id,
            title: fragmentTitle,
            error: new Error(`No MDX content found for fragment: ${fragment.id}`),
          };
        }

        const { Component: EvaluatedComponent, error, outline } = await evaluateMDXToComponent(mdxContent);

        if (error || !EvaluatedComponent) {
          return {
            ok: false,
            id: fragment.id,
            title: fragmentTitle,
            error: error || new Error(`MDX evaluation failed for fragment: ${fragment.id}`),
          };
        }

        return {
          ok: true,
          id: fragment.id,
          title: fragmentTitle,
          Component: EvaluatedComponent,
          outline,
        };
      } catch (error) {
        return {
          ok: false,
          id: fragment.id,
          title: manifestTitle,
          error: error instanceof Error ? error : new Error(`Failed to evaluate fragment: ${fragment.id}`),
        };
      }
    }),
  );
}
