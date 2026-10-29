/**
 * Immutable built snapshots of a source-linked package.
 *
 * A `smoo.developerLinks` declaration with a `snapshot` binds the package's
 * aliases to a sealed copy of its checkout instead of the live directory. The
 * provider's land, rebuild or install rewrites its `dist`, its native library
 * and its own `node_modules/.bun` store whenever it likes; a consumer task that
 * resolved the live directory would then read bytes no key of it describes. A
 * snapshot is copied from one provider state and never changes: a provider
 * change reaches the consumer only as another snapshot under another name.
 * An explicit snapshot ID resolves only from the consumer's existing store;
 * provider HEAD changes are informational and never select another snapshot.
 * Only a capture declaration opts into the provider's current state.
 *
 * What a snapshot holds, laid out as in the provider checkout so relative
 * resolution means what it meant there (exports, tsconfig `paths`, and the
 * native resolver's checkout-relative library):
 *
 * - every provider workspace package in the declared package's link closure:
 *   its manifest, the files its manifest's `files` publishes, and its
 *   `tsconfig.json` with every relative `extends` and project `references`
 *   entry it reaches (Bun applies a source module's tsconfig `paths`, and a
 *   solution-style config gives sources their options through a reference);
 * - the provider root manifest, which owns the files outside every package;
 * - the native library each declared artifact module's `nativeArtifactPath({})`
 *   names: the checkout's own build, never a consumer override;
 * - each such package's `node_modules` links. A link into the provider's own
 *   `node_modules/.bun` store copies that store entry whole; a link into Bun's
 *   global cache, as `bun pm cache` names it in the consumer checkout, stays an
 *   absolute link to it. Any other target refuses.
 *
 * Provenance is the provider's own Nx producer receipt. Every declared target
 * must be a probe hit (the read-only `probeBuilt`, which runs and
 * writes nothing), all at one committed tree, and every copied provider file must be
 * either the blob HEAD tracks at its path or an output the receipt inventories
 * with the same bytes. A stale output, a modified or untracked source file, or
 * a target that is not current refuses with its cause; nothing in the provider
 * is built or written. The capture is bracketed by a stat fingerprint of the
 * provider files it copies, so a provider written to while it is copied is
 * refused rather than half taken.
 *
 * A snapshot is named by the SHA-256 of its census (every entry's path, type,
 * executable bit, and its bytes or link text) together with its producer
 * receipt identity: the provider root, HEAD and its tree, the probe's file-input
 * provenance, every task id and hash, and the digest of each target's whole
 * producer completion record (argv, environment identity, inputs, tools, output
 * digest, wall time). Other bytes, another commit, another task hash or another
 * production is another snapshot, and nothing is captured without a fresh probe,
 * so no name or provenance is ever reused for a provider state it does not
 * describe. When no fresh snapshot can be made, an alias keeps the sealed one
 * its receipt records (`recordedSnapshot`), verified: the provider state it was
 * taken from, not the provider's current one.
 * A receipt without a producer record of a known version, as an older plugin's
 * cache hit gives, is refused. Files are sealed read-only, and a reader that
 * trusts a snapshot verifies its census, its retained producer records and its
 * name (`verifySnapshot`): modes and paths prove nothing.
 *
 * The store is `.cache/linked-snapshots` in the consumer checkout. Under cowshed
 * it is declared build state (`.cowshed.toml` `[build] state`), so it lives on
 * the checkout's build volume and travels with it (smoothbricks
 * specs/cowshed/16_build_volumes.md, "Declared build state"). A store cowshed
 * has not linked yet is refused, never filled: a refresh discards a real
 * directory at a declared path.
 *
 * Dependency-free except for the probe, which a capture loads only when it
 * needs one, from the @smoothbricks/nx-plugin its caller names (`pluginProbe`):
 * shell entry imports this before anything is installed.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  constants,
  copyFileSync,
  type Dirent,
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
import type * as EnsureBuiltModule from '@smoothbricks/nx-plugin/ensure-built';
import type { EnsureBuiltProbeResult } from '@smoothbricks/nx-plugin/ensure-built';

/** Presence only: what a loaded probe does is the plugin's contract, as the CLI checks keepDeveloperLinks. */
function isProbeBuilt(value: unknown): value is typeof EnsureBuiltModule.probeBuilt {
  return typeof value === 'function';
}

/** Where a consumer checkout keeps its snapshots, relative to its root. */
export const SNAPSHOT_STORE = path.join('.cache', 'linked-snapshots');

/** The file at the root of each sealed snapshot naming its identity and every entry. */
export const SNAPSHOT_RECEIPT = '.linked-snapshot.json';

/** What a `snapshot` declaration asks of the provider: the targets that build it and its native resolvers. */
export interface SnapshotDeclaration {
  /** Provider Nx targets (`project:target`) whose recorded outputs the snapshot publishes. */
  readonly targets: readonly string[];
  /** Modules of the package exporting `nativeArtifactPath()`, its own resolution of a native library. */
  readonly artifactModules: readonly string[];
}

export type CensusEntry =
  | { readonly path: string; readonly type: 'file'; readonly executable: boolean; readonly sha256: string }
  | { readonly path: string; readonly type: 'symlink'; readonly linkText: string };

/** The committed provider tree and original producer bases whose attested outputs the snapshot holds. */
export interface SnapshotProvenance {
  readonly root: string;
  readonly head: string;
  readonly headTree: string;
  /** How each probe vouched for its file inputs: exactly, or conservatively over the whole provider source. */
  readonly fileInputs: readonly string[];
  readonly tasks: readonly { readonly id: string; readonly hash: string }[];
  /** Each declared target's producer completion record, by the SHA-256 of its canonical JSON. */
  readonly producers: readonly { readonly target: string; readonly basis: string; readonly sha256: string }[];
}

