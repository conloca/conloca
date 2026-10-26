/**
 * The links a developer points out of this checkout, kept across every
 * install smoo runs.
 *
 * `bun link <name>`, or a hand-made `ln -s`, replaces a dependency's entry in
 * a node_modules tree with a link to a local checkout of that package: how a
 * consumer runs against a build that is not published yet. Every `bun
 * install` re-points every declared dependency at the lockfile's version —
 * an install with nothing to do included, and before the root `preinstall`
 * script runs (measured on Bun 1.4.2), so no lifecycle script ever sees the
 * link. So each install smoo runs (shell entry's, a CI runner's
 * frozen-lockfile one, `smoo monorepo update`'s) records these links before
 * it installs and restores manual choices afterwards, except Nx (below).
 * Recorded declarations follow their current target after a successful install.
 * A plain `bun install` still relinks an undeclared link: only a wrapper around
 * bun itself could intercept that. A declared one (below) comes back on its own.
 *
 * A developer link is a symlink directly inside a node_modules tree bun
 * installs (the root's or a workspace member's, scoped names included) whose
 * target lies outside the project root. The target is resolved against the
 * link's own directory and no further. Everything bun links there resolves
 * inside the root: workspace members by relative path, packages into
 * node_modules/.bun. Following the links further would misclassify: under
 * `globalStore`, each .bun entry is itself a link into the shared install
 * cache, outside every checkout.
 *
 * Unlinking a package means removing its link, and the next install puts the
 * lockfile's version there. A dangling link is removed before the install,
 * with a warning. A link whose target this process may not read (EPERM in a
 * cowshed sandbox that grants no read of it, EACCES under a directory's mode)
 * is not wrong, only unreadable here: it is kept like a live link, never
 * taken for a dangling one, and said. Links this owner creates for declarations also have a receipt
 * in node_modules/.smoo-declared-links: their alias, declaration and exact link
 * text. A changed declaration can replace that link only while its text still
 * matches the receipt. Unrecorded links and manual retargets stay the developer's.
 *
 * An install that exists to replace links says which: `{ relink }` names the
 * packages (`name` or `@scope/name`) it is meant to relink, in the root's
 * tree and in every member's. When the install resolves, what it left at
 * those names stays (a `bun link` run against providers a developer
 * registered anew) and every other developer link is put back as before.
 * When it rejects, every link is put back, the named ones included, so a
 * failed relink changes nothing. A named package with no developer link when
 * the install starts has nothing to put back, and a named link that dangled
 * is removed first, as for any install.
 *
 * Nx is the one package every managed install relinks. The lockfile owns Nx, so
 * a developer link to a local Nx checkout is not kept: the managed installs
 * (shell entry's, a CI runner's frozen-lockfile one, `smoo monorepo update`'s)
 * pass `{ relink: ['nx'] }`, and a successful one leaves Nx as Bun installed it.
 * Other manual developer links are still kept. A live Nx link makes the install
 * stamp stale (`hasStaleDeveloperLinks`), so the next managed install replaces
 * it; an ordinary local setup invocation with current bindings then runs no
 * `bun install`.
 *
 * A repository can also DECLARE such links, so every checkout of it on a
 * developer machine gets them without anyone running `bun link`: the root
 * package.json's `smoo.developerLinks` maps a package name to a relative
 * directory. Contained targets belong to this checkout; genuine sibling
 * targets are anchored at the project's main checkout (see `linkAnchor`).
 * `applyDeclaredLinks` makes it so: in every node_modules tree that has the
 * package installed, the entry becomes a link to that directory, unless a
 * developer already pointed it at a checkout of their own. An existing real
 * package payload requires explicit owner relocation, never deletion. A declared
 * directory this machine does not have leaves the installed version, said so.
 * CI never applies them: it builds against the published packages the
 * lockfile names (setup-environment.ts `--links`).
 *
 * A stable declaration names `{ "directory": …, "snapshot": "<64-hex ID>" }`:
 * only the consumer's verified sealed snapshot resolves. Provider HEAD drift
 * is reported and continues with the pin; a missing or invalid pin refuses.
 * The directory is a freshness hint, never an input to pinned execution.
 *
 * A declaration may also ask for a snapshot: `{ "directory": …, "snapshot":
 * { "targets": [...], "artifactModules": [...] } }` binds every alias to a
 * sealed copy of that checkout instead of the live directory, so the
 * provider's own builds, lands and installs never change a file a running
 * consumer task resolves (linked-snapshots.ts). The snapshot is taken here, at
 * the install and shell-entry boundary, and only when the provider's Nx
 * targets vouch for every copied byte; otherwise the refusal is said and each
 * alias keeps the sealed snapshot its receipt records. An install has re-pointed
 * the alias at the lockfile's version before this file runs as its postinstall,
 * so "keeps" means binding that recorded snapshot again; an alias with none
 * keeps the installed version, and the refusal counts it. The plugin that
 * vouches is the one the declarations bind: a declared @smoothbricks/nx-plugin
 * is probed from its checkout, since every `bun install` has put the published
 * plugin back at its alias before this file runs as the postinstall.
 *
 * Declarations are applied at the end of every install. smoo's root script
 * policy makes the root's `postinstall` run this file, and bun runs the
 * root's lifecycle scripts after it has re-pointed the dependencies, an
 * install with nothing to do included. Without it a plain `bun install` left
 * the published package in place until the next shell entry, and a process
 * started in that gap kept what it loaded: an Nx daemon ran the published
 * plugin's sync generator for the rest of its life. Shell entry's `--links`
 * task covers a tree that lost a link without an install, such as a clone
 * made while it was missing. The postinstall takes no install lock: an
 * install smoo runs holds that lock while bun runs the script, so waiting
 * for it there would never end.
 *
 * Like secret-references.ts, this is a managed raw script: shell entry imports
 * it before anything is installed, and `smoo monorepo update` loads the copy
 * the nx-plugin ships. Because both use the one implementation, the shell and
 * the command keep the same links.
 */

