import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGE_NAME, PREVIEW_BUILD_ENV_FLAG, PREVIEW_SECRET_ENV_FLAG } from './constants.js';
import type { PreviewBuildOptions } from './types.js';

export { PREVIEW_SECRET_ENV_FLAG };

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
 * preview build. Extracted so tests can verify the contract (env flag + secret
 * + parent-env inheritance) without spinning up a child process — and so the
 * real-process smoke test can call it the same way the integration does.
 *
 * Inherits the parent environment so PATH, credentials, and any host-specific
 * build vars (CF_PAGES_*, GITHUB_*) reach the child.
 */
export function buildPreviewChildEnv(parentEnv: NodeJS.ProcessEnv, previewSecret: string): NodeJS.ProcessEnv {
  return {
    ...parentEnv,
    [PREVIEW_BUILD_ENV_FLAG]: '1',
    [PREVIEW_SECRET_ENV_FLAG]: previewSecret,
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
 * The child process inherits the parent environment and additionally receives:
 *   - {@link PREVIEW_BUILD_ENV_FLAG} set to `'1'` so the integration's own
 *     `astro:build:done` short-circuits inside the child (recursion guard
 *     contract).
 *   - {@link PREVIEW_SECRET_ENV_FLAG} set to the per-branch secret so the
 *     child's `astro:config:setup` can inject the literal secret-scoped
 *     preview route (`/conloca_preview_${SECRET}/[...path]`).
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
export async function spawnPreviewBuild(previewSecret: string, opts: PreviewBuildOptions): Promise<void> {
  await _spawnPreviewBuildWith(spawn, previewSecret, opts);
}

/**
 * Internal seam that takes the spawn function as a parameter so tests can
 * substitute a fake. Public callers should use {@link spawnPreviewBuild}.
 *
 * Exported with a leading underscore to signal that this is an internal API
 * and not part of the package's public surface; it is not re-exported from
 * `src/index.ts` or `src/node.ts`.
 */
export async function _spawnPreviewBuildWith(
  spawnFn: PreviewBuildSpawn,
  previewSecret: string,
  opts: PreviewBuildOptions,
): Promise<void> {
  // Recursion guard: bail out before doing any work if we're already inside
  // a recursive preview build. This matches the short-circuit in the
  // integration's `astro:build:done` hook.
  if (process.env[PREVIEW_BUILD_ENV_FLAG] === '1') {
    return;
  }

  if (!previewSecret) {
    throw new Error(`${PACKAGE_NAME}: preview secret is required to spawn the preview build`);
  }

  const required = opts.required ?? true;

  const astroBin = resolveAstroBin();
  const child = spawnFn(astroBin, ['build'], {
    env: buildPreviewChildEnv(process.env, previewSecret),
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
