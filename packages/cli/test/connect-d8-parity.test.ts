import { describe, expect, it } from 'bun:test';
// Test-only: the CLI never imports cloud-astro at run time, since it is an optional peer.
import { D8_TESTED_ADAPTERS, d8RateLimitLines } from '@conloca/cloud-astro/node';
import { previewDeployStep } from '../src/lib/connect/preview-deploy.js';
import { ADAPTER_VERSIONS } from '../src/lib/project-template.js';

const PREFIX = '/docs/_conloca/preview';
const linesFor = (adapter: '@astrojs/vercel' | '@astrojs/netlify') =>
  previewDeployStep({
    file: { kind: 'none' },
    setup: { kind: 'd8', prefix: PREFIX, adapter },
    routes: null,
    buildCommand: 'npm run build',
    exec: 'npx',
    previewUrl: false,
    negotiate404: false,
    cfPlan: undefined,
  }).lines ?? [];

describe('connect and doctor agree on d8', () => {
  it('installs the adapter releases doctor tests', () => {
    expect(ADAPTER_VERSIONS).toEqual(D8_TESTED_ADAPTERS);
  });

  it('prints the rate-limit lines doctor names', () => {
    expect(linesFor('@astrojs/vercel')).toEqual(d8RateLimitLines('@astrojs/vercel', PREFIX));
    expect(linesFor('@astrojs/netlify')).toEqual(expect.arrayContaining(d8RateLimitLines('@astrojs/netlify', PREFIX)));
  });
});