import {
  type Dirent,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { KeepDeveloperLinksOptions } from '@smoothbricks/nx-plugin/managed-assets';
import {
  type ProducerProbe,
  pinnedSnapshot,
  pluginProbe,
  recordedSnapshot,
  type SealedSnapshot,
  type SnapshotDeclaration,
  snapshotBinding,
} from './linked-snapshots.ts';

interface DeveloperLink {
  /** Where the link is, relative to the project root. */
  readonly path: string;
  /** The link's own text, restored byte for byte. */
  readonly target: string;
}

interface DeveloperLinks {
  /** Links kept across an install: every link whose target is not known to be gone, unreadable ones included. */
  readonly live: readonly DeveloperLink[];
  /** Links whose target no longer exists. */
  readonly dangling: readonly DeveloperLink[];
  /**
   * The live links whose target this process may not read, with the error that said so: a sandbox's EPERM or a
   * directory mode's EACCES. Such a link is not wrong, only unreadable here, so it is kept as made and said once.
   */
  readonly unreadable: readonly (DeveloperLink & { readonly code: string })[];
}

interface DeclaredLinkReceipt extends DeveloperLink {
  readonly declaration: string;
}

/**
 * Runs `install` while preserving the developer links captured under `root`.
 * On rejection every captured live link is restored, less links that already
 * dangled; a resolved install keeps its selected `relink` replacements and
 * the lockfile versions replacing undeclared links whose receipts still match.
 * This is not a transaction over new entries created by the install. Relink
 * intent reports the actual final link state on either outcome.
 */
export async function keepDeveloperLinks<T>(
  root: string,
  install: () => Promise<T>,
  options?: KeepDeveloperLinksOptions,
): Promise<T> {
  const { live, dangling, unreadable } = findDeveloperLinks(root);
  const recorded = readDeclaredRecord(root);
  const undeclared = new Set<string>();
  if (recorded.size > 0) {
    const declared = new Set<string>();
    for (const { name } of readDeclaredLinks(root)) declared.add(name);
    for (const link of live) {
      if (recorded.get(link.path)?.target === link.target && !declared.has(packageName(link))) {
        undeclared.add(link.path);
      }
    }
  }
  for (const link of dangling) {
    rmSync(path.join(root, link.path), { force: true });
    console.error(`! removed developer link ${link.path}: its target ${resolvedTarget(root, link)} no longer exists`);
  }
  // Only an install that resolved leaves the links it was meant to replace as
  // it made them; a rejected one puts every captured live link back.
  let replaced: readonly string[] | undefined;
  let succeeded = false;
  try {
    for (const entry of undeclared) {
      rmSync(path.join(root, entry));
      console.error(`! removed developer link ${entry}: smoo.developerLinks no longer declares its package`);
    }
    const result = await install();
    replaced = options?.relink;
    succeeded = true;
    return result;
  } finally {
    const restored = readDeclaredRecord(root);
    for (const link of live) {
      if (succeeded && undeclared.has(link.path)) {
        restored.delete(link.path);
        continue;
      }
      if (replaced?.includes(packageName(link))) {
        const at = path.join(root, link.path);
        const receipt = restored.get(link.path);
        // Keep the receipt postinstall wrote for the selected replacement,
        // but never retain an old receipt for a different final binding.
        if (!lstatSync(at, { throwIfNoEntry: false })?.isSymbolicLink() || readlinkSync(at) !== receipt?.target) {
          restored.delete(link.path);
        }
        continue;
      }
      restoreLink(root, link);
      const receipt = recorded.get(link.path);
      // The install's postinstall may have claimed this alias after Bun replaced
      // it. Restoring a manual override must restore its lack of ownership too.
      if (receipt?.target === link.target) restored.set(link.path, receipt);
      else restored.delete(link.path);
    }
    writeDeclaredRecord(root, restored);
    if (succeeded && recorded.size > 0 && process.env.GITHUB_ACTIONS !== 'true') {
      applyDeclaredLinks(root, await planDeclaredLinks(root));
    }
    if (options !== undefined || (succeeded && undeclared.size > 0)) {
      reportDeveloperLinks(root);
    } else {
      describeDeveloperLinks(root, { live, unreadable });
    }
  }
}

/**
 * One stderr line naming each linked package and the checkout it points at,
 * so a shell running a local build says so. Shell entry prints it on every
 * entry that installs nothing. The entry that installs gets the same line
 * from `keepDeveloperLinks`, but devenv's direnv integration runs that entry
 * where its output is not shown. A dangling link is left for the next
 * install to remove. A link whose target this process may not read gets a
 * line of its own.
 */
export function reportDeveloperLinks(root: string): void {
  describeDeveloperLinks(root, findDeveloperLinks(root));
}

/**
 * A stamped install is stale while a developer link dangles, or while a live one names a package in `relink`: that
 * is a link the install must replace, so a matching stamp is not trusted.
 */
export function hasStaleDeveloperLinks(root: string, relink: readonly string[] = []): boolean {
  const { live, dangling } = findDeveloperLinks(root);
  return dangling.length > 0 || live.some((link) => relink.includes(packageName(link)));
}

/**
 * The developer links whose target this process may not read, as absolute paths: kept as made and said, but no
 * process here can check what they point at, so an install's admission leaves them to the developer.
 */
export function unreadableDeveloperLinks(root: string): string[] {
  return findDeveloperLinks(root).unreadable.map((link) => path.join(root, link.path));
}

/** The package a link stands for in its tree: `name` or `@scope/name`. */
function packageName(link: { readonly path: string }): string {
  return link.path.slice(link.path.lastIndexOf('node_modules/') + 'node_modules/'.length);
}

/** A package linked from many members is named once, with its count; each unreadable link is named on its own. */
function describeDeveloperLinks(root: string, { live, unreadable }: Omit<DeveloperLinks, 'dangling'>): void {
  for (const link of unreadable) {
    console.error(
      `! developer link ${link.path} -> ${resolvedTarget(root, link)}: its target cannot be read here (${link.code}); kept as it is`,
    );
  }
  if (live.length === 0) {
    return;
  }
  const counts = new Map<string, number>();
  for (const link of live) {
    const named = `${packageName(link)} -> ${resolvedTarget(root, link)}`;
    counts.set(named, (counts.get(named) ?? 0) + 1);
  }
  const entries = [...counts].map(([named, count]) => (count === 1 ? named : `${named} (${count} links)`));
  console.error(`linked to local checkouts: ${entries.join(', ')}`);
}

function findDeveloperLinks(root: string): DeveloperLinks {
  const live: DeveloperLink[] = [];
  const dangling: DeveloperLink[] = [];
  const unreadable: (DeveloperLink & { readonly code: string })[] = [];
  for (const tree of nodeModulesTrees(root)) {
    for (const entry of packageLinks(root, tree)) {
      const link: DeveloperLink = { path: entry, target: readlinkSync(path.join(root, entry)) };
      const target = resolvedTarget(root, link);
      const relative = path.relative(root, target);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        try {
          (statSync(target, { throwIfNoEntry: false }) === undefined ? dangling : live).push(link);
        } catch (error) {
          const code = error instanceof Error && 'code' in error ? error.code : undefined;
          if (code !== 'EPERM' && code !== 'EACCES') throw error;
          live.push(link);
          unreadable.push({ ...link, code });
        }
      }
    }
  }
  return { live, dangling, unreadable };
}

