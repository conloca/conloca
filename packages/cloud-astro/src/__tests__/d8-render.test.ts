import { expect, it, mock } from 'bun:test';

// A bake with no mode, which on its own would resolve to the D2 rules.
mock.module('virtual:conloca-preview-opts', () => ({
  default: { saasEndpoint: 'https://endpoint.test', saasAudience: 'aud', repo: 'o/r', siteId: 's', branch: 'main' },
}));
mock.module('../preview-render-seams.js', () => ({ previewRenderSeams: async () => ({}) }));

it('resolves the d8 rules even when the bake names no mode', async () => {
  // Imported after the mocks above so it binds to them.
  const { d8Opts } = await import('../d8-render.js');
  expect(d8Opts().mode).toBe('d8');
});
