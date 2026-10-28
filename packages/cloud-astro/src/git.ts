import { execFileSync } from 'node:child_process';
import { detectRepositoryUri, type RepositoryEnvironment } from './repository.js';

/**
 * Runs `git <args>` and returns trimmed stdout, or undefined when git is
 * unavailable or the directory is not a checkout (e.g. tarball-based CI).
 * `cwd` names the checkout to ask; without it git resolves against the
 * process's own directory, which is the build's project but NOT the doctor's.
 */
export function gitOutput(args: string[], cwd?: string): string | undefined {
  try {
    const output = execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], cwd }).trim();
    return output === '' ? undefined : output;
  } catch {
    return undefined;
  }
}

/**
 * The resolved pair. An empty `CF_PAGES_COMMIT_SHA` is passed through
 * unchanged (`CF_PAGES_COMMIT_SHA=''` yields `gitSha: ''`; the other hosts'
 * empty commit variables count as unset); callers treat a falsy value
 * as unresolved, exactly as the build hook's guard does. An empty BRANCH
 * variable counts as unset instead: GitHub Actions exports GITHUB_HEAD_REF=''
 * on every push build, which would otherwise hide GITHUB_REF_NAME.
 */
interface BuildRef {
  gitSha?: string;
  branch?: string;
}

/**
 * The commit and branch this checkout stands on — the pair conloca.json
 * names, and the branch a preview build serves. CI metadata first,
 * most-specific source per provider: Cloudflare Pages, Cloudflare Workers
 * Builds, Netlify (whose `HEAD` and `COMMIT_REF` count only when `NETLIFY` is
 * set, since other shells may export a `HEAD`), Vercel, Render, Amplify, then GitHub Actions. GitHub
 * Actions checkouts are DETACHED, so the git fallback returns the literal
 * 'HEAD' there — GITHUB_HEAD_REF (PR builds) / GITHUB_REF_NAME cover that
 * case, and a surviving literal 'HEAD' is treated as unresolvable: branch
 * 'HEAD' would never match the editor's branch-keyed lookup.
 */
export function resolveBuildRef(
  env: RepositoryEnvironment = process.env,
  git: (args: string[]) => string | undefined = gitOutput,
): BuildRef {
  const netlify = env.NETLIFY === 'true';
  const gitSha =
    env.CF_PAGES_COMMIT_SHA ??
    (env.WORKERS_CI_COMMIT_SHA || undefined) ??
    (netlify ? env.COMMIT_REF || undefined : undefined) ??
    (env.VERCEL_GIT_COMMIT_SHA || undefined) ??
    (env.RENDER_GIT_COMMIT || undefined) ??
    (env.AWS_COMMIT_ID || undefined) ??
    git(['rev-parse', 'HEAD']);
  const rawBranch =
    env.CF_PAGES_BRANCH ||
    env.WORKERS_CI_BRANCH ||
    (netlify ? env.HEAD : undefined) ||
    env.VERCEL_GIT_COMMIT_REF ||
    env.RENDER_GIT_BRANCH ||
    env.AWS_BRANCH ||
    env.GITHUB_HEAD_REF ||
    env.GITHUB_REF_NAME ||
    git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = rawBranch === 'HEAD' ? undefined : rawBranch;
  return { ...(gitSha === undefined ? {} : { gitSha }), ...(branch === undefined ? {} : { branch }) };
}

/**
 * The repository the editor page names: the explicit option and CI
 * metadata are free to read; git is spawned ONLY when neither resolved it.
 * Config loading is a hot path in Astro and must not start a subprocess on
 * every integration instance.
 */
export function resolveRepositoryUri(
  explicit: string | undefined,
  env: RepositoryEnvironment,
  git: (args: string[]) => string | undefined = gitOutput,
): string | undefined {
  return (
    detectRepositoryUri({ explicit, env }) ??
    detectRepositoryUri({ env: {}, remote: git(['config', '--get', 'remote.origin.url']) })
  );
}