/**
 * The node_modules trees the last install wrote, relative to the root: the
 * root's and each workspace member's, as bun.lock names them. The lockfile,
 * not the manifest's workspace globs, because it is bun's own record of the
 * members it installed. A missing or unreadable lockfile leaves the root's
 * tree alone; the install that follows reports the lockfile in its own words.
 */
function nodeModulesTrees(root: string): string[] {
  let lock: unknown;
  try {
    lock = Bun.JSONC.parse(readFileSync(path.join(root, 'bun.lock'), 'utf8'));
  } catch {
    return ['node_modules'];
  }
  const workspaces = typeof lock === 'object' && lock !== null ? Reflect.get(lock, 'workspaces') : undefined;
  const members = typeof workspaces === 'object' && workspaces !== null ? Object.keys(workspaces) : [];
  return [...new Set(['', ...members])].map((member) => path.join(member, 'node_modules'));
}

/** Every symlink a package name could be in `tree`: `name` and `@scope/name`. */
function packageLinks(root: string, tree: string): string[] {
  const links: string[] = [];
  for (const entry of directoryEntries(path.join(root, tree))) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    if (entry.isSymbolicLink()) {
      links.push(path.join(tree, entry.name));
    } else if (entry.name.startsWith('@') && entry.isDirectory()) {
      for (const scoped of directoryEntries(path.join(root, tree, entry.name))) {
        if (scoped.isSymbolicLink()) {
          links.push(path.join(tree, entry.name, scoped.name));
        }
      }
    }
  }
  return links;
}

