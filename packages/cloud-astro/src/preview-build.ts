import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  PACKAGE_NAME,
  PREVIEW_BUILD_ENV_FLAG,
  PREVIEW_MODE_ENV,
  PREVIEW_PRERENDERED_ENV,
  REFUSED_PREVIEW_ADAPTERS,
} from './constants.js';
import type { PreviewBuildOptions } from './types.js';

/**
 * How drafts are served, from the options and the project's adapter: off unless `previewBuild` is given as an
 * object; D4 with `separate: true`; D3 for a static site, whose preview server runs next to it on Cloudflare
 * Workers; D8 when an adapter is named, since drafts render in the site's own build. Throws for options that cannot
 * work: `separate` under an adapter that deploys from the project root, and `previewBuild.adapter`
 * (`previewAdapterName`) at all.
 */
export function previewBuildMode(
  previewBuild: PreviewBuildOptions | false | undefined,
  adapterName: string | undefined,
  previewAdapterName?: string,
): 'off' | 'd3' | 'd4' | 'd8' {
  if (!previewBuild) return 'off';
  if (previewAdapterName !== undefined) {
    throw new Error(
      `${PACKAGE_NAME}: previewBuild.adapter has no effect: drafts render in the site's own build, through the ` +
        'adapter in astro.config. Remove previewBuild.adapter.',
    );
  }
  if (previewBuild.separate === true) {
    if (adapterName !== undefined && REFUSED_PREVIEW_ADAPTERS.includes(adapterName)) {
      throw new Error(
        `${PACKAGE_NAME}: previewBuild.separate is not supported with ${adapterName}: the separate preview build ` +
          `would write its output where ${adapterName} deploys the live site. Remove separate: true; with ` +
          `${adapterName} drafts render in the site's own build.`,
      );
    }
    return 'd4';
  }
  return adapterName === undefined ? 'd3' : 'd8';
}

/**
 * The mode a preview build serves in: the site's build names D3; anything else is a separate preview deploy (D4),
 * the flag alone included. A `d2` from an older release's parent is no child mode any more.
 */
export function previewChildMode(env: NodeJS.ProcessEnv): 'd3' | 'd4' {
  return env[PREVIEW_MODE_ENV] === 'd3' ? 'd3' : 'd4';
}

/**
 * One route the site's build prerendered, as a D3 child matches it: pattern and component together, since one
 * entrypoint can be injected at two patterns, one published and one only the preview build has.
 */
export function prerenderedKey(pattern: string, component: string): string {
  return JSON.stringify([pattern, component]);
}

/** The routes (`prerenderedKey`) a D3 child's site build prerendered (`buildPreviewChildEnv`); none for any other child. */
export function previewChildPrerendered(env: NodeJS.ProcessEnv): Set<string> {
  const text = env[PREVIEW_PRERENDERED_ENV];
  if (previewChildMode(env) !== 'd3' || text === undefined) return new Set();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return new Set();
  }
  return new Set(Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []);
}

/**
 * The minimal child-process surface this module relies on. Letting
 * {@link _spawnPreviewBuildWith} accept any function that produces a process
 * with an `on('exit', ...)` listener keeps the test seam narrow — tests can
 * pass a tiny fake without reconstructing the full `ChildProcess` shape, and
 * the implementation stays decoupled from internals it doesn't use.
 */
export interface PreviewBuildChildProcess {
  on(event: 'exit', listener: (code: number | null) => void): unknown;
}

export type PreviewBuildSpawn = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; stdio: 'inherit' },
) => PreviewBuildChildProcess;

/**
 * Pure constructor for the child-process environment passed to the recursive
 * preview build. Extracted so tests can verify the contract (env flag +
 * parent-env inheritance) without spinning up a child process — and so the
 * real-process smoke test can call it the same way the integration does.
 *
 * Inherits the parent environment so PATH, credentials, and any host-specific
 * build vars (CF_PAGES_*, WORKERS_CI_*, GITHUB_*) reach the child, which reads
 * the branch and commit it serves from them.
 */
