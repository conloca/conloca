import { describe, expect, it } from 'bun:test';
import { resolveBuildRef, resolveRepositoryUri } from '../git.js';

const gitAnswering = (answers: Record<string, string | undefined>) => (args: string[]) => answers[args.join(' ')];

describe('resolveBuildRef', () => {
  it('prefers CI metadata over git', () => {
    const git = gitAnswering({ 'rev-parse HEAD': 'git-sha', 'rev-parse --abbrev-ref HEAD': 'git-branch' });
    expect(
      resolveBuildRef({ CF_PAGES_COMMIT_SHA: 'ci-sha', CF_PAGES_BRANCH: 'ci-branch', GITHUB_HEAD_REF: 'x' }, git),
    ).toStrictEqual({ gitSha: 'ci-sha', branch: 'ci-branch' });
  });

  it('takes GitHub Actions branch metadata, PR head ref first', () => {
    const git = gitAnswering({ 'rev-parse HEAD': 'sha', 'rev-parse --abbrev-ref HEAD': 'HEAD' });
    expect(resolveBuildRef({ GITHUB_HEAD_REF: 'feat/x', GITHUB_REF_NAME: '42/merge' }, git).branch).toBe('feat/x');
    expect(resolveBuildRef({ GITHUB_REF_NAME: 'main' }, git).branch).toBe('main');
  });

  /**
   * On a push build GitHub Actions exports GITHUB_HEAD_REF as an EMPTY string,
   * not unset: the runner turns every string in the `github` context into an
   * environment variable, and a push event's context carries `"head_ref": ""`.
   * A default-branch build must register under GITHUB_REF_NAME there.
   */
  it('skips an empty branch variable, as GitHub Actions sets GITHUB_HEAD_REF on a push build', () => {
    const git = gitAnswering({ 'rev-parse HEAD': 'sha', 'rev-parse --abbrev-ref HEAD': 'HEAD' });
    expect(resolveBuildRef({ GITHUB_HEAD_REF: '', GITHUB_REF_NAME: 'main' }, git).branch).toBe('main');
    expect(resolveBuildRef({ CF_PAGES_BRANCH: '', GITHUB_HEAD_REF: '', GITHUB_REF_NAME: 'main' }, git).branch).toBe(
      'main',
    );
    const checkout = gitAnswering({ 'rev-parse HEAD': 'sha', 'rev-parse --abbrev-ref HEAD': 'main' });
    expect(resolveBuildRef({ GITHUB_HEAD_REF: '', GITHUB_REF_NAME: '' }, checkout).branch).toBe('main');
  });

  it('falls back to git and treats a detached HEAD as no branch', () => {
    expect(
      resolveBuildRef({}, gitAnswering({ 'rev-parse HEAD': 'sha', 'rev-parse --abbrev-ref HEAD': 'main' })),
    ).toStrictEqual({ gitSha: 'sha', branch: 'main' });
    expect(
      resolveBuildRef({}, gitAnswering({ 'rev-parse HEAD': 'sha', 'rev-parse --abbrev-ref HEAD': 'HEAD' })),
    ).toStrictEqual({ gitSha: 'sha' });
    expect(resolveBuildRef({}, gitAnswering({}))).toStrictEqual({});
  });

  it('reads Cloudflare Workers Builds, Netlify and Vercel branch and commit variables', () => {
    const git = gitAnswering({ 'rev-parse HEAD': 'git-sha', 'rev-parse --abbrev-ref HEAD': 'git-branch' });
    expect(resolveBuildRef({ WORKERS_CI_BRANCH: 'wb', WORKERS_CI_COMMIT_SHA: 'wb-sha' }, git)).toStrictEqual({
      gitSha: 'wb-sha',
      branch: 'wb',
    });
    expect(resolveBuildRef({ NETLIFY: 'true', HEAD: 'nf', COMMIT_REF: 'nf-sha' }, git)).toStrictEqual({
      gitSha: 'nf-sha',
      branch: 'nf',
    });
    expect(resolveBuildRef({ VERCEL_GIT_COMMIT_REF: 'vc', VERCEL_GIT_COMMIT_SHA: 'vc-sha' }, git)).toStrictEqual({
      gitSha: 'vc-sha',
      branch: 'vc',
    });
  });

  it('takes the Render and Amplify commit and branch', () => {
    const git = gitAnswering({ 'rev-parse HEAD': 'git-sha', 'rev-parse --abbrev-ref HEAD': 'git-branch' });
    expect(resolveBuildRef({ RENDER_GIT_COMMIT: 'rd-sha', RENDER_GIT_BRANCH: 'rd' }, git)).toStrictEqual({
      gitSha: 'rd-sha',
      branch: 'rd',
    });
    expect(resolveBuildRef({ AWS_COMMIT_ID: 'aws-sha', AWS_BRANCH: 'aws' }, git)).toStrictEqual({
      gitSha: 'aws-sha',
      branch: 'aws',
    });
    // Empty counts as unset, and GitHub's branch name comes after them.
    expect(
      resolveBuildRef({ RENDER_GIT_COMMIT: '', RENDER_GIT_BRANCH: '', AWS_BRANCH: 'aws', GITHUB_REF_NAME: 'gh' }, git),
    ).toStrictEqual({ gitSha: 'git-sha', branch: 'aws' });
  });

  it('ignores HEAD and COMMIT_REF outside Netlify', () => {
    const git = gitAnswering({ 'rev-parse HEAD': 'git-sha', 'rev-parse --abbrev-ref HEAD': 'git-branch' });
    expect(resolveBuildRef({ HEAD: 'nf', COMMIT_REF: 'nf-sha' }, git)).toStrictEqual({
      gitSha: 'git-sha',
      branch: 'git-branch',
    });
  });
});

describe('resolveRepositoryUri', () => {
  const gitMustNotRun = () => {
    throw new Error('git must not run when the environment resolves the repository');
  };

  it('takes the explicit option, then CI metadata, without spawning git', () => {
    expect(resolveRepositoryUri('acme/explicit', { GITHUB_REPOSITORY: 'acme/env' }, gitMustNotRun)).toBe(
      'acme/explicit',
    );
    expect(resolveRepositoryUri(undefined, { GITHUB_REPOSITORY: 'acme/env' }, gitMustNotRun)).toBe('acme/env');
  });

  it('falls back to the git remote only when nothing else resolves', () => {
    const remote = gitAnswering({ 'config --get remote.origin.url': 'git@github.com:acme/remote.git' });
    expect(resolveRepositoryUri(undefined, {}, remote)).toBe('acme/remote');
    expect(resolveRepositoryUri(undefined, {}, gitAnswering({}))).toBeUndefined();
  });
});