function directoryEntries(directory: string): Dirent[] {
  try {
    return readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return [];
    }
    throw error;
  }
}

function resolvedTarget(root: string, link: DeveloperLink): string {
  return path.resolve(root, path.dirname(link.path), link.target);
}

/** Puts `link` back unless the install left it as it was. */
function restoreLink(root: string, link: DeveloperLink): void {
  const at = path.join(root, link.path);
  let current: string | null;
  try {
    current = readlinkSync(at);
  } catch {
    // Nothing there, or no link: either way the install replaced it.
    current = null;
  }
  if (current === link.target) {
    return;
  }
  // What the install put there: a link into node_modules/.bun, or, under the
  // hoisted linker, a copied package directory. Removing a link never
  // follows it. The parent is created again for a dependency the install
  // dropped along with its scope directory.
  rmSync(at, { recursive: true, force: true });
  mkdirSync(path.dirname(at), { recursive: true });
  symlinkSync(link.target, at);
}

/** What a declaration binds its aliases to: the checkout it names, or a sealed snapshot of it. */
export type DeclaredBinding =
  | { readonly kind: 'checkout'; readonly target: string }
  | { readonly kind: 'snapshot'; readonly target: string; readonly id: string };

/** One tree entry a declaration wants pointed at its package's local checkout or its snapshot. */
export interface DeclaredLinkChange {
  /** Where the entry is, relative to the project root. */
  readonly path: string;
  /** The absolute directory it should link to, and what that directory is. */
  readonly binding: DeclaredBinding;
}

/**
 * A declaration this machine cannot honour now: its checkout directory is not there to link to (the installed
 * version stays), no snapshot of it can be made, or an alias still links the live checkout without a receipt, which a
 * declaration never claims retroactively. A refused snapshot names what its aliases keep: the sealed snapshots their
 * receipts record (`kept`), and the count of aliases that had none and so keep the version the install left
 * (`installed`).
 */
export type UnavailableDeclaredLink =
  | { readonly kind: 'absent'; readonly name: string; readonly target: string; readonly reason: string }
  | {
      readonly kind: 'snapshot-refused';
      readonly name: string;
      readonly source: string;
      readonly reason: string;
      readonly kept: readonly string[];
      readonly installed: number;
    }
  | { readonly kind: 'snapshot-unclaimed'; readonly name: string; readonly path: string; readonly source: string };

export interface DeclaredLinksPlan {
  readonly changes: readonly DeclaredLinkChange[];
  readonly unavailable: readonly UnavailableDeclaredLink[];
  /** Verified pins whose provider HEAD differs or cannot be inspected; linking still succeeds. */
  readonly reports: readonly string[];
}

/**
 * What `smoo.developerLinks` asks of the trees under `root` that they do not
 * already hold. An entry needs a change when the package is installed there
 * (as the store link or directory bun made) and is not already a link to the
 * declared directory, or for a snapshot declaration to its current snapshot.
 * An entry a developer pointed at another checkout of their own stays theirs,
 * and a tree without the package gains nothing: a declaration links what the
 * manifests depend on, never adds a dependency. An unrecorded alias that links
 * the live checkout a snapshot declaration names is reported, not claimed: an
 * owner relinks it once (remove it, then install) to bind the snapshot.
 * A contained declaration this checkout cannot honour throws rather than keep a
 * binding it inherited from the main checkout, or reach through a redirected or
 * escaping path. Resolving a snapshot may capture one (linked-snapshots.ts),
 * which writes only the snapshot store.
 */
