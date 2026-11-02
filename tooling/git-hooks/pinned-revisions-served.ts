/**
 * Every git revision Cargo.lock pins, judged against the remote it names, which is where CI fetches it.
 *
 * A workspace pins an external crate by git revision and builds it from the local Cargo git database, so a pin lands
 * with no publish and no waiting. CI meets the pin only once the tree is pushed: its runner has nothing but the remote,
 * and cargo (`net.git-fetch-with-cli`) asks the remote for the revision. When the remote does not serve it, every build
 * that reaches the crate fails ("upload-pack: not our ref"). So a land gate reports such a pin (`--report`, exit 0):
 * reported, never waited on. No push or land holds for a remote; the pinned repository's own push serves the revision.
 *
 * "Served" is what cargo does: fetch the revision by id, and when the remote refuses that, fetch its branches and tags
 * and look for the revision among them. A remote the fetch cannot reach, or that does not answer within the report's
 * budget, proves nothing either way and is said as that. One remote's asks run one after another in its scratch
 * repository, since concurrent fetches there contend for git's own locks. Like the other managed git-hook helpers it
 * imports only the runtime.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** One pinned revision of one remote, with the packages Cargo.lock builds from it. */
export interface Pin {
  readonly url: string;
  readonly rev: string;
  readonly packages: readonly string[];
}

export type PinsRead =
  | { readonly kind: 'pins'; readonly pins: readonly Pin[] }
  | { readonly kind: 'malformed'; readonly detail: string };

export type PinAnswer =
  | { readonly kind: 'served' }
  | { readonly kind: 'unserved' }
  | { readonly kind: 'unreachable'; readonly detail: string };

/** Asks one remote for one revision, answering `unreachable` once `budgetMs` has passed. */
export type AskRemote = (url: string, rev: string, budgetMs: number) => Promise<PinAnswer>;

/** How long a land gate's report waits for the remotes' answers, all of them together. */
export const REPORT_BUDGET_MS = 60_000;

const REVISION = /^[0-9a-f]{40}$/;

function malformed(detail: string): PinsRead {
  return { kind: 'malformed', detail };
}

/** `Array.isArray` narrows `unknown` to `any[]`; this keeps the elements `unknown`. */
function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** The git sources of a Cargo.lock, `source = "git+<url>[?<reference>]#<revision>"`, one pin per remote and revision. */
export function readPins(lockText: string): PinsRead {
  let parsed: unknown;
  try {
    parsed = Bun.TOML.parse(lockText);
  } catch (error) {
    return malformed(`Cargo.lock is not TOML: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== 'object' || parsed === null) return malformed('Cargo.lock is not a table');
  if (!('package' in parsed)) return { kind: 'pins', pins: [] };
  const entries = parsed.package;
  if (!isArray(entries)) return malformed('Cargo.lock `package` is not an array of tables');
  const pins = new Map<string, { readonly url: string; readonly rev: string; readonly packages: string[] }>();
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null || !('name' in entry) || typeof entry.name !== 'string')
      return malformed(`a Cargo.lock package has no name: ${JSON.stringify(entry)}`);
    if (!('source' in entry)) continue;
    const source = entry.source;
    if (typeof source !== 'string') return malformed(`${entry.name}'s source is not a string`);
    if (!source.startsWith('git+')) continue;
    const hash = source.lastIndexOf('#');
    const rev = hash === -1 ? '' : source.slice(hash + 1);
    if (!REVISION.test(rev)) return malformed(`${entry.name}'s git source names no full revision: ${source}`);
    const located = source.slice('git+'.length, hash);
    const query = located.indexOf('?');
    const url = query === -1 ? located : located.slice(0, query);
    const key = `${url}#${rev}`;
    const pin = pins.get(key) ?? { url, rev, packages: [] };
    pin.packages.push(entry.name);
    pins.set(key, pin);
  }
  return { kind: 'pins', pins: [...pins.values()] };
}

export function describePin(pin: Pin, answer: PinAnswer): string {
  const built = `Cargo.lock builds ${pin.packages.join(', ')} from it`;
  switch (answer.kind) {
    case 'served':
      return `${pin.url} serves ${pin.rev} (${built})`;
    case 'unserved':
      return `${pin.url} does not serve ${pin.rev} (${built})`;
    case 'unreachable':
      return `could not ask ${pin.url} for ${pin.rev} (${built}): ${answer.detail}`;
  }
}

function formatSeconds(ms: number): string {
  return `${Math.round(ms / 1000)} s`;
}

interface GitRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The git children alive now, which a signal that ends this process ends too. */
const CHILDREN = new Set<{ kill(): void }>();

async function git(args: readonly string[], cwd: string, signal?: AbortSignal): Promise<GitRun> {
  const child = Bun.spawn(['git', ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    // A hook and a gate run unattended: a remote that wants credentials it has no helper for refuses instead of asking.
    // A partial repository never goes back to its remote for an object it lacks: absence is the answer.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1' },
    ...(signal === undefined ? {} : { signal }),
  });
  CHILDREN.add(child);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { exitCode, stdout, stderr: stderr.trim() };
  } finally {
    CHILDREN.delete(child);
  }
}

