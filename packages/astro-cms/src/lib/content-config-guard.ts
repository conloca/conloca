import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where Astro looks for a content config, newest location first. */
const CONTENT_CONFIG_CANDIDATES = [
  'src/content.config.ts',
  'src/content.config.mts',
  'src/content.config.mjs',
  'src/content.config.js',
  'src/content/config.ts',
  'src/content/config.mjs',
  'src/content/config.js',
];

export type ContentConfigProblem = 'missing' | 'not-wired';

/**
 * Any of these in the config means Conloca's collections get registered —
 * the factories, the deprecated wrapper, or a hand-rolled
 * `defineCollection({ loader: conlocaLoader(...) })` (a supported shape;
 * the loader carries its own mounted-key guard).
 */
const WIRED_MARKERS = ['createConlocaCollections', 'conlocaPages', 'conlocaData', 'conlocaFragments', 'conlocaLoader'];

/** The content config file Astro loads for a project, or null when it has none. */
export function findContentConfig(projectRoot: string): string | null {
  return (
    CONTENT_CONFIG_CANDIDATES.map((candidate) => join(projectRoot, candidate)).find((path) => existsSync(path)) ?? null
  );
}

/**
 * Detect the single most common Conloca misconfiguration: a project whose
 * content config never registers Conloca's collections, so every page 404s
 * with no other symptom. Astro exposes no hook that reveals resolved
 * collections, so this reads the file instead.
 */
export function findContentConfigProblem(projectRoot: string): ContentConfigProblem | null {
  const found = findContentConfig(projectRoot);
  if (!found) return 'missing';

  const source = readFileSync(found, 'utf8');
  return WIRED_MARKERS.some((marker) => source.includes(marker)) ? null : 'not-wired';
}

/** The copy-pasteable fix printed with either problem. */
export const CONTENT_CONFIG_SNIPPET = `// src/content.config.ts
import { conlocaFragments, conlocaPages } from '@conloca/astro-cms/node/content';

export const collections = {
  pages: conlocaPages(),
  ...conlocaFragments(),
};`;