export async function planDeclaredLinks(root: string): Promise<DeclaredLinksPlan> {
  const declared = readDeclaredLinks(root);
  if (declared.length === 0) {
    return { changes: [], unavailable: [], reports: [] };
  }
  const anchor = linkAnchor(root);
  const canonicalRoot = realpathSync(root);
  const trees = nodeModulesTrees(root);
  const recorded = readDeclaredRecord(root);
  const probe: ProducerProbe = (target, providerRoot) =>
    pluginProbe(snapshotPluginRoot(root, anchor, declared))(target, providerRoot);
  const changes: DeclaredLinkChange[] = [];
  const unavailable: UnavailableDeclaredLink[] = [];
  const reports: string[] = [];
  for (const { name, directory: relative, snapshot } of declared) {
    const source = declaredTarget(root, anchor, relative);
    const contained = containsPath(path.resolve(root), source);
    if (contained && typeof snapshot !== 'string') {
      assertOwnedPath(canonicalRoot, path.resolve(canonicalRoot, path.relative(path.resolve(root), source)));
    }
    const reason = typeof snapshot === 'string' ? null : unavailableReason(source);
    if (reason !== null) {
      if (contained) assertNoInheritedBinding(root, anchor, name, relative, source);
      unavailable.push({ kind: 'absent', name, target: source, reason });
      continue;
    }
    let binding: DeclaredBinding = { kind: 'checkout', target: source };
    if (snapshot !== undefined) {
      const outcome = await snapshotBinding(root, name, source, snapshot, probe);
      if (outcome.kind === 'refused') {
        if (typeof snapshot === 'string')
          throw new Error(`smoo.developerLinks ${name}: cannot resolve pinned snapshot ${snapshot}: ${outcome.reason}`);
        const kept = keptSnapshots(root, trees, name, recorded);
        changes.push(...kept.changes);
        unavailable.push({ kind: 'snapshot-refused', name, source, reason: outcome.reason, ...kept.said });
        continue;
      }
      binding = { kind: 'snapshot', target: outcome.directory, id: outcome.id };
      if (outcome.report !== undefined) reports.push(`! smoo.developerLinks ${name}: ${outcome.report}`);
    }
    const target = binding.target;
    // The live checkout a snapshot replaces, by physical identity: a link spelled through another path is the same one.
    const sourcePhysical =
      binding.kind === 'snapshot' && typeof snapshot !== 'string' ? realpathSync(source) : undefined;
    for (const tree of trees) {
      const entry = path.join(tree, name);
      const at = path.join(root, entry);
      const stats = lstatSync(at, { throwIfNoEntry: false });
      if (stats === undefined) {
        continue;
      }
      if (stats.isSymbolicLink()) {
        const text = readlinkSync(at);
        const current = resolvedTarget(root, { path: entry, target: text });
        const foreign = !containsPath(path.resolve(root), current);
        // Any contained main-project binding inherited by this clone belongs to
        // the declaration, even if the old producer used a different directory.
        // A receipt proves an earlier managed sibling binding; an unrecorded
        // sibling or a manual retarget remains the developer's own choice.
        const inherited = inheritedContainedBinding(anchor, relative, current);
        const managed = recorded.get(entry)?.target === text;
        if (current === target && text === packageAliasTarget(root, at, target)) continue;
        if (
          sourcePhysical !== undefined &&
          foreign &&
          !inherited &&
          !managed &&
          realpathOrNull(current) === sourcePhysical
        ) {
          unavailable.push({ kind: 'snapshot-unclaimed', name, path: entry, source });
          continue;
        }
        if (foreign && !inherited && !managed && current !== target) continue;
      }
      changes.push({ path: entry, binding });
    }
  }
  return { changes, unavailable, reports };
}

/**
 * What the aliases of `name` keep when no snapshot of it can be made: each the sealed snapshot its receipt records.
 * An install re-points every alias at the lockfile's version before its postinstall plans this, so the binding an
 * alias had is its receipt's, never what it links now. An alias still on its receipt is left alone, unsaid: its
 * current binding stays. An alias whose receipt names no snapshot left in the store keeps what the install left, and
 * is counted so the refusal says so. A developer's own link out of the checkout stays theirs.
 */
function keptSnapshots(
  root: string,
  trees: readonly string[],
  name: string,
  recorded: ReadonlyMap<string, DeclaredLinkReceipt>,
): {
  readonly changes: readonly DeclaredLinkChange[];
  readonly said: { readonly kept: readonly string[]; readonly installed: number };
} {
  const changes: DeclaredLinkChange[] = [];
  const kept = new Set<string>();
  // One verification per sealed snapshot, however many trees alias it.
  const verified = new Map<string, SealedSnapshot | null>();
  let installed = 0;
  for (const tree of trees) {
    const entry = path.join(tree, name);
    const at = path.join(root, entry);
    const stats = lstatSync(at, { throwIfNoEntry: false });
    if (stats === undefined) continue;
    const text = stats.isSymbolicLink() ? readlinkSync(at) : null;
    const receipt = recorded.get(entry);
    if (text !== null && text === receipt?.target) continue;
    if (text !== null && !containsPath(path.resolve(root), resolvedTarget(root, { path: entry, target: text })))
      continue;
    let binding: SealedSnapshot | null = null;
    if (receipt !== undefined) {
      const target = resolvedTarget(root, receipt);
      binding = verified.has(target)
        ? (verified.get(target) ?? null)
        : recordedSnapshot(root, entry, name, receipt.target);
      verified.set(target, binding);
    }
    if (binding === null) {
      installed += 1;
      continue;
    }
    kept.add(binding.id);
    changes.push({ path: entry, binding: { kind: 'snapshot', target: binding.directory, id: binding.id } });
  }
  return { changes, said: { kept: [...kept], installed } };
}

/**
 * Where the @smoothbricks/nx-plugin that vouches for snapshots resolves from: the checkout its declaration links when
 * this machine has it, else the root's install, which is then what its aliases keep. Never the root's install over
 * a declaration: an install re-points the plugin alias at the lockfile's published version before this runs, and
 * that version cannot read a producer receipt only the declared checkout's plugin writes.
 */