async function gitOrThrow(args: readonly string[], cwd: string): Promise<void> {
  const run = await git(args, cwd);
  if (run.exitCode !== 0) throw new Error(`git ${args.join(' ')} exited ${run.exitCode} in ${cwd}: ${run.stderr}`);
}

/**
 * Asks each remote through a scratch repository of its own under `scratchRoot`, kept for the asker's life so that a
 * repeated ask fetches only what changed. Commits are all it fetches (`--filter=tree:0`). One remote's asks run one
 * after another, each against the deadline it was given when it was asked, so a queued ask cannot outlive it either.
 */
export function remoteAsker(scratchRoot: string): AskRemote {
  const repositories = new Map<string, Promise<string>>();
  const queues = new Map<string, Promise<unknown>>();
  const repository = (url: string): Promise<string> => {
    const known = repositories.get(url);
    if (known !== undefined) return known;
    const directory = join(scratchRoot, String(repositories.size));
    const created = (async () => {
      await gitOrThrow(['init', '--quiet', '--bare', directory], scratchRoot);
      await gitOrThrow(['remote', 'add', 'pin', url], directory);
      return directory;
    })();
    repositories.set(url, created);
    return created;
  };
  const fetch = ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--filter=tree:0'];
  const askNow = async (url: string, rev: string, budgetMs: number, signal: AbortSignal): Promise<PinAnswer> => {
    const silent: PinAnswer = { kind: 'unreachable', detail: `no answer within ${formatSeconds(budgetMs)}` };
    if (signal.aborted) return silent;
    const directory = await repository(url);
    const direct = await git([...fetch, '--depth=1', 'pin', rev], directory, signal);
    if (direct.exitCode === 0) return { kind: 'served' };
    if (signal.aborted) return silent;
    const listed = await git(
      [...fetch, 'pin', '+refs/heads/*:refs/pinned/heads/*', '+refs/tags/*:refs/pinned/tags/*'],
      directory,
      signal,
    );
    if (signal.aborted) return silent;
    if (listed.exitCode !== 0)
      return { kind: 'unreachable', detail: listed.stderr || direct.stderr || `git fetch exited ${listed.exitCode}` };
    const found = await git(['cat-file', '-e', `${rev}^{commit}`], directory);
    return found.exitCode === 0 ? { kind: 'served' } : { kind: 'unserved' };
  };
  return (url, rev, budgetMs) => {
    const signal = AbortSignal.timeout(Math.max(0, budgetMs));
    const asked = (queues.get(url) ?? Promise.resolve()).then(() => askNow(url, rev, budgetMs, signal));
    queues.set(
      url,
      asked.catch(() => undefined),
    );
    return asked;
  };
}

function pinsOf(text: string, where: string): readonly Pin[] {
  const read = readPins(text);
  if (read.kind === 'malformed') throw new Error(`${where}: ${read.detail}`);
  return read.pins;
}

const USAGE = 'usage: pinned-revisions-served.ts --report';

async function report(root: string, ask: AskRemote): Promise<number> {
  const file = Bun.file(join(root, 'Cargo.lock'));
  if (!(await file.exists())) return 0;
  const pins = pinsOf(await file.text(), join(root, 'Cargo.lock'));
  const answers = await Promise.all(
    pins.map(async (pin) => [pin, await ask(pin.url, pin.rev, REPORT_BUDGET_MS)] as const),
  );
  const unserved = answers.filter(([, answer]) => answer.kind === 'unserved');
  const unanswered = answers.filter(([, answer]) => answer.kind === 'unreachable');
  if (unserved.length === 0 && unanswered.length === 0) {
    const remotes = new Set(pins.map((pin) => pin.url)).size;
    console.log(
      `PINNED-REVISIONS: every git revision Cargo.lock pins is served (${pins.length} pin(s), ${remotes} remote(s))`,
    );
    return 0;
  }
  const counted = [
    ...(unserved.length === 0 ? [] : [`${unserved.length} pinned revision(s) their remote does not serve`]),
    ...(unanswered.length === 0 ? [] : [`${unanswered.length} whose remote did not answer`]),
  ].join(' and ');
  console.log(
    `PINNED-REVISIONS note: ${counted}, reported, never waited on: the land builds them from the local Cargo git database, and CI fetches them from their remote, so push each one there (the pinned repository's own land normally does):\n` +
      [...unserved, ...unanswered].map(([pin, answer]) => `  ${describePin(pin, answer)}`).join('\n'),
  );
  return 0;
}

if (import.meta.main) {
  const [mode, ...rest] = process.argv.slice(2);
  const root = process.cwd();
  const scratch = mkdtempSync(join(tmpdir(), 'pinned-revisions-'));
  const removeScratch = () => rmSync(scratch, { recursive: true, force: true });
  // A signal skips `finally`: end the fetches and remove what they fetched, then exit as the signal would have.
  for (const [name, number] of [
    ['SIGINT', 2],
    ['SIGTERM', 15],
    ['SIGHUP', 1],
  ] as const)
    process.on(name, () => {
      for (const child of CHILDREN) child.kill();
      removeScratch();
      process.exit(128 + number);
    });
  try {
    const ask = remoteAsker(scratch);
    if (mode === '--report' && rest.length === 0) process.exitCode = await report(root, ask);
    else {
      console.error(USAGE);
      process.exitCode = 2;
    }
  } finally {
    removeScratch();
  }
}
