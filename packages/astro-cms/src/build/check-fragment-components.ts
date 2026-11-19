import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { isContentPublished } from '@conloca/content-api';
import { FileSystemContentAPI } from '@conloca/content-api/node';
import { findUnknownFragmentComponents } from '@conloca/mdx/render';
import type { UserConfig } from 'vite';
import { islandVocabulary } from '../components/FragmentIsland.js';
import { fragmentVocabularyOf } from '../handlers/page-render-core.js';
import { loadFragmentRender } from './fragment-render-load.js';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Problem lines for every fragment the site may serve (live or scheduled, not expired) that fails to parse or uses a
 * component `fragmentComponentsPath` does not declare, and for a `withHydration()` component the build cannot map to
 * a module: that one fails every page with fragments, so the build fails here whatever the output mode. A module that
 * cannot load here only warns and skips the name check, because a module Astro builds may not load outside Astro's own
 * pipeline.
 */
export async function checkFragmentComponents(input: {
  contentRoot: string;
  root: string;
  vite: UserConfig;
  fragmentComponentsPath: string | undefined;
  logger: { warn(message: string): void };
}): Promise<string[]> {
  const { root, fragmentComponentsPath } = input;
  const problems: string[] = [];
  let names: ReadonlySet<string> | undefined = new Set();
  if (fragmentComponentsPath) {
    try {
      const module = await loadFragmentRender({ root, vite: input.vite, fragmentComponentsPath });
      let declared: ReadonlySet<string> | undefined;
      try {
        const vocabulary = fragmentVocabularyOf(module.render, fragmentComponentsPath);
        declared = new Set(Object.keys(vocabulary.components));
        // The mapping a published page renders with; it throws for a hydrated component the build cannot map.
        islandVocabulary(vocabulary, new Map(module.islands.map(([key, component]) => [component, key])));
      } catch (error) {
        problems.push(messageOf(error));
      }
      names = declared;
    } catch (error) {
      input.logger.warn(
        `@conloca/astro-cms: ${fragmentComponentsPath} failed to load, so neither fragment component names nor the hydration mapping are checked: ${messageOf(error)}`,
      );
      names = undefined;
    }
  }
  const declaredIn = fragmentComponentsPath ?? 'fragmentComponentsPath (not set)';

  const api = await FileSystemContentAPI.create({ contentRoot: resolve(root, input.contentRoot) });
  // Only MDX fragments render through the fragment vocabulary; Puck (.vxjson) fragments are not MDX.
  const fragments = [...api.listAllContent()]
    .filter((manifest) => manifest.kind === 'fragment' && manifest.type === 'mdx')
    .flatMap((manifest) =>
      Object.entries(manifest.locales).flatMap(([locale, version]) =>
        // Scheduled fragments go live without a rebuild, so only expired ones are skipped.
        version?.sourcePath && isContentPublished({ unpublishAt: version.unpublishAt })
          ? [{ id: manifest.id, locale, file: resolve(version.sourcePath) }]
          : [],
      ),
    );
  const found = await Promise.all(
    fragments.map(async ({ id, locale, file }) => {
      const text = await readFile(file, 'utf8');
      const fence = /^---\r?\n[\s\S]*?\r?\n---[^\n]*(\n|$)/.exec(text)?.[0] ?? '';
      const offset = fence.split('\n').length - 1;
      const prefix = `${id} (${locale}) ${relative(root, file)}`;
      try {
        const unknown = findUnknownFragmentComponents(text.slice(fence.length), names ?? new Set());
        if (!names) return [];
        return unknown.map(({ name, line }) => `${prefix}:${offset + line}: <${name}> is not in ${declaredIn}`);
      } catch (error) {
        return [`${prefix}: ${messageOf(error)}`];
      }
    }),
  );
  problems.push(...found.flat());
  // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh local array.
  return problems.sort();
}
