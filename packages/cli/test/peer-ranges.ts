import { existsSync } from 'node:fs';
import { join } from 'node:path';

const EXAMPLE_MODULES = join(import.meta.dir, '..', '..', '..', 'example', 'website-with-cms', 'node_modules');
const PUBLISHED = join(import.meta.dir, 'fixtures', 'peer-manifests');

interface Manifest {
  name: string;
  version: string;
  peerDependencies?: Record<string, string>;
}

/**
 * The manifest of the release `range` resolves to: the example site's install, which holds the same releases, else the
 * published manifest recorded under fixtures/peer-manifests/<name>@<version> for a release the workspace does not
 * install (ttsc: smoo pins the workspace's). Throws when neither matches, so a moved range cannot pass on stale peers.
 */
async function manifestFor(name: string, range: string): Promise<Manifest> {
  const installed: Manifest = await Bun.file(join(EXAMPLE_MODULES, name, 'package.json')).json();
  if (Bun.semver.satisfies(installed.version, range)) return installed;
  const version = range.replace(/^[\^~]/, '');
  const published = join(PUBLISHED, `${name}@${version}`, 'package.json');
  if (!existsSync(published)) {
    throw new Error(`no manifest of ${name} matching ${range}: the example installs ${installed.version}`);
  }
  return Bun.file(published).json();
}

/**
 * `peer: range & range` for each peer that no single version satisfies across the `declared` range and the ranges the
 * declared packages ask for, so npm would refuse the set with ERESOLVE. `workspace:` peers are ranges pack time rewrites
 * (all of @conloca/cli's are, and it is not in the example), and TypeScript (or an npm alias of it) declares no peers.
 */
export async function unsatisfiablePeers(declared: Record<string, string>): Promise<string[]> {
  const manifests = await Promise.all(
    Object.entries(declared)
      .filter(([pkg, spec]) => pkg !== '@conloca/cli' && pkg !== 'typescript' && !spec.startsWith('npm:'))
      .map(([pkg, spec]) => manifestFor(pkg, spec)),
  );
  const ranges = new Map<string, string[]>();
  for (const manifest of manifests) {
    for (const [peer, range] of Object.entries(manifest.peerDependencies ?? {})) {
      if (range.startsWith('workspace:')) continue;
      const own = declared[peer];
      ranges.set(peer, [...(ranges.get(peer) ?? (own ? [own] : [])), range]);
    }
  }
  // A non-empty intersection of these ranges contains one of their own bounds, so those are the candidates.
  return [...ranges]
    .filter(([, list]) => {
      const candidates = list.flatMap((range) => range.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?/g) ?? []);
      return !candidates.some((version) => list.every((range) => Bun.semver.satisfies(version, range)));
    })
    .map(([peer, list]) => `${peer}: ${list.join(' & ')}`);
}