export function buildPreviewChildEnv(
  parentEnv: NodeJS.ProcessEnv,
  mode: 'd3',
  prerendered: readonly string[] = [],
): NodeJS.ProcessEnv {
  return {
    ...parentEnv,
    [PREVIEW_BUILD_ENV_FLAG]: '1',
    [PREVIEW_MODE_ENV]: mode,
    [PREVIEW_PRERENDERED_ENV]: JSON.stringify(prerendered),
  };
}

/**
 * Locate the `astro` CLI binary in the site's `node_modules/.bin/`. We
 * resolve relative to the current working directory (where `astro build` is
 * being invoked) rather than to this package's install location, because
 * `@conloca/cloud-astro` lists `astro` only as a peerDependency and would
 * therefore not have it in its own node_modules.
 *
 * Bare `bun x astro build` would be the obvious one-liner, but `bunx`/`bun x`
 * auto-fetch a package when it is missing, which a build must never do — so
 * resolve the installed binary and spawn it directly.
 */
export function resolveAstroBin(cwd: string = process.cwd()): string {
  const candidates = [
    join(cwd, 'node_modules', '.bin', 'astro'),
    join(cwd, '..', 'node_modules', '.bin', 'astro'),
    join(cwd, '..', '..', 'node_modules', '.bin', 'astro'),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `${PACKAGE_NAME}: cannot locate the astro binary. Looked in: ${candidates.join(', ')}. ` +
        'Is astro installed as a dependency?',
    );
  }
  return found;
}

/**
 * Spawns the recursive preview `astro build` from the primary build's
 * `astro:build:done` hook.
 *
 * The child process inherits the parent environment and additionally receives
 * {@link PREVIEW_BUILD_ENV_FLAG} set to `'1'`: the child's `astro:config:setup`
 * mounts the preview route on it, and its `astro:build:done` short-circuits
 * on it (recursion guard contract).
 *
 * If this function is itself called from within a recursive build (i.e. the
 * env flag is already set to `'1'`), it returns immediately without spawning,
 * which is the outermost layer of the recursion guard.
 *
 * On a non-zero child exit, behaviour depends on {@link PreviewBuildOptions.required}:
 *   - `true` (default) → rejects with an error naming the exit code.
 *   - `false` → resolves and logs a warning so onboarding setups can continue
 *     when the preview build is not yet wired correctly.
 */
export async function spawnPreviewBuild(
  opts: PreviewBuildOptions,
  mode: 'd3',
  prerendered: readonly string[] = [],
): Promise<void> {
  await _spawnPreviewBuildWith(spawn, opts, mode, prerendered);
}

/**
 * Internal seam that takes the spawn function as a parameter so tests can
 * substitute a fake. Public callers should use {@link spawnPreviewBuild}.
 *
 * Exported with a leading underscore to signal that this is an internal API
 * and not part of the package's public surface; it is not re-exported from
 * `src/index.ts` or `src/node.ts`.
 */
// oxlint-disable-next-line no-underscore-dangle -- the internal test seam.
export async function _spawnPreviewBuildWith(
  spawnFn: PreviewBuildSpawn,
  opts: PreviewBuildOptions,
  mode: 'd3',
  prerendered: readonly string[] = [],
): Promise<void> {
  // Recursion guard: bail out before doing any work if we're already inside
  // a recursive preview build. This matches the short-circuit in the
  // integration's `astro:build:done` hook.
  if (process.env[PREVIEW_BUILD_ENV_FLAG] === '1') {
    return;
  }

  const required = opts.required ?? true;

  const astroBin = resolveAstroBin();
  const child = spawnFn(astroBin, ['build'], {
    env: buildPreviewChildEnv(process.env, mode, prerendered),
    stdio: 'inherit',
  });

  await new Promise<void>((resolve, reject) => {
    child.on('exit', (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }
      const reason = code === null ? 'signal' : `exit ${code}`;
      if (required) {
        reject(new Error(`${PACKAGE_NAME}: preview build failed (${reason})`));
        return;
      }
      // Soft-fail path — opt-in via `previewBuild.required = false`. Use
      // console.warn rather than the Astro logger because the spawn helper is
      // pure: the integration's `astro:build:done` may evolve to pass a
      // logger down, but until it does, warn keeps the signal
      // visible without leaking a logger dependency into the spawn module.
      console.warn(`${PACKAGE_NAME}: preview build failed (${reason}); previewBuild.required=false, continuing`);
      resolve();
    });
  });
}