export interface SnapshotReceipt {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  /** The declared package's directory inside the snapshot. */
  readonly packagePath: string;
  readonly provenance: SnapshotProvenance;
  /** The producer completion records `provenance.producers` digests, retained verbatim in target order. */
  readonly producerReceipts: readonly unknown[];
  readonly census: readonly CensusEntry[];
}

/** A sealed snapshot an alias binds: its id and the declared package's directory inside it. */
export interface SealedSnapshot {
  readonly kind: 'snapshot';
  readonly id: string;
  readonly directory: string;
  /** Informational pin freshness only; never a request to recapture or refuse a verified pin. */
  readonly report?: string;
}

export type SnapshotBinding = SealedSnapshot | { readonly kind: 'refused'; readonly reason: string };

/** Asks the provider whether `target` is current, without running anything. */
export type ProducerProbe = (target: string, providerRoot: string) => Promise<EnsureBuiltProbeResult>;

/** A known reason a snapshot cannot be made or trusted. It is said, never keyed. */
export class SnapshotRefusal extends Error {}

type PlanNode =
  | { readonly type: 'file'; readonly source: string; readonly provenance: 'provider' | 'store' }
  | { readonly type: 'symlink'; readonly linkText: string };

interface SnapshotPlan {
  readonly name: string;
  readonly root: string;
  /** Bun's immutable install cache the plan's links were classified against (`bunCacheRoot`). */
  readonly cache: string;
  readonly packagePath: string;
  readonly nodes: ReadonlyMap<string, PlanNode>;
}

type ProducerOutput = Extract<
  EnsureBuiltProbeResult,
  { readonly disposition: 'hit' }
>['receipt']['tasks'][number]['outputs'][number];

type ProducerRecord = Extract<EnsureBuiltProbeResult, { readonly disposition: 'hit' }>['receipt']['producer'];

/** The producer protocol versions this consumer reads. */
const PRODUCER_VERSION = 1;

/**
 * A snapshot ID resolves from the consumer's store, which imports it from its main checkout's store when it lacks it.
 * A capture declaration instead probes, copies and attests the provider's current state. A refusal names its cause and
 * leaves every binding as it was.
 */
export async function snapshotBinding(
  root: string,
  name: string,
  source: string,
  declaration: SnapshotDeclaration | string,
  probe: ProducerProbe,
): Promise<SnapshotBinding> {
  try {
    if (typeof declaration === 'string') return pinnedSnapshot(root, name, source, declaration);
    const store = snapshotStore(root);
    const plan = planSnapshot(source, name, declaration, bunCacheRoot(root));
    const id = await capture(store, plan, declaration, probe, fingerprintOf(plan));
    return { kind: 'snapshot', id, directory: path.join(store, id, plan.packagePath) };
  } catch (error) {
    if (error instanceof SnapshotRefusal) return { kind: 'refused', reason: error.message };
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
      return { kind: 'refused', reason: error.message };
    }
    throw error;
  }
}