function snapshotPluginRoot(root: string, anchor: string, declared: readonly DeclaredLink[]): string {
  const plugin = declared.find(({ name }) => name === '@smoothbricks/nx-plugin');
  if (plugin === undefined) return root;
  const source = declaredTarget(root, anchor, plugin.directory);
  if (typeof plugin.snapshot === 'string') return pinnedSnapshot(root, plugin.name, source, plugin.snapshot).directory;
  return unavailableReason(source) === null ? source : root;
}

/**
 * A contained declaration whose directory is absent here must not keep the binding it inherited from the
 * main checkout: restoring it is this checkout's job, never a borrowed sibling's.
 */
function assertNoInheritedBinding(root: string, anchor: string, name: string, relative: string, target: string): void {
  for (const tree of nodeModulesTrees(root)) {
    const entry = path.join(tree, name);
    const at = path.join(root, entry);
    if (!lstatSync(at, { throwIfNoEntry: false })?.isSymbolicLink()) continue;
    const current = resolvedTarget(root, { path: entry, target: readlinkSync(at) });
    if (!containsPath(path.resolve(root), current) && inheritedContainedBinding(anchor, relative, current)) {
      throw new Error(
        `contained declared package ${name} is missing at ${target}; restore it in this checkout, never borrow the main checkout's package`,
      );
    }
  }
}

/**
 * Makes `plan`'s changes and says what it linked, once per package, and
 * which declarations this machine cannot honour.
 */
export function applyDeclaredLinks(root: string, plan: DeclaredLinksPlan): void {
  for (const report of plan.reports) console.error(report);
  for (const unavailable of plan.unavailable) {
    switch (unavailable.kind) {
      case 'absent':
        console.error(
          `! smoo.developerLinks ${unavailable.name}: ${unavailable.target} ${unavailable.reason}; the installed version stays`,
        );
        break;
      case 'snapshot-refused': {
        const keeps = [
          ...unavailable.kept.map((id) => `its aliases stay bound to snapshot ${id}`),
          ...(unavailable.installed === 0
            ? []
            : [
                `${unavailable.installed} ${unavailable.installed === 1 ? 'alias with no recorded snapshot keeps' : 'aliases with no recorded snapshot keep'} the installed version`,
              ]),
        ];
        console.error(
          `! smoo.developerLinks ${unavailable.name}: no snapshot of ${unavailable.source}: ${unavailable.reason}; ${keeps.length === 0 ? 'its current binding stays' : keeps.join('; ')}`,
        );
        break;
      }
      case 'snapshot-unclaimed':
        console.error(
          `! smoo.developerLinks ${unavailable.name}: ${unavailable.path} links the live checkout ${unavailable.source} without a receipt, so it is not bound to a snapshot; remove that link and run the install once to bind it`,
        );
        break;
    }
  }
  if (plan.changes.length === 0) return;
  const declared = new Map(readDeclaredLinks(root).map((link) => [link.name, link.directory]));
  const recorded = readDeclaredRecord(root);
  const counts = new Map<string, number>();
  for (const change of plan.changes) {
    const name = packageName(change);
    const declaration = declared.get(name);
    if (declaration === undefined) throw new Error(`cannot apply an undeclared developer link: ${name}`);
    const at = path.join(root, change.path);
    replacePackageAlias(root, at, change.binding.target);
    recorded.set(change.path, { path: change.path, declaration, target: readlinkSync(at) });
    writeDeclaredRecord(root, recorded);
    const named =
      change.binding.kind === 'snapshot'
        ? `${name} -> snapshot ${change.binding.id} (${change.binding.target})`
        : `${name} -> ${change.binding.target}`;
    counts.set(named, (counts.get(named) ?? 0) + 1);
  }
  if (counts.size > 0) {
    const entries = [...counts].map(([named, count]) => (count === 1 ? named : `${named} (${count} links)`));
    console.error(`linked declared packages to local checkouts: ${entries.join(', ')}`);
  }
}

/**
 * Whether `current` is a binding this clone inherited from the main checkout its marker names: the
 * declaration is contained in that checkout and the link's target lies inside it, at whatever relative
 * path the older producer used.
 */
function inheritedContainedBinding(anchor: string, relative: string, current: string): boolean {
  const shared = path.resolve(anchor, relative);
  const inside = path.relative(anchor, shared);
  if (inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) return false;
  return containsPath(path.resolve(anchor), path.resolve(current));
}

function containsPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Existing ancestors must be real owned directories, not redirected namespaces. */
function assertOwnedPath(root: string, candidate: string): void {
  if (!containsPath(root, candidate)) throw new Error(`owned path escapes its owning checkout: ${candidate}`);
  let existing = candidate;
  while (true) {
    try {
      if (realpathSync(existing) !== existing) throw new Error(`path redirects its owned namespace: ${candidate}`);
      return;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      if (lstatSync(existing, { throwIfNoEntry: false })?.isSymbolicLink())
        throw new Error(`path has a dangling redirected namespace: ${candidate}`);
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
}

function refuseLegacyPackage(alias: string): void {
  const state = lstatSync(alias, { throwIfNoEntry: false });
  if (state !== undefined && !state.isSymbolicLink())
    throw new Error(
      `refuse to replace live non-link package ${alias}; its owning checkout must relocate this legacy directory to a distinct retained path while its CLI/daemon is inactive, then run the developer-links task again`,
    );
}

/** Rename replaces only the owned alias, never either target package. */
function replacePackageAlias(root: string, alias: string, target: string): void {
  const canonicalRoot = realpathSync(root);
  const ownedAlias = path.resolve(canonicalRoot, path.relative(path.resolve(root), path.resolve(alias)));
  assertOwnedPath(canonicalRoot, path.dirname(ownedAlias));
  refuseLegacyPackage(ownedAlias);
  mkdirSync(path.dirname(ownedAlias), { recursive: true });
  const scratch = mkdtempSync(path.join(path.dirname(ownedAlias), '.activation-'));
  try {
    const temporary = path.join(scratch, 'link');
    symlinkSync(packageAliasTarget(root, alias, target), temporary, 'dir');
    renameSync(temporary, ownedAlias);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Owned namespace aliases relocate with a checkout; genuine host/sibling bindings do not. */
function packageAliasTarget(root: string, alias: string, target: string): string {
  return containsPath(path.resolve(root), path.resolve(target)) ? path.relative(path.dirname(alias), target) : target;
}

/** Why `target` cannot be linked to, or null when it is a package directory this process can reach. */
function unavailableReason(target: string): string | null {
  try {
    if (!statSync(target).isDirectory()) return 'is not a directory';
    return existsSync(path.join(target, 'package.json')) ? null : 'has no package.json here';
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        return 'does not exist on this machine';
      }
      if (error.code === 'EACCES' || error.code === 'EPERM') {
        return 'cannot be read here';
      }
    }
    throw error;
  }
}

/** A package name as npm spells one: `name` or `@scope/name`, one segment each. */
const PACKAGE_NAME = /^(?:@[A-Za-z0-9_-][A-Za-z0-9._-]*\/)?[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/** An Nx task target as a declaration names one: `project:target`, optionally `:configuration`. */
const TARGET = /^[^:\s]+:[^:\s]+(?::[^:\s]+)?$/;

/** One `smoo.developerLinks` declaration: its package, its checkout directory, and whether aliases bind a snapshot. */
interface DeclaredLink {
  readonly name: string;
  readonly directory: string;
  readonly snapshot: SnapshotDeclaration | string | undefined;
}

/**
 * `smoo.developerLinks` from the root manifest: each package name with its
 * checkout directory, relative, given alone or as `{ directory, snapshot }`
 * where `snapshot` names a sealed snapshot ID or the provider targets that build it and its native
 * artifact modules (linked-snapshots.ts). Hand-validated, like
 * secret-references.ts validates `smoo.secrets`: this runs before anything is
 * installed. The shape is `PackageSmooConfig.developerLinks` in the
 * nx-plugin's workspace-manifest.ts.
 */
function readDeclaredLinks(root: string): DeclaredLink[] {
  const manifestPath = path.join(root, 'package.json');
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const smoo = typeof manifest === 'object' && manifest !== null ? Reflect.get(manifest, 'smoo') : undefined;
  const declared = typeof smoo === 'object' && smoo !== null ? Reflect.get(smoo, 'developerLinks') : undefined;
  if (declared === undefined) {
    return [];
  }
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
    throw new Error(`${manifestPath}: smoo.developerLinks must map package names to checkout directories`);
  }
  return Object.entries(declared).map(([name, declaration]): DeclaredLink => {
    if (!PACKAGE_NAME.test(name)) {
      throw new Error(`${manifestPath}: smoo.developerLinks key ${JSON.stringify(name)} is not a package name`);
    }
    if (name === 'nx') {
      throw new Error(
        `${manifestPath}: smoo.developerLinks.nx is obsolete: the consumer lockfile and patch own Nx; run smoo monorepo update`,
      );
    }
    const object = typeof declaration === 'object' && declaration !== null && !Array.isArray(declaration);
    const directory: unknown = object ? Reflect.get(declaration, 'directory') : declaration;
    if (typeof directory !== 'string' || directory.length === 0 || path.isAbsolute(directory)) {
      throw new Error(
        `${manifestPath}: smoo.developerLinks ${name} must be a directory relative to the main checkout, not ${JSON.stringify(directory)}`,
      );
    }
    if (!object) return { name, directory, snapshot: undefined };
    const snapshot: unknown = Reflect.get(declaration, 'snapshot');
    if (typeof snapshot === 'string') {
      if (!/^[0-9a-f]{64}$/.test(snapshot))
        throw new Error(`${manifestPath}: smoo.developerLinks ${name}.snapshot must be 64 lowercase hex digits`);
      return { name, directory, snapshot };
    }
    const targets: unknown =
      typeof snapshot === 'object' && snapshot !== null ? Reflect.get(snapshot, 'targets') : undefined;
    const artifactModules: unknown =
      typeof snapshot === 'object' && snapshot !== null ? Reflect.get(snapshot, 'artifactModules') : undefined;
    if (
      !Array.isArray(targets) ||
      targets.length === 0 ||
      !targets.every((target): target is string => typeof target === 'string' && TARGET.test(target)) ||
      !Array.isArray(artifactModules) ||
      !artifactModules.every((module): module is string => typeof module === 'string' && module.startsWith(`${name}/`))
    ) {
      throw new Error(
        `${manifestPath}: smoo.developerLinks ${name}.snapshot must name its provider targets ("project:target") and the ${name}/… modules that resolve its native artifacts`,
      );
    }
    return { name, directory, snapshot: { targets, artifactModules } };
  });
}

/** Project-contained declared directories follow their checkout; siblings retain the shared main anchor. */
function declaredTarget(root: string, anchor: string, relative: string): string {
  const shared = path.resolve(anchor, relative);
  const inside = path.relative(anchor, shared);
  if (inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) return shared;
  const candidate = path.resolve(root, inside);
  const canonicalRoot = realpathSync(root);
  let existing = candidate;
  while (true) {
    try {
      const physical = path.relative(canonicalRoot, realpathSync(existing));
      if (physical === '..' || physical.startsWith(`..${path.sep}`) || path.isAbsolute(physical)) {
        throw new Error(`contained declared directory escapes its owning checkout: ${candidate}`);
      }
      return candidate;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
}

/**
 * The stable anchor for genuine sibling directories is the project's main checkout.
 * A cowshed marker names it without reading main's tree. Contained declared
 * directories are projected into the current checkout by `declaredTarget`, with
 * physical containment checked against symlink escapes.
 */
function linkAnchor(root: string): string {
  let marker: unknown;
  try {
    marker = JSON.parse(readFileSync(path.join(root, '.cowshed', 'workspace.json'), 'utf8'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return root;
    }
    throw error;
  }
  const projectRoot = typeof marker === 'object' && marker !== null ? Reflect.get(marker, 'projectRoot') : undefined;
  return typeof projectRoot === 'string' && path.isAbsolute(projectRoot) ? projectRoot : root;
}

/** Ownership is the link text we wrote, not merely an alias path we once used. */
const DECLARED_RECORD = path.join('node_modules', '.smoo-declared-links');

function readDeclaredRecord(root: string): Map<string, DeclaredLinkReceipt> {
  const file = path.join(root, DECLARED_RECORD);
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return new Map();
    throw error;
  }
  // This raw bootstrap script runs before packages or Typia transforms exist,
  // like readDeclaredLinks. Malformed ownership is never treated as none.
  if (!Array.isArray(input)) throw new Error(`${file}: expected declared-link receipts`);
  const recorded = new Map<string, DeclaredLinkReceipt>();
  for (const row of input) {
    if (typeof row !== 'object' || row === null) throw new Error(`${file}: invalid declared-link receipt`);
    const entry: unknown = Reflect.get(row, 'path');
    const declaration: unknown = Reflect.get(row, 'declaration');
    const target: unknown = Reflect.get(row, 'target');
    if (typeof entry !== 'string' || typeof declaration !== 'string' || typeof target !== 'string') {
      throw new Error(`${file}: a receipt needs string path, declaration and target fields`);
    }
    if (recorded.has(entry)) throw new Error(`${file}: duplicate declared-link receipt for ${entry}`);
    recorded.set(entry, { path: entry, declaration, target });
  }
  return recorded;
}

/** Stable, atomic receipts relocate with node_modules and leave unchanged trees read-only. */
function writeDeclaredRecord(root: string, recorded: ReadonlyMap<string, DeclaredLinkReceipt>): void {
  const file = path.join(root, DECLARED_RECORD);
  const content = `${JSON.stringify([...recorded.values()].sort((a, b) => a.path.localeCompare(b.path)))}\n`;
  try {
    if (readFileSync(file, 'utf8') === content) return;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    if (recorded.size === 0) return;
  }
  const canonicalRoot = realpathSync(root);
  const owned = path.join(canonicalRoot, DECLARED_RECORD);
  assertOwnedPath(canonicalRoot, path.dirname(owned));
  const scratch = mkdtempSync(path.join(path.dirname(owned), '.declared-links-'));
  try {
    const temporary = path.join(scratch, 'record');
    writeFileSync(temporary, content);
    renameSync(temporary, owned);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * The root package's `postinstall`, `bun tooling/direnv/developer-links.ts`.
 * Bun runs it in the root it installed, so that root is the working
 * directory. A CI runner links nothing, as for setup-environment.ts `--links`.
 */
if (import.meta.main && process.env.GITHUB_ACTIONS !== 'true') {
  const root = process.cwd();
  applyDeclaredLinks(root, await planDeclaredLinks(root));
}

/** Where `at` physically resolves, or null when nothing is there. */
function realpathOrNull(at: string): string | null {
  try {
    return realpathSync(at);
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null;
    throw error;
  }
}
