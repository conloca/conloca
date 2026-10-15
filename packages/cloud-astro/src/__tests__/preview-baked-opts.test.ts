import { describe, expect, it } from 'bun:test';
import { resolveFromBaked } from '../preview/_resolve-opts.js';

// ---------------------------------------------------------------------------
// The deployer should not have to set ANY runtime env var. Everything the
// preview middleware needs is known while the preview build runs: the secret
// (the parent build received it from registration), the endpoint and the
// audience (both integration options). Baking them removes the four-env-var
// setup step AND the chicken-and-egg loop where the secret is generated during
// a build but must be set on a deployment that happens afterwards.
// ---------------------------------------------------------------------------

describe('resolveFromBaked', () => {
  it('uses the values baked in at build time when they are complete', () => {
    const opts = resolveFromBaked(
      { secret: 'sek', saasEndpoint: 'https://api.test', saasIssuer: 'https://iss.test', saasAudience: 'acme/site' },
      () => undefined,
    );
    expect(opts).toEqual({
      secret: 'sek',
      saasEndpoint: 'https://api.test',
      saasIssuer: 'https://iss.test',
      saasAudience: 'acme/site',
    });
  });

  it('lets a runtime env var override a baked value', () => {
    // Escape hatch: one build artifact promoted across environments should be
    // repointable without a rebuild.
    const opts = resolveFromBaked(
      { secret: 'sek', saasEndpoint: 'https://api.test', saasIssuer: 'https://iss.test', saasAudience: 'acme/site' },
      (name) => (name === 'CONLOCA_SAAS_ENDPOINT' ? 'https://staging.test' : undefined),
    );
    expect(opts.saasEndpoint).toBe('https://staging.test');
    expect(opts.secret).toBe('sek');
  });

  it('falls back to the environment for anything not baked', () => {
    const opts = resolveFromBaked(
      { secret: 'sek', saasEndpoint: 'https://api.test', saasAudience: 'acme/site' },
      (n) => (n === 'CONLOCA_SAAS_ISSUER' ? 'https://iss.test' : undefined),
    );
    expect(opts.saasIssuer).toBe('https://iss.test');
  });

  it('carries the baked build commit, and omits it for an artifact baked without one', () => {
    const base = {
      secret: 'sek',
      saasEndpoint: 'https://api.test',
      saasIssuer: 'https://iss.test',
      saasAudience: 'a/b',
    };
    expect(resolveFromBaked({ ...base, buildCommit: 'c'.repeat(40) }, () => undefined).buildCommit).toBe(
      'c'.repeat(40),
    );
    expect('buildCommit' in resolveFromBaked(base, () => undefined)).toBe(false);
  });

  it('names the missing value when neither baked nor in the environment', () => {
    expect(() =>
      resolveFromBaked(
        { secret: 'sek', saasEndpoint: 'https://api.test', saasIssuer: 'https://iss.test' },
        () => undefined,
      ),
    ).toThrow(/CONLOCA_SAAS_AUDIENCE/);
  });
});