/** Resolve an explicit content pin, never reading provider bytes or asking its producer to run. */
export function pinnedSnapshot(root: string, name: string, source: string, id: string): SealedSnapshot {
  if (!/^[0-9a-f]{64}$/.test(id)) throw new SnapshotRefusal(`snapshot pin ${id} must be 64 lowercase hex digits`);
  const sealed = storedPin(root, id);
  const receipt = verifySnapshot(sealed);
  if (receipt.name !== name) throw new SnapshotRefusal(`snapshot ${id} contains ${receipt.name}, not ${name}`);
  if (!contained(receipt.packagePath))
    throw new SnapshotRefusal(`snapshot ${id} has an invalid package path ${receipt.packagePath}`);
  const directory = path.join(sealed, receipt.packagePath);
  const head = spawnSync('git', ['-C', source, 'rev-parse', '--verify', 'HEAD'], {
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  const report =
    head.error !== undefined || head.status !== 0
      ? `cannot inspect ${source} HEAD for snapshot pin ${id}: ${head.error?.message ?? head.stderr.trim()}; continuing with the pin`
      : head.stdout.trim() !== receipt.provenance.head
        ? `stale pin ${id}: captured HEAD ${receipt.provenance.head} differs from ${source} HEAD ${head.stdout.trim()}; continuing with the pin; move snapshot explicitly to select another build`
        : undefined;
  return { kind: 'snapshot', id, directory, ...(report === undefined ? {} : { report }) };
}

/**
 * The store under `root`. A cowshed checkout keeps it on its build volume: until a refresh has linked it there,
 * an empty directory is left for that refresh to adopt and the capture refuses.
 */
function snapshotStore(root: string): string {
  const store = path.join(root, SNAPSHOT_STORE);
  if (lstatSync(path.join(root, '.cowshed', 'build'), { throwIfNoEntry: false })?.isSymbolicLink() !== true) {
    mkdirSync(store, { recursive: true });
    return store;
  }
  const state = lstatSync(store, { throwIfNoEntry: false });
  if (state?.isSymbolicLink() === true) return store;
  if (state === undefined) mkdirSync(store, { recursive: true });
  throw new SnapshotRefusal(
    `${store} is not on this checkout's build volume: declare "${SNAPSHOT_STORE}" in .cowshed.toml [build] state and run \`cowshed exec <workspace> -- true\` so its refresh links it`,
  );
}

/**
 * The probe of the @smoothbricks/nx-plugin that `from` resolves, loaded when a capture first asks. A plugin without
 * the read-only `probeBuilt` is refused before anything is called: its `ensureBuilt` builds, and a capture must never
 * write the provider. `from` is the plugin the consumer binds, never merely what its last install left: a plain
 * `bun install` re-points a declared plugin alias at the lockfile's published version before the postinstall that
 * captures runs (developer-links.ts).
 */
export function pluginProbe(from: string): ProducerProbe {
  return async (target, providerRoot) => {
    // Dynamic by necessity: this file runs before anything is installed, and only a capture needs the plugin.
    const specifier = Bun.resolveSync('@smoothbricks/nx-plugin/ensure-built', from);
    const plugin: unknown = await import(specifier);
    const probeBuilt = typeof plugin === 'object' && plugin !== null ? Reflect.get(plugin, 'probeBuilt') : undefined;
    if (!isProbeBuilt(probeBuilt)) {
      throw new SnapshotRefusal(
        `the @smoothbricks/nx-plugin resolved from ${from} (${specifier}) has no read-only probeBuilt, so ${target} cannot be vouched for without building it; bind a plugin that exports probeBuilt`,
      );
    }
    return probeBuilt({ target, cwd: providerRoot });
  };
}

/** What a snapshot of `source` would hold, read from the provider as it is now, with `cache` as Bun's cache. */
function planSnapshot(source: string, name: string, declaration: SnapshotDeclaration, cache: string): SnapshotPlan {
  const directory = realpathSync(source);
  const root = providerRoot(directory);
  const nodes = new Map<string, PlanNode>();
  const pending = [directory];
  const packages = new Map<string, Record<string, unknown>>();
  const entries = new Set<string>();
  const inside = (target: string): string => {
    const relative = path.relative(root, target);
    if (!contained(relative)) throw new SnapshotRefusal(`${target} lies outside the provider checkout ${root}`);
    return relative;
  };
  const addFile = (file: string, provenance: 'provider' | 'store') => {
    nodes.set(inside(file), { type: 'file', source: file, provenance });
  };
  const bind = (at: string) => {
    const linkPath = inside(at);
    let target: string;
    try {
      target = realpathSync(at);
    } catch {
      throw new SnapshotRefusal(`${at} is a link to nothing`);
    }
    if (contained(path.relative(cache, target))) {
      nodes.set(linkPath, { type: 'symlink', linkText: target });
      return;
    }
    const relative = path.relative(root, target);
    if (!contained(relative)) {
      throw new SnapshotRefusal(`${at} resolves to ${target}, outside the provider checkout and Bun's cache ${cache}`);
    }
    const segments = relative.split(path.sep);
    const modules = segments.indexOf('node_modules');
    if (modules === -1) {
      pending.push(target);
    } else if (modules === 0 && segments[1] === '.bun' && segments[2] !== undefined) {
      addEntry(path.join(root, 'node_modules', '.bun', segments[2]));
    } else {
      throw new SnapshotRefusal(`${at} resolves to ${target}, an install layout a snapshot cannot carry`);
    }
    nodes.set(linkPath, { type: 'symlink', linkText: path.relative(path.dirname(linkPath), relative) });
  };
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const child = path.join(at, entry.name);
      if (entry.isSymbolicLink()) bind(child);
      else if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) addFile(child, 'store');
      else throw new SnapshotRefusal(`${child} is neither a file, a directory nor a link`);
    }
  };
  const addEntry = (entry: string) => {
    if (entries.has(entry)) return;
    entries.add(entry);
    walk(entry);
  };
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (packages.has(next)) continue;
    const manifestPath = path.join(next, 'package.json');
    const manifest = readManifest(manifestPath);
    packages.set(next, manifest);
    addFile(manifestPath, 'provider');
    for (const file of packedFiles(next, manifest)) addFile(file, 'provider');
    for (const config of tsconfigChain(path.join(next, 'tsconfig.json'))) addFile(config, 'provider');
    for (const link of packageLinks(path.join(next, 'node_modules'))) bind(link);
  }
  addFile(path.join(root, 'package.json'), 'provider');
  for (const specifier of declaration.artifactModules) addFile(nativeArtifact(specifier, directory), 'provider');
  for (const [at, manifest] of packages) assertExportsPublished(at, manifest, root, nodes);
  return { name, root, cache, packagePath: path.relative(root, directory), nodes };
}

/**
 * The files a package's manifest `files` publishes, absolute. Shared with the linked-package digest, so the two
 * agree on what a source-linked package is made of. A package that publishes nothing refuses.
 */
export function packedFiles(
  directory: string,
  manifest: { readonly name?: unknown; readonly files?: unknown },
): string[] {
  const name = typeof manifest.name === 'string' ? manifest.name : directory;
  const packed = manifest.files;
  if (
    !Array.isArray(packed) ||
    packed.length === 0 ||
    !packed.every((pattern): pattern is string => typeof pattern === 'string')
  ) {
    throw new SnapshotRefusal(`source-linked ${name} at ${directory} has no declared source/output file closure`);
  }
  const excluded = packed.filter((pattern) => pattern.startsWith('!')).map((pattern) => new Bun.Glob(pattern.slice(1)));
  const files: string[] = [];
  for (const pattern of packed.filter((pattern) => !pattern.startsWith('!'))) {
    let glob = pattern;
    if (!/[*?[\]{}]/.test(pattern) && statSync(path.join(directory, pattern)).isDirectory()) glob = `${pattern}/**/*`;
    for (const file of new Bun.Glob(glob).scanSync({ cwd: directory, dot: true, onlyFiles: true })) {
      if (excluded.some((exclude) => exclude.match(file))) continue;
      files.push(path.resolve(directory, file));
    }
  }
  if (files.length === 0)
    throw new SnapshotRefusal(`source-linked ${name} at ${directory} has no readable source/output files`);
  return files;
}

/** The nearest directory at or above `directory` whose manifest declares workspaces, else the package itself. */
function providerRoot(directory: string): string {
  for (let at = directory; ; at = path.dirname(at)) {
    const manifestPath = path.join(at, 'package.json');
    if (
      lstatSync(manifestPath, { throwIfNoEntry: false }) !== undefined &&
      readManifest(manifestPath).workspaces !== undefined
    ) {
      return at;
    }
    if (path.dirname(at) === at) return directory;
  }
}

/**
 * Bun's immutable install cache as Bun names it in the consumer checkout `root`. Never in the provider: `bun pm`
 * opens its root manifest for writing just to print a path, and a sandboxed consumer may only read its provider (a
 * cowshed workspace's sibling grant). Every checkout reaches the cache through one literal path (smoothbricks
 * specs/cowshed/03_caches.md, "Link-target caches"), so a provider link into another cache refuses as outside it.
 */
