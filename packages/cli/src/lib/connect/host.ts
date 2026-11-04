import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { parse } from 'jsonc-parser';
import { isRecord } from '../is-record.js';
import { DISPATCHER_MAIN, readWranglerFile } from './preview-deploy.js';

export type PreviewHost = 'cloudflare-d3' | 'cloudflare' | 'vercel' | 'netlify' | 'node' | 'static-only';
export type HostAnswer =
  | { ok: true; host: PreviewHost; evidence: string[] }
  | { ok: false; reason: 'unknown' | 'conflict'; message: string };

type Evidence = { host: 'vercel' | 'netlify' | 'cloudflare' | 'node'; source: string; starter?: true };

const HOST_CHOICES = 'vercel|netlify|cloudflare|node';
/** The start command of a D2 preview server, and of the site server that renders drafts since d8. */
export const D2_ENTRY = '.conloca/preview-server/server/entry.mjs';
export const D8_ENTRY = 'dist/server/entry.mjs';
const NODE_ENTRIES = [D8_ENTRY, D2_ENTRY];
// A deploy file this large is not a hand-written start command.
const STARTER_MAX_BYTES = 1024 * 1024;

/** projectDir and each folder above it up to and including repoRoot; never a folder outside the repository. */
export function foldersUp(projectDir: string, repoRoot: string): string[] {
  const folders: string[] = [];
  for (let dir = projectDir; ; dir = dirname(dir)) {
    const rel = relative(repoRoot, dir);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) break;
    folders.push(dir);
    if (rel === '' || dirname(dir) === dir) break;
  }
  return folders;
}

const startsEntry = (text: string) => NODE_ENTRIES.some((entry) => text.includes(entry));

/** Whether a deploy file named `name` starts the Node server entry. */
function startsServer(name: string, text: string): boolean {
  if (name.startsWith('Dockerfile')) {
    return text.split('\n').some((line) => /^\s*(CMD|ENTRYPOINT)\b/i.test(line) && startsEntry(line));
  }
  if (name === 'Procfile' || name === 'fly.toml') return startsEntry(text);
  const pkg: unknown = parse(text);
  const scripts = isRecord(pkg) && isRecord(pkg.scripts) ? Object.values(pkg.scripts) : [];
  return scripts.some((script) => typeof script === 'string' && startsEntry(script));
}

/** The files that can start a Node server: Dockerfiles, Procfile, fly.toml and package.json. */
export const isStarterFile = (name: string) =>
  name.startsWith('Dockerfile') || ['Procfile', 'fly.toml', 'package.json'].includes(name);

/** The files in `dir` that start the Node server entry. */
async function nodeStarters(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const names = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(isStarterFile);
  const starts = await Promise.all(
    names.map(async (name) => {
      const path = join(dir, name);
      if ((await stat(path)).size > STARTER_MAX_BYTES) return false;
      return startsServer(name, await readFile(path, 'utf8'));
    }),
  );
  return names.filter((_, index) => starts[index]).map((name) => join(dir, name));
}

/**
 * Where the site deploys, from the flag and its files. The wrangler config is read only in `projectDir`; vercel.json,
 * netlify.toml and Node starters from there up to `repoRoot`.
 */
export async function detectHost(input: {
  projectDir: string;
  repoRoot: string;
  astroText: string;
  flag?: PreviewHost;
}): Promise<HostAnswer> {
  const UNKNOWN: HostAnswer = {
    ok: false,
    reason: 'unknown',
    message: `can't tell where this site deploys: pass --host ${HOST_CHOICES}`,
  };
  if (input.flag !== undefined) return { ok: true, host: input.flag, evidence: ['--host'] };
  const folders = foldersUp(input.projectDir, input.repoRoot);
  // A project outside the repository: none of its files may speak for it.
  if (folders.length === 0) return UNKNOWN;
  const wrangler = await readWranglerFile(input.projectDir);
  const name = (path: string) => relative(input.repoRoot, path) || path;
  if (wrangler.kind === 'jsonc') {
    const config: unknown = parse(wrangler.text);
    if (isRecord(config) && config.main === DISPATCHER_MAIN) {
      return { ok: true, host: 'cloudflare-d3', evidence: [name(wrangler.path)] };
    }
  }

  const evidence: Evidence[] = [];
  const code = input.astroText.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gmu, '');
  const adapter = /@astrojs\/(vercel|netlify|cloudflare|node)\b/u.exec(code)?.[1];
  if (adapter === 'vercel' || adapter === 'netlify' || adapter === 'cloudflare' || adapter === 'node') {
    evidence.push({ host: adapter, source: 'astro.config' });
  }
  const starters = await Promise.all(folders.map(nodeStarters));
  for (const [index, dir] of folders.entries()) {
    // `.vercel/` is a local link to a project, not proof the site deploys there.
    if (existsSync(join(dir, 'vercel.json'))) evidence.push({ host: 'vercel', source: name(join(dir, 'vercel.json')) });
    if (existsSync(join(dir, 'netlify.toml'))) {
      evidence.push({ host: 'netlify', source: name(join(dir, 'netlify.toml')) });
    }
    for (const path of starters[index] ?? []) evidence.push({ host: 'node', source: name(path), starter: true });
  }
  if (wrangler.kind !== 'none') evidence.push({ host: 'cloudflare', source: name(wrangler.path) });

  const [first] = evidence;
  // Node only when the repo already starts the server: a node() adapter alone says nothing about the host.
  const nodeUnstarted = evidence.every((item) => item.host === 'node' && !item.starter);
  if (first === undefined || nodeUnstarted) return UNKNOWN;
  const other = evidence.find((item) => item.host !== first.host);
  if (other !== undefined) {
    return {
      ok: false,
      reason: 'conflict',
      message: `${first.source} names ${first.host} but ${other.source} deploys to ${other.host}: pass --host ${HOST_CHOICES}`,
    };
  }
  return { ok: true, host: first.host, evidence: evidence.map((item) => item.source) };
}
