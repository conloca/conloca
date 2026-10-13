import { createContentAPI } from '@conloca/content-api/reader';
import type { Loader, LoaderContext } from 'astro/loaders';

// Both registries are per-process, not per-config-evaluation: a dev-server
// config reload re-runs content.config without clearing them. So a collection
// dropped from the config stays declared, and a passing check is not repeated
// for a directory that appears later — not until the server restarts. Both are
// deliberately open: a stale registry can only miss a complaint, never invent
// one. Only successful checks are memoised, so a failing one is retried on the
// next load and a leftover can never keep failing a build the user has since
// fixed in content.config.ts.
const declared = new Set<string>();
const checks = new Map<string, Promise<void>>();

export type ConlocaCollectionKind = 'page' | 'data' | 'fragment';

/** Registry entries carry their kind: a data collection `general` must not cover an undeclared fragment FOLDER `general`. */
export type QualifiedCollectionName = `${ConlocaCollectionKind}:${string}`;

const qualifiedName = (kind: ConlocaCollectionKind, name: string): QualifiedCollectionName => `${kind}:${name}`;

/** 'data:faqs' → 'the data collection "faqs"' — the registry key is internal, the error is for a human. */
function describeQualified(qualified: QualifiedCollectionName): string {
  const separator = qualified.indexOf(':');
  return `the ${qualified.slice(0, separator)} collection "${qualified.slice(separator + 1)}"`;
}

/** Factories call this as content.config evaluates; the registry is complete before any loader runs. */
export function declareConlocaCollection(kind: ConlocaCollectionKind, name: string): void {
  declared.add(qualifiedName(kind, name));
}

/** Test hook — the registry is module state shared across a config evaluation. */
export function resetDeclaredCollections(): void {
  declared.clear();
  checks.clear();
}

/**
 * Every Conloca collection on disk must be declared in content.config, or its
 * entries silently never build. The reverse — declared with no directory yet —
 * is the schema-first workflow (the directory appears with the first saved
 * entry) and is allowed.
 */
export function assertCollectionsDeclared(onDisk: Iterable<QualifiedCollectionName>): void {
  // A qualified name repeats only when one iterable carries duplicates —
  // dedupe so nothing is ever reported twice.
  const undeclared = [...new Set(onDisk)].filter((name) => !declared.has(name));
  if (undeclared.length === 0) return;
  throw new Error(
    `[conloca] content on disk has collections that content.config.ts does not declare: ${undeclared
      .map(describeQualified)
      .join(', ')}. Declare each one (conlocaPages / conlocaData / conlocaFragments) or its entries will not be built.`,
  );
}

/** Enumerates every collection kind on disk and checks the registry covers them. */
async function assertDiskDeclared(options: { contentRoot: string; site: string }): Promise<void> {
  const api = await createContentAPI({ contentRoot: options.contentRoot });
  assertCollectionsDeclared([
    ...[...(api.getSite(options.site)?.collections ?? [])].map((name) => qualifiedName('page', name)),
    ...[...api.data.collections].map((name) => qualifiedName('data', name)),
    ...[...api.fragments.collections].map((name) => qualifiedName('fragment', name)),
  ]);
}

/**
 * Wraps a factory-created loader so a config evaluation checks the disk once
 * per content root and site. createConlocaCollections' loaders are not wrapped
 * — its contract IS discovery.
 *
 * Astro runs every loader concurrently through one Promise.all, so the check is
 * memoised as a promise rather than a done-flag: one scan per root and site,
 * and every loader awaits the same result instead of racing past a check still
 * running.
 */
export function withDeclarationCheck(loader: Loader, options: { contentRoot: string; site: string }): Loader {
  return {
    ...loader,
    async load(context: LoaderContext): Promise<void> {
      // NUL separates the two halves — a space collides with paths containing spaces.
      const key = `${options.contentRoot}\0${options.site}`;
      let check = checks.get(key);
      if (!check) {
        check = assertDiskDeclared(options).catch((error: unknown) => {
          // Only a successful check is memoised: module state outlives a
          // dev-server config reload, so a cached rejection would keep failing
          // after the user has declared the collection it asked for.
          checks.delete(key);
          throw error;
        });
        checks.set(key, check);
      }
      await check;
      return loader.load(context);
    },
  };
}