function bunCacheRoot(root: string): string {
  const run = spawnSync('bun', ['pm', 'cache'], { cwd: root, encoding: 'utf8' });
  if (run.error !== undefined || run.status !== 0) {
    throw new SnapshotRefusal(
      `cannot establish Bun's immutable cache root in ${root}: ${run.error?.message ?? run.stderr}`,
    );
  }
  return realpathSync(run.stdout.trim());
}

function readManifest(manifestPath: string): Record<string, unknown> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new SnapshotRefusal(`cannot read ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new SnapshotRefusal(`${manifestPath} is not a package manifest`);
  }
  return Object.fromEntries(Object.entries(manifest));
}

/**
 * A package's `tsconfig.json` and every configuration it reaches, by relative path only: each `extends` and each
 * project `references` entry. A solution-style `tsconfig.json` (no files of its own) gives its sources their compiler
 * options only through a referenced project, so a source consumer that reads the package's tsconfig needs that
 * project too; it is a compile input, not documentation.
 */
function tsconfigChain(config: string): string[] {
  if (lstatSync(config, { throwIfNoEntry: false }) === undefined) return [];
  const chain: string[] = [];
  const relative = (file: string, edge: 'extends' | 'references', target: unknown): string => {
    if (typeof target !== 'string' || !(target.startsWith('./') || target.startsWith('../'))) {
      throw new SnapshotRefusal(`${file} ${edge} ${JSON.stringify(target)}, which a snapshot cannot carry`);
    }
    return path.resolve(path.dirname(file), target);
  };
  const visit = (file: string) => {
    if (chain.includes(file)) return;
    chain.push(file);
    let parsed: unknown;
    try {
      parsed = Bun.JSONC.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      throw new SnapshotRefusal(`cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const extended: unknown = Reflect.get(parsed, 'extends');
    if (extended !== undefined) {
      for (const base of Array.isArray(extended) ? extended : [extended]) {
        const resolved = relative(file, 'extends', base);
        const named = path.extname(resolved) === '.json' ? resolved : `${resolved}.json`;
        if (lstatSync(named, { throwIfNoEntry: false }) === undefined) {
          throw new SnapshotRefusal(`${file} extends ${base}, which does not exist`);
        }
        visit(named);
      }
    }
    const references: unknown = Reflect.get(parsed, 'references');
    if (references === undefined) return;
    if (!Array.isArray(references)) throw new SnapshotRefusal(`${file} references is not an array`);
    for (const reference of references) {
      const target: unknown =
        typeof reference === 'object' && reference !== null ? Reflect.get(reference, 'path') : undefined;
      const resolved = relative(file, 'references', target);
      // A reference names a project directory (its tsconfig.json) or a configuration file.
      const named = lstatSync(resolved, { throwIfNoEntry: false })?.isDirectory()
        ? path.join(resolved, 'tsconfig.json')
        : resolved;
      if (lstatSync(named, { throwIfNoEntry: false }) === undefined) {
        throw new SnapshotRefusal(`${file} references ${String(target)}, which does not exist`);
      }
      visit(named);
    }
  };
  visit(config);
  return chain;
}

/** Every link in a `node_modules` tree a package name could be: `name` and `@scope/name`. */
function packageLinks(tree: string): string[] {
  const links: string[] = [];
  for (const entry of directoryEntries(tree)) {
    if (entry.name.startsWith('.')) continue;
    const at = path.join(tree, entry.name);
    if (entry.isSymbolicLink()) {
      links.push(at);
    } else if (entry.name.startsWith('@') && entry.isDirectory()) {
      for (const scoped of directoryEntries(at)) {
        const scopedAt = path.join(at, scoped.name);
        if (!scoped.isSymbolicLink())
          throw new SnapshotRefusal(`${scopedAt} is not a link: a snapshot binds installs by link`);
        links.push(scopedAt);
      }
    } else {
      throw new SnapshotRefusal(`${at} is not a link: a snapshot binds installs by link`);
    }
  }
  return links;
}

function directoryEntries(directory: string): Dirent[] {
  try {
    return readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return [];
    throw error;
  }
}

