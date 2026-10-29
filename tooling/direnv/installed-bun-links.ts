import {
  type Dirent,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { unreadableDeveloperLinks } from './developer-links.ts';

/**
 * What a Bun install left linked in node_modules, read from the filesystem alone: whether every package a consumer
 * resolves reaches a readable manifest (verifyInstalledBunLinks, before an install writes its success receipt), and
 * which store links the installed tree reaches dangle (danglingStoreLinks, which makes a matching stamp stale).
 * setup-environment.ts owns the workspace enumeration and passes each member's node_modules directory in.
 */

export type BunInstallIntegrityOperation =
  | 'inspect isolated store'
  | 'resolve installed path'
  | 'list installed package aliases'
  | 'read installed package manifest';

export class BunInstallIntegrityError extends Error {
  readonly code = 'BUN_INSTALL_INTEGRITY';

  constructor(
    public readonly operation: BunInstallIntegrityOperation,
    public readonly actualPath: string,
    public readonly expectedTarget: string,
    cause: unknown,
  ) {
    super(
      `Bun install integrity: ${operation} failed for ${actualPath}; expected target ${expectedTarget}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

/**
 * Link/manifest admission only, once before an install writes its success receipt. `members` is the node_modules
 * directory of every workspace member, beside its manifest.
 */
export function verifyInstalledBunLinks(
  root: string,
  members: readonly string[],
): BunInstallIntegrityError | undefined {
  const store = path.join(root, 'node_modules', '.bun');
  let actualPath = store;
  let expectedTarget = store;
  let operation: BunInstallIntegrityOperation = 'inspect isolated store';
  // Developer links whose target this process may not read (developer-links.ts): the install
  // did not make them and nothing here can read what they name, so they are not admitted here.
  let unreadable: ReadonlySet<string> = new Set();

  const select = (candidate: string, symbolicLink: boolean): void => {
    actualPath = candidate;
    expectedTarget = candidate;
    operation = 'resolve installed path';
    if (symbolicLink) {
      const target = readlinkSync(candidate);
      expectedTarget = path.resolve(path.dirname(candidate), target);
      expectedTarget = path.resolve(realpathSync(path.dirname(candidate)), target);
    }
    realpathSync(candidate);
  };
  const manifest = (candidate: string, symbolicLink: boolean): void => {
    if (unreadable.has(candidate)) return;
    select(candidate, symbolicLink);
    operation = 'read installed package manifest';
    JSON.parse(readFileSync(path.join(candidate, 'package.json'), 'utf8'));
  };
  const aliases = (tree: string, symbolicLink = false): void => {
    select(tree, symbolicLink);
    operation = 'list installed package aliases';
    for (const entry of readdirSync(tree, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const candidate = path.join(tree, entry.name);
      if (entry.name.startsWith('@')) {
        select(candidate, entry.isSymbolicLink());
        operation = 'list installed package aliases';
        for (const scoped of readdirSync(candidate, { withFileTypes: true })) {
          if (!scoped.name.startsWith('.')) manifest(path.join(candidate, scoped.name), scoped.isSymbolicLink());
        }
      } else {
        manifest(candidate, entry.isSymbolicLink());
      }
    }
  };

  // Admission walks the live closure, not every directory in the store. A restored store can
  // carry superseded peer variants of packages the install also wrote under other variants:
  // their links point into the install cache of the machine that wrote them and dangle here,
  // and their own dependency aliases dangle with them. Nothing the install produced references
  // those variants, so they are not broken live links. An entry is walked strictly when a link
  // in the live tree resolves into it, or when it is the only variant of its package and
  // version — a sole dangling variant still refuses, because there is no replacement to point
  // at. Same package and version alone is never reachability proof.
  const identityOf = (name: string): string | null => /^(.+@\d[^+]*)(\+.*)?$/.exec(name)?.[1] ?? null;
  try {
    unreadable = new Set(unreadableDeveloperLinks(root));
    const state = lstatSync(store, { throwIfNoEntry: false });
    // A hoisted install has no isolated store to admit.
    if (state === undefined) return undefined;
    select(store, state.isSymbolicLink());
    operation = 'inspect isolated store';
    const entries = readdirSync(store, { withFileTypes: true }).filter((entry) => !entry.name.startsWith('.'));
    const identityCounts = new Map<string, number>();
    for (const entry of entries) {
      if (entry.name === 'node_modules' || !(entry.isDirectory() || entry.isSymbolicLink())) continue;
      const identity = identityOf(entry.name) ?? entry.name;
      identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1);
    }
    const referenced = referencedStoreEntries(root, store, entries, members);
    // Package aliases are what every consumer actually resolves: each package they name must
    // resolve to a readable manifest, wherever it points — into the store, into the install
    // cache, or at a workspace member. The same strict walk applies at the root and in every
    // workspace member's node_modules; member links seeded the closure above, and seeding is
    // not validation. No identity waiver applies: an alias whose target does not exist is a
    // broken import, however intact a same-version sibling is.
    const checkPackage = (candidate: string, symbolicLink: boolean): void => {
      try {
        // Only a plain metadata file is skipped; a package alias that resolves to a regular
        // file is a broken package and manifest() refuses it below.
        if (!symbolicLink && !statSync(candidate).isDirectory()) return;
      } catch {
        // Dangling: manifest() refuses it with the path named.
      }
      manifest(candidate, symbolicLink);
    };
    const walkPackageAliases = (modules: string): void => {
      for (const child of readdirSync(modules, { withFileTypes: true })) {
        if (child.name.startsWith('.')) continue;
        const childPath = path.join(modules, child.name);
        if (child.name.startsWith('@')) {
          // A scope is a namespace, symlinked or not: the same strict alias walk as the store's.
          aliases(childPath, child.isSymbolicLink());
        } else {
          checkPackage(childPath, child.isSymbolicLink());
        }
      }
    };
    walkPackageAliases(path.join(root, 'node_modules'));
    for (const modules of members) {
      // A member with nothing installed has no aliases to validate; a present directory is
      // walked with the root's strictness.
      if (existsSync(modules)) walkPackageAliases(modules);
    }
    for (const entry of entries) {
      const candidate = path.join(store, entry.name);
      if (entry.name === 'node_modules') {
        aliases(candidate, entry.isSymbolicLink());
      } else if (entry.isDirectory() || entry.isSymbolicLink()) {
        const identity = identityOf(entry.name) ?? entry.name;
        // An unreferenced variant beside others of its package and version is superseded
        // garbage the install left behind; nothing live resolves through it, so it is not
        // walked. A sole variant is walked: there is no replacement to point at.
        if (!referenced.has(entry.name) && (identityCounts.get(identity) ?? 0) > 1) continue;
        select(candidate, entry.isSymbolicLink());
        aliases(path.join(candidate, 'node_modules'));
      }
    }
    return undefined;
  } catch (cause) {
    return new BunInstallIntegrityError(operation, actualPath, expectedTarget, cause);
  }
}

/**
 * The store entries the installed tree reaches. Every link in the root's node_modules, the
 * store's own and each workspace member's that resolves into an entry makes that entry live,
 * and so does every link in a live entry's own node_modules, to a fixed point. Member links
 * are as live as root links.
 */
function referencedStoreEntries(
  root: string,
  store: string,
  entries: readonly Dirent[],
  members: readonly string[],
): Set<string> {
  const referenced = new Set<string>();
  const knownEntries = new Set(entries.filter((entry) => entry.name !== 'node_modules').map((entry) => entry.name));
  // Where each store entry actually lives: a link can reach an entry through its install
  // cache target (whose basename carries a cache suffix the entry name does not), so live
  // reachability is also containment inside an entry's real directory, not name matching.
  const entryReals = new Map<string, string>();
  for (const entry of entries) {
    if (entry.name === 'node_modules' || !(entry.isDirectory() || entry.isSymbolicLink())) continue;
    try {
      entryReals.set(entry.name, realpathSync(path.join(store, entry.name)));
    } catch {
      // A dangling entry has no real directory for a live alias to land inside.
    }
  }
  const scanLinks = (dir: string, owner: string | null): void => {
    let children: Dirent[];
    try {
      children = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const child of children) {
      if (child.name.startsWith('.')) continue;
      const childPath = path.join(dir, child.name);
      if (child.name.startsWith('@')) {
        // A scope is a namespace, symlinked or not: traverse it, never treat it as a package.
        let isDirectory = false;
        try {
          isDirectory = statSync(childPath).isDirectory();
        } catch {
          isDirectory = false;
        }
        if (isDirectory) {
          scanLinks(childPath, owner);
          continue;
        }
      }
      if (!child.isSymbolicLink()) continue;
      let target: string;
      try {
        target = readlinkSync(childPath);
      } catch {
        continue;
      }
      // The alias's canonical endpoint is what it actually reaches — through intermediate
      // symlinks as well as its literal target — and is what select() already witnesses.
      // A dangling alias has no endpoint; fall back to resolving its literal target
      // against the physical parent, so a live reference to a broken entry still marks
      // that entry referenced.
      let physicalDir = path.dirname(childPath);
      try {
        physicalDir = realpathSync(physicalDir);
      } catch {
        // Keep the lexical parent; the segment mark below still applies.
      }
      let endpoint: string | null = null;
      try {
        endpoint = realpathSync(childPath);
      } catch {
        endpoint = null;
      }
      const resolved = endpoint ?? path.resolve(physicalDir, target);
      if (endpoint !== null) {
        // The canonical endpoint is authoritative: the entry whose real directory
        // contains it is the live target, whatever any path segment happens to name.
        for (const [name, real] of entryReals) {
          if (name !== owner && (endpoint === real || endpoint.startsWith(`${real}${path.sep}`))) {
            referenced.add(name);
            break;
          }
        }
      } else {
        for (const segment of resolved.split(path.sep)) {
          if (knownEntries.has(segment) && segment !== owner) {
            referenced.add(segment);
            break;
          }
        }
      }
    }
  };
  scanLinks(path.join(root, 'node_modules'), null);
  scanLinks(path.join(store, 'node_modules'), null);
  for (const modules of members) scanLinks(modules, null);
  let grew = true;
  while (grew) {
    grew = false;
    for (const entry of entries) {
      if (entry.name === 'node_modules' || !(entry.isDirectory() || entry.isSymbolicLink())) continue;
      if (!referenced.has(entry.name)) continue;
      const before = referenced.size;
      scanLinks(path.join(store, entry.name, 'node_modules'), entry.name);
      if (referenced.size > before) grew = true;
    }
  }
  return referenced;
}

/**
 * The store links the installed tree reaches whose target in Bun's install cache is gone. Under
 * `globalStore` each node_modules/.bun/<entry> is a link into that cache, and one that dangles
 * names a cache entry that no longer exists: the install is out of date, as it is while a
 * developer link dangles, and `bun install` links the entry again (measured, Bun 1.4.3). A
 * dangling variant nothing live reaches is superseded garbage the install leaves in place (see
 * verifyInstalledBunLinks), so it never makes the install stale: no install would change it.
 * The closure is walked only when some store link dangles, so `members` is asked for only then.
 */
export function danglingStoreLinks(root: string, members: () => readonly string[]): string[] {
  const store = path.join(root, 'node_modules', '.bun');
  let entries: Dirent[];
  try {
    entries = readdirSync(store, { withFileTypes: true }).filter((entry) => !entry.name.startsWith('.'));
  } catch (error) {
    // A hoisted install, or none yet, has no store to link from.
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return [];
    throw error;
  }
  const dangling = entries.filter(
    (entry) =>
      entry.isSymbolicLink() && statSync(path.join(store, entry.name), { throwIfNoEntry: false }) === undefined,
  );
  if (dangling.length === 0) return [];
  const referenced = referencedStoreEntries(root, store, entries, members());
  return dangling.filter((entry) => referenced.has(entry.name)).map((entry) => path.join(store, entry.name));
}
