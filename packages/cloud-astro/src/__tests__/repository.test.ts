import { describe, expect, it } from 'bun:test';

import { detectRepositoryUri, normalizeRepositoryUri } from '../repository.js';

describe('normalizeRepositoryUri', () => {
  it.each([
    ['acme/site', 'acme/site'],
    ['https://github.com/acme/site.git', 'acme/site'],
    ['git@github.com:acme/site.git', 'acme/site'],
    ['ssh://git@github.com/acme/site.git', 'acme/site'],
    ['github.com/acme/site', 'acme/site'],
  ])('normalizes %s to the provider full_name', (input, expected) => {
    expect(normalizeRepositoryUri(input)).toBe(expected);
  });

  it.each(['', 'site-only', 'https://github.com/acme', '/tmp/local/repo'])('rejects ambiguous source %p', (input) => {
    expect(normalizeRepositoryUri(input)).toBeUndefined();
  });
});

describe('detectRepositoryUri', () => {
  it('prefers an explicit advanced override', () => {
    expect(
      detectRepositoryUri({
        explicit: 'override/site',
        env: { GITHUB_REPOSITORY: 'actions/site' },
        remote: 'git@github.com:remote/site.git',
      }),
    ).toBe('override/site');
  });

  it('uses standard GitHub Actions metadata without user configuration', () => {
    expect(detectRepositoryUri({ env: { GITHUB_REPOSITORY: 'acme/site' } })).toBe('acme/site');
  });

  it('uses Vercel or GitLab metadata before falling back to the Git remote', () => {
    expect(detectRepositoryUri({ env: { VERCEL_GIT_REPO_OWNER: 'acme', VERCEL_GIT_REPO_SLUG: 'site' } })).toBe(
      'acme/site',
    );
    expect(detectRepositoryUri({ env: { CI_PROJECT_PATH: 'acme/site' } })).toBe('acme/site');
    expect(detectRepositoryUri({ env: {}, remote: 'git@github.com:remote/site.git' })).toBe('remote/site');
  });
});