/** The native library a provider module resolves for its own checkout: no consumer override reaches it. */
function nativeArtifact(specifier: string, directory: string): string {
  let resolver: unknown;
  try {
    resolver = import.meta.require(Bun.resolveSync(specifier, directory));
  } catch (error) {
    throw new SnapshotRefusal(
      `cannot load ${specifier} from ${directory}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const resolve =
    typeof resolver === 'object' && resolver !== null ? Reflect.get(resolver, 'nativeArtifactPath') : undefined;
  if (typeof resolve !== 'function') throw new SnapshotRefusal(`${specifier} exports no nativeArtifactPath()`);
  let artifact: unknown;
  try {
    artifact = resolve({});
  } catch (error) {
    // The provider's own words: an unbuilt library names the target that builds it and where.
    throw new SnapshotRefusal(error instanceof Error ? error.message : String(error));
  }
  if (typeof artifact !== 'string') throw new SnapshotRefusal(`${specifier} nativeArtifactPath() returned no path`);
  return artifact;
}

/** Every relative target a package's `exports` names must be a file the snapshot publishes. */
function assertExportsPublished(
  directory: string,
  manifest: Record<string, unknown>,
  root: string,
  nodes: ReadonlyMap<string, PlanNode>,
): void {
  const visit = (value: unknown, at: string) => {
    if (typeof value === 'string') {
      if (!value.startsWith('./') || value.includes('*')) return;
      if (nodes.get(path.relative(root, path.resolve(directory, value)))?.type !== 'file') {
        throw new SnapshotRefusal(`${directory} exports ${at} as ${value}, which it does not publish`);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item, at);
    } else if (typeof value === 'object' && value !== null) {
      for (const [key, item] of Object.entries(value)) visit(item, key.startsWith('.') ? key : `${at} (${key})`);
    }
  };
  visit(manifest.exports, '.');
}

/** Each planned file's identity as the filesystem states it: any write to it moves a field. */
function fingerprintOf(plan: SnapshotPlan): string {
  const hash = createHash('sha256');
  for (const [relative, node] of [...plan.nodes].sort(([left], [right]) => compare(left, right))) {
    if (node.type === 'symlink') {
      hash.update(`${relative}\0link\0${node.linkText}\n`);
      continue;
    }
    const stats = statSync(node.source, { bigint: true });
    hash.update(
      `${relative}\0file\0${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}:${stats.mode}\n`,
    );
  }
  return hash.digest('hex');
}

/** Copies `plan` into the store under its census name, after the provider's receipt vouches for every file. */
async function capture(
  store: string,
  plan: SnapshotPlan,
  declaration: SnapshotDeclaration,
  probe: ProducerProbe,
  fingerprint: string,
): Promise<string> {
  const { provenance, producers, outputs } = await producerReceipt(plan, declaration, probe);
  const tracked = trackedBlobs(plan, provenance.headTree);
  const incoming = mkdtempSync(path.join(store, '.incoming-'));
  try {
    const census: CensusEntry[] = [];
    for (const [relative, node] of [...plan.nodes].sort(([left], [right]) => compare(left, right))) {
      const destination = path.join(incoming, relative);
      mkdirSync(path.dirname(destination), { recursive: true });
      if (node.type === 'symlink') {
        symlinkSync(node.linkText, destination);
        census.push({ path: relative, type: 'symlink', linkText: node.linkText });
        continue;
      }
      copyFileSync(node.source, destination, constants.COPYFILE_FICLONE);
      const executable = (lstatSync(destination).mode & 0o111) !== 0;
      chmodSync(destination, executable ? 0o555 : 0o444);
      const bytes = readFileSync(destination);
      const digest = sha256(bytes);
      if (node.provenance === 'provider')
        attest(relative, bytes, digest, executable, tracked, outputs, plan, provenance);
      census.push({ path: relative, type: 'file', executable, sha256: digest });
    }
    if (
      fingerprintOf(planSnapshot(path.join(plan.root, plan.packagePath), plan.name, declaration, plan.cache)) !==
      fingerprint
    ) {
      throw new SnapshotRefusal(
        `${plan.root} changed while it was copied; nothing was published, so retry once it is quiet`,
      );
    }
    const id = snapshotId(census, provenance);
    const receipt: SnapshotReceipt = {
      version: 1,
      id,
      name: plan.name,
      packagePath: plan.packagePath,
      provenance,
      producerReceipts: producers,
      census,
    };
    writeFileSync(path.join(incoming, SNAPSHOT_RECEIPT), `${JSON.stringify(receipt)}\n`, { mode: 0o444 });
    publish(incoming, path.join(store, id), id);
    return id;
  } finally {
    rmSync(incoming, { recursive: true, force: true });
  }
}

/**
 * Every declared target has a producer hit for one committed tree; each original basis remains provenance. A target that
 * is not current is refused with the `nx run` that makes it so.
 */
async function producerReceipt(
  plan: SnapshotPlan,
  declaration: SnapshotDeclaration,
  probe: ProducerProbe,
): Promise<{
  readonly provenance: SnapshotProvenance;
  readonly producers: readonly ProducerRecord[];
  readonly outputs: ReadonlyMap<string, ProducerOutput>;
}> {
  if (declaration.targets.length === 0)
    throw new SnapshotRefusal(`${plan.name} declares no provider targets to vouch for its build`);
  let head: { readonly head: string; readonly headTree: string } | undefined;
  const tasks = new Map<string, string>();
  const fileInputs = new Set<string>();
  const outputs = new Map<string, ProducerOutput>();
  const producers: ProducerRecord[] = [];
  const identities: SnapshotProvenance['producers'][number][] = [];
  for (const target of declaration.targets) {
    const result = await probe(target, plan.root);
    switch (result.disposition) {
      case 'hit':
        break;
      case 'miss':
        throw new SnapshotRefusal(
          `${target} is not current in ${plan.root} (${result.reason.kind}: ${result.reason.taskId}); run \`nx run ${target}\` there`,
        );
      case 'failed':
        throw new SnapshotRefusal(`probing ${target} in ${plan.root} failed: ${JSON.stringify(result.reason)}`);
      default: {
        const unreachable: never = result;
        throw new Error(`unknown probe disposition: ${JSON.stringify(unreachable)}`);
      }
    }
    const receipt = result.receipt;
    if (realpathSync(receipt.workspaceRoot) !== plan.root) {
      throw new SnapshotRefusal(`${target} was probed in ${receipt.workspaceRoot}, not ${plan.root}`);
    }
    head ??= { head: receipt.head, headTree: receipt.headTree };
    if (receipt.headTree !== head.headTree) {
      throw new SnapshotRefusal(
        `${plan.root} moved from tree ${head.headTree} to ${receipt.headTree} while it was probed`,
      );
    }
    fileInputs.add(receipt.fileInputProvenance);
    const producer = producerOf(receipt, target, plan.root);
    producers.push(producer);
    identities.push({ target: producer.target, basis: receipt.head, sha256: sha256(canonicalJson(producer)) });
    for (const task of receipt.tasks) {
      const known = tasks.get(task.id);
      if (known !== undefined && known !== task.hash) {
        throw new SnapshotRefusal(`${task.id} hashed ${known} and ${task.hash} in one capture`);
      }
      tasks.set(task.id, task.hash);
      for (const output of task.outputs) {
        const existing = outputs.get(output.path);
        if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(output)) {
          throw new SnapshotRefusal(`${output.path} is inventoried with different bytes by two tasks`);
        }
        outputs.set(output.path, output);
      }
    }
  }
  if (head === undefined) throw new SnapshotRefusal(`${plan.name} has no provider receipt`);
  return {
    provenance: {
      root: plan.root,
      head: head.head,
      headTree: head.headTree,
      fileInputs: [...fileInputs].sort(compare),
      tasks: [...tasks].sort(([left], [right]) => compare(left, right)).map(([id, hash]) => ({ id, hash })),
      producers: identities,
    },
    producers,
    outputs,
  };
}

