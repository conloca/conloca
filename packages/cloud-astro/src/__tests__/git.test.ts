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
