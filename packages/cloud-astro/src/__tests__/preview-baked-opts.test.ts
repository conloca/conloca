import { describe, expect, it } from 'bun:test';
import { resolveFromBaked } from '../preview/_resolve-opts.js';

// ---------------------------------------------------------------------------
// The deployer should not have to set ANY runtime env var. Everything the
// preview middleware needs is known while the preview build runs: the
// endpoint and the audience (integration options) and the repository, site
// and branch the build serves. Baking them removes the env-var setup step.
// The repository, site and branch are what a pass must match, so only the
// build may name them.
// ---------------------------------------------------------------------------

const complete = {
  saasEndpoint: 'https://api.test',
  saasIssuer: 'https://iss.test',
  saasAudience: 'acme/site',
  repo: 'acme/site',
  siteId: 'website',
  branch: 'main',
  base: '/',
};

describe('resolveFromBaked', () => {
  it('uses the values baked in at build time when they are complete', () => {
    expect(resolveFromBaked(complete, () => undefined)).toEqual({
      saasEndpoint: 'https://api.test',
      saasIssuer: 'https://iss.test',
      saasAudience: 'acme/site',
      repo: 'acme/site',
      siteId: 'website',
      branch: 'main',
      base: '/',
    });
  });

  it('lets a runtime env var override a baked value', () => {
    // Escape hatch: one build artifact promoted across environments should be
    // repointable without a rebuild.
    const opts = resolveFromBaked(complete, (name) =>
      name === 'CONLOCA_SAAS_ENDPOINT' ? 'https://staging.test' : undefined,
    );
    expect(opts.saasEndpoint).toBe('https://staging.test');
    expect(opts.branch).toBe('main');
  });

  it('falls back to the environment for anything not baked', () => {
    const opts = resolveFromBaked({ ...complete, saasIssuer: undefined }, (n) =>
      n === 'CONLOCA_SAAS_ISSUER' ? 'https://iss.test' : undefined,
    );
    expect(opts.saasIssuer).toBe('https://iss.test');
  });

  it('carries the baked build commit, and omits it for an artifact baked without one', () => {
    expect(resolveFromBaked({ ...complete, buildCommit: 'c'.repeat(40) }, () => undefined).buildCommit).toBe(
      'c'.repeat(40),
    );
    expect('buildCommit' in resolveFromBaked(complete, () => undefined)).toBe(false);
  });

  it('names the missing value when neither baked nor in the environment', () => {
    expect(() => resolveFromBaked({ ...complete, saasAudience: undefined }, () => undefined)).toThrow(
      /CONLOCA_SAAS_AUDIENCE/,
    );
  });

  it('throws naming the branch when the build baked none', () => {
    expect(() => resolveFromBaked({ ...complete, branch: undefined }, () => undefined)).toThrow(
      'missing the baked branch',
    );
  });

  it('takes repo, site and branch only from the build, never the environment', () => {
    expect(resolveFromBaked(complete, () => 'from-env')).toMatchObject({
      repo: 'acme/site',
      siteId: 'website',
      branch: 'main',
    });
  });

  it('defaults base to /', () => {
    expect(resolveFromBaked({ ...complete, base: undefined }, () => undefined).base).toBe('/');
  });
});