/**
 * The producer completion record a hit carries for `target`: present, of a version this consumer reads, produced for
 * that target from a clean tracked tree, with inputs for every task the receipt inventories. A receipt without one is
 * an older plugin's cache hit, which vouches for no production, and is refused rather than read some other way.
 */
function producerOf(
  receipt: Extract<EnsureBuiltProbeResult, { readonly disposition: 'hit' }>['receipt'],
  target: string,
  root: string,
): ProducerRecord {
  const present: unknown = Reflect.get(receipt, 'producer');
  if (typeof present !== 'object' || present === null) {
    throw new SnapshotRefusal(
      `${target} in ${root} has no producer completion receipt: its plugin vouches only for a cache hit, so publish ${target} through a plugin with producer receipts and run it there`,
    );
  }
  const version: unknown = Reflect.get(present, 'version');
  if (version !== PRODUCER_VERSION) {
    throw new SnapshotRefusal(
      `${target} in ${root} has a producer receipt of unknown version ${JSON.stringify(version)}`,
    );
  }
  const producer = receipt.producer;
  if (producer.target !== target) {
    throw new SnapshotRefusal(`${target} in ${root} carries the producer receipt of ${producer.target}`);
  }
  if (producer.trackedTreeClean !== true) {
    throw new SnapshotRefusal(`${target} in ${root} was produced from a tracked tree that was not clean`);
  }
  const described = new Set(producer.inputs.map(({ taskId }) => taskId));
  for (const task of receipt.tasks) {
    if (!described.has(task.id)) {
      throw new SnapshotRefusal(`${target} in ${root} has a producer receipt that records no inputs of ${task.id}`);
    }
  }
  return producer;
}

/** JSON with every object's keys in code-unit order, so one record has one digest wherever it was serialized. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => compare(left, right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * The blob HEAD tracks at each planned provider path, with its mode. Git runs under the provider's own configuration
 * alone: a sandboxed shell entry keeps the operator's HOME but may not read the operator's global configuration, and
 * git dies on it (specs/cowshed/04_sandbox.md, the runtime-input contract).
 */
function trackedBlobs(
  plan: SnapshotPlan,
  head: string,
): ReadonlyMap<string, { readonly mode: string; readonly id: string }> {
  const paths = [...plan.nodes]
    .filter(([, node]) => node.type === 'file' && node.provenance === 'provider')
    .map(([relative]) => relative);
  const run = spawnSync('git', ['-C', plan.root, 'ls-tree', '-z', head, '--', ...paths], {
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    maxBuffer: 1 << 28,
  });
  if (run.error !== undefined || run.status !== 0) {
    throw new SnapshotRefusal(`cannot list ${plan.root} at ${head}: ${run.error?.message ?? run.stderr}`);
  }
  const blobs = new Map<string, { readonly mode: string; readonly id: string }>();
  for (const line of run.stdout.split('\0')) {
    if (line === '') continue;
    const match = /^(\d+) blob ([0-9a-f]+)\t(.*)$/s.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined && match[3] !== undefined) {
      blobs.set(match[3], { mode: match[1], id: match[2] });
    }
  }
  return blobs;
}

/** A provider file is HEAD's tracked blob or an output its producing task recorded, byte for byte. */
function attest(
  relative: string,
  bytes: Uint8Array,
  digest: string,
  executable: boolean,
  tracked: ReadonlyMap<string, { readonly mode: string; readonly id: string }>,
  outputs: ReadonlyMap<string, ProducerOutput>,
  plan: SnapshotPlan,
  provenance: SnapshotProvenance,
): void {
  const blob = tracked.get(relative);
  if (blob !== undefined) {
    if (gitBlobId(bytes, blob.id.length) !== blob.id || (blob.mode === '100755') !== executable) {
      throw new SnapshotRefusal(
        `${path.join(plan.root, relative)} differs from tree ${provenance.headTree} (producer basis ${provenance.head}): a snapshot is committed source, so commit or discard it`,
      );
    }
    return;
  }
  const output = outputs.get(relative);
  if (output === undefined) {
    throw new SnapshotRefusal(
      `${path.join(plan.root, relative)} is neither tracked at tree ${provenance.headTree} (producer basis ${provenance.head}) nor an output Nx recorded for ${provenance.tasks.map(({ id }) => id).join(', ')}`,
    );
  }
  if (output.type !== 'file' || output.sha256 !== digest) {
    throw new SnapshotRefusal(
      `${path.join(plan.root, relative)} is not the bytes Nx recorded for it: the provider's outputs are stale, so rebuild them`,
    );
  }
}

/** Git's object id for `bytes` as a blob, in the repository's hash (SHA-1 ids are 40 digits, SHA-256 64). */
function gitBlobId(bytes: Uint8Array, length: number): string {
  return createHash(length === 64 ? 'sha256' : 'sha1')
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest('hex');
}

/** One digest over a census: every entry's path, type, executable bit, and bytes or link text. */
function censusId(census: readonly CensusEntry[]): string {
  return sha256(
    census
      .map((entry) =>
        entry.type === 'file'
          ? `${entry.path}\0file\0${entry.executable ? 'x' : '-'}\0${entry.sha256}`
          : `${entry.path}\0symlink\0${entry.linkText}`,
      )
      .sort(compare)
      .join('\n'),
  );
}

/** The snapshot's name: its census and the producer receipt that vouched for it, as one digest. */
function snapshotId(census: readonly CensusEntry[], provenance: SnapshotProvenance): string {
  return sha256(
    JSON.stringify([
      censusId(census),
      provenance.root,
      provenance.head,
      provenance.headTree,
      [...provenance.fileInputs].sort(compare),
      [...provenance.tasks].sort((left, right) => compare(left.id, right.id)).map(({ id, hash }) => [id, hash]),
      provenance.producers.map(({ target, basis, sha256: digest }) => [target, basis, digest]),
    ]),
  );
}

/**
 * Whole or not at all. A snapshot already published under the same name was copied from the same bytes under the
 * same receipt; it is bound only once its sealed files still verify.
 */
function publish(incoming: string, sealed: string, id: string): void {
  try {
    renameSync(incoming, sealed);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && (error.code === 'ENOTEMPTY' || error.code === 'EEXIST')))
      throw error;
    if (verifySnapshot(sealed).id !== id) throw new SnapshotRefusal(`${sealed} exists and is not snapshot ${id}`);
  }
}

/**
 * The project's main checkout: the anchor of genuine sibling directories (developer-links.ts `declaredTarget`), and
 * the checkout whose store a fork imports a pin from. A cowshed marker names it without reading main's tree.
 */
export function linkAnchor(root: string): string {
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

/**
 * Where pin `id` is sealed in `root`'s store. A store that lacks it imports it from the store of the project's main
 * checkout (`linkAnchor`): a snapshot is content-addressed, so the import copies it into a temporary entry of this
 * store, verifies its census and identity there under its name, and renames it into place. A pin neither store holds
 * refuses, naming both.
 */
function storedPin(root: string, id: string): string {
  const sealed = path.resolve(root, SNAPSHOT_STORE, id);
  if (lstatSync(sealed, { throwIfNoEntry: false }) !== undefined) return sealed;
  const main = path.resolve(linkAnchor(root), SNAPSHOT_STORE, id);
  if (main === sealed) throw new SnapshotRefusal(`${path.dirname(sealed)} holds no snapshot ${id}`);
  if (lstatSync(main, { throwIfNoEntry: false }) === undefined) {
    throw new SnapshotRefusal(
      `neither ${path.dirname(sealed)} nor the main checkout's ${path.dirname(main)} holds snapshot ${id}`,
    );
  }
  const incoming = mkdtempSync(path.join(snapshotStore(root), '.incoming-'));
  try {
    const copy = path.join(incoming, id);
    copySealed(main, copy);
    verifySnapshot(copy);
    publish(copy, sealed, id);
  } finally {
    rmSync(incoming, { recursive: true, force: true });
  }
  return sealed;
}

/** `from`'s tree made again at `to`: directories, files cloned with their modes, and links by their text. */
function copySealed(from: string, to: string): void {
  mkdirSync(to);
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const destination = path.join(to, entry.name);
    if (entry.isDirectory()) copySealed(source, destination);
    else if (entry.isSymbolicLink()) symlinkSync(readlinkSync(source), destination);
    else copyFileSync(source, destination, constants.COPYFILE_FICLONE);
  }
}

/**
 * The newest sealed snapshot of `name` this checkout's store, or else its link anchor's (the main checkout's), holds,
 * newest by the commit time of the HEAD it captured, as `source`'s repository knows it; or null when there is none.
 * What a live developer link serves while the live checkout's build does not describe its sources (developer-links.ts):
 * the last revision that was built and sealed, never the stale build, and never a refusal that stops shell entry.
 */
export function newestSealedSnapshot(
  root: string,
  name: string,
  source: string,
): (SealedSnapshot & { readonly head: string }) | null {
  const stores = [...new Set([path.join(root, SNAPSHOT_STORE), path.join(linkAnchor(root), SNAPSHOT_STORE)])];
  const candidates: { readonly directory: string; readonly receipt: SnapshotReceipt; readonly time: number }[] = [];
  for (const store of stores) {
    let entries: string[];
    try {
      entries = readdirSync(store);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const directory = path.join(store, entry);
      const receipt = readSealed(directory);
      if (receipt === null || receipt.name !== name || !contained(receipt.packagePath)) continue;
      const committed = spawnSync('git', ['-C', source, 'log', '-1', '--format=%ct', receipt.provenance.head], {
        encoding: 'utf8',
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
      });
      const time = Number.parseInt(committed.stdout.trim(), 10);
      if (committed.status === 0 && Number.isFinite(time)) candidates.push({ directory, receipt, time });
    }
  }
  candidates.sort((left, right) => right.time - left.time);
  for (const { directory, receipt } of candidates) {
    try {
      verifySnapshot(directory);
    } catch (error) {
      if (error instanceof SnapshotRefusal) continue;
      throw error;
    }
    return {
      kind: 'snapshot',
      id: receipt.id,
      directory: path.join(directory, receipt.packagePath),
      head: receipt.provenance.head,
    };
  }
  return null;
}

/** A sealed snapshot's receipt, or null when `directory` holds none. Its census is not verified here. */
export function readSealed(directory: string): SnapshotReceipt | null {
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(path.join(directory, SNAPSHOT_RECEIPT), 'utf8'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
  const receipt = parseReceipt(input, directory);
  if (receipt.id !== path.basename(directory)) {
    throw new SnapshotRefusal(`${directory} holds the receipt of snapshot ${receipt.id}`);
  }
  return receipt;
}

/**
 * The sealed snapshot of `name` in this checkout's store that `linkText`, an alias's recorded link at `entry`, binds,
 * once it verifies; or null when that text names no snapshot left in the store. When no new snapshot can be made the
 * alias keeps this one: an install has re-pointed it at the lockfile's version before its postinstall runs, and a
 * sealed snapshot never changes, so binding it again restores the binding the alias had, for the provider state it
 * was taken from.
 */
export function recordedSnapshot(root: string, entry: string, name: string, linkText: string): SealedSnapshot | null {
  const target = path.resolve(root, path.dirname(entry), linkText);
  const inside = path.relative(path.resolve(root, SNAPSHOT_STORE), target);
  if (inside === '' || !contained(inside)) return null;
  const directory = path.resolve(root, SNAPSHOT_STORE, inside.split(path.sep)[0] ?? inside);
  if (readSealed(directory) === null) return null;
  const receipt = verifySnapshot(directory);
  if (receipt.name !== name || path.join(directory, receipt.packagePath) !== target)
    throw new SnapshotRefusal(`${entry} records ${linkText}, which is not snapshot ${receipt.id}'s ${name}`);
  return { kind: 'snapshot', id: receipt.id, directory: target };
}

/**
 * The snapshot's receipt once every entry under `directory` matches its census exactly: the same paths, types,
 * executable bits and bytes or link text, and nothing else. Anything else refuses, naming the entry.
 */
export function verifySnapshot(directory: string): SnapshotReceipt {
  const receipt = readSealed(directory);
  if (receipt === null) throw new SnapshotRefusal(`${directory} is not a sealed snapshot`);
  if (snapshotId(receipt.census, receipt.provenance) !== receipt.id)
    throw new SnapshotRefusal(`${directory} has a census and receipt that are not its name`);
  if (
    receipt.producerReceipts.length !== receipt.provenance.producers.length ||
    receipt.producerReceipts.some((record, index) => {
      const named = receipt.provenance.producers[index];
      return (
        named === undefined ||
        sha256(canonicalJson(record)) !== named.sha256 ||
        typeof record !== 'object' ||
        record === null ||
        Reflect.get(record, 'target') !== named.target
      );
    })
  )
    throw new SnapshotRefusal(`${directory} retains producer receipts that are not the ones its name binds`);
  const expected = new Map(receipt.census.map((entry) => [entry.path, entry]));
  let seen = 0;
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const absolute = path.join(at, entry.name);
      const relative = path.relative(directory, absolute);
      if (relative === SNAPSHOT_RECEIPT) continue;
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      const census = expected.get(relative);
      if (census === undefined) throw new SnapshotRefusal(`${absolute} is not in snapshot ${receipt.id}'s census`);
      seen += 1;
      if (census.type === 'symlink') {
        if (!entry.isSymbolicLink() || readlinkSync(absolute) !== census.linkText) {
          throw new SnapshotRefusal(`${absolute} is not the link snapshot ${receipt.id} recorded`);
        }
      } else if (
        !entry.isFile() ||
        ((lstatSync(absolute).mode & 0o111) !== 0) !== census.executable ||
        sha256(readFileSync(absolute)) !== census.sha256
      ) {
        throw new SnapshotRefusal(`${absolute} is not the bytes snapshot ${receipt.id} recorded`);
      }
    }
  };
  walk(directory);
  if (seen !== expected.size)
    throw new SnapshotRefusal(`snapshot ${receipt.id} at ${directory} lost entries of its census`);
  return receipt;
}

/** Hand-validated: this runs before Typia or any package is installed. Malformed is never treated as absent. */
function parseReceipt(input: unknown, directory: string): SnapshotReceipt {
  const fail = (what: string): never => {
    throw new SnapshotRefusal(`${path.join(directory, SNAPSHOT_RECEIPT)}: ${what}`);
  };
  if (typeof input !== 'object' || input === null) return fail('not a snapshot receipt');
  const field = (name: string): unknown => Reflect.get(input, name);
  const text = (value: unknown, what: string): string =>
    typeof value === 'string' ? value : fail(`${what} is not text`);
  if (field('version') !== 1) return fail('unknown receipt version');
  const provenance = field('provenance');
  if (typeof provenance !== 'object' || provenance === null) return fail('no provenance');
  const tasks = Reflect.get(provenance, 'tasks');
  const producers = Reflect.get(provenance, 'producers');
  const producerReceipts = field('producerReceipts');
  const census = field('census');
  if (!Array.isArray(tasks) || !Array.isArray(census)) return fail('no tasks or census');
  if (!Array.isArray(producers) || !Array.isArray(producerReceipts)) return fail('no producer receipts');
  return {
    version: 1,
    id: text(field('id'), 'id'),
    name: text(field('name'), 'name'),
    packagePath: text(field('packagePath'), 'packagePath'),
    provenance: {
      root: text(Reflect.get(provenance, 'root'), 'provenance.root'),
      head: text(Reflect.get(provenance, 'head'), 'provenance.head'),
      headTree: text(Reflect.get(provenance, 'headTree'), 'provenance.headTree'),
      fileInputs: fileInputsOf(Reflect.get(provenance, 'fileInputs'), fail),
      tasks: tasks.map((task: unknown) =>
        typeof task === 'object' && task !== null
          ? { id: text(Reflect.get(task, 'id'), 'task id'), hash: text(Reflect.get(task, 'hash'), 'task hash') }
          : fail('a task is not an object'),
      ),
      producers: producers.map((producer: unknown) =>
        typeof producer === 'object' && producer !== null
          ? {
              target: text(Reflect.get(producer, 'target'), 'producer target'),
              basis: text(Reflect.get(producer, 'basis'), 'producer basis'),
              sha256: text(Reflect.get(producer, 'sha256'), 'producer sha256'),
            }
          : fail('a producer is not an object'),
      ),
    },
    producerReceipts,
    census: census.map((entry: unknown): CensusEntry => {
      if (typeof entry !== 'object' || entry === null) return fail('a census entry is not an object');
      const entryPath = text(Reflect.get(entry, 'path'), 'census path');
      const type = Reflect.get(entry, 'type');
      if (type === 'symlink')
        return { path: entryPath, type, linkText: text(Reflect.get(entry, 'linkText'), 'linkText') };
      if (type !== 'file') return fail(`${entryPath} has an unknown type`);
      const executable = Reflect.get(entry, 'executable');
      if (typeof executable !== 'boolean') return fail(`${entryPath} has no executable bit`);
      return { path: entryPath, type, executable, sha256: text(Reflect.get(entry, 'sha256'), 'sha256') };
    }),
  };
}

function contained(relative: string): boolean {
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

function fileInputsOf(value: unknown, fail: (what: string) => never): string[] {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    return fail('provenance.fileInputs is not a list of text');
  }
  return value;
}
