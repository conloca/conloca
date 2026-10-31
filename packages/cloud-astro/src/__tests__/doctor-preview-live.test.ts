import { describe, expect, it } from 'bun:test';
import { runPreviewLiveChecks } from '../doctor/checks-preview-live.js';
import { scanAstroConfig } from '../doctor/config-scan.js';
import type { DoctorDeps } from '../doctor/types.js';

const P = '/proj';
const D4 = 'export default { integrations: [conlocaCloud({ previewBuild: { separate: true } })] };';
const D3 = 'export default { integrations: [conlocaCloud({ previewBuild: {} })] };';
const SITES = JSON.stringify({
  sites: {
    default: {
      locales: ['en'],
      defaultLocale: 'en',
      domains: { en: 'www.lumen-docs.test' },
      previewUrl: { en: 'https://p.lumen-docs.test' },
    },
  },
  globalLocales: ['en'],
});

async function run(config: string, answer: Response | null) {
  const fetched: string[] = [];
  const all = new Map([
    [`${P}/astro.config.mjs`, config],
    [`${P}/content/sites.json`, SITES],
  ]);
  const deps: DoctorDeps = {
    env: {},
    exists: (path) => all.has(path),
    readFile: (path) => {
      const text = all.get(path);
      if (text === undefined) throw new Error(`ENOENT ${path}`);
      return text;
    },
    git: () => undefined,
    fetch: async (input) => {
      fetched.push(input instanceof Request ? input.url : input.toString());
      return answer ?? new Response('not found', { status: 404 });
    },
  };
  const [outcome] = await runPreviewLiveChecks({
    context: { contractVersion: 1, projectDir: P, contentRoot: `${P}/content`, live: true },
    deps,
    scan: scanAstroConfig(P, deps),
    info: undefined,
  });
  return { outcome, fetched };
}

describe('CC24 — the separate preview deploy runs this release', () => {
  it('passes on a d4 deploy, and contacts nothing but the previewUrl', async () => {
    const { outcome, fetched } = await run(
      D4,
      Response.json({ builtWith: '@conloca/cloud-astro@1.0.0', preview: { mode: 'd4', protocol: 2 } }),
    );
    expect(outcome?.problems).toEqual([]);
    expect(fetched).toEqual(['https://p.lumen-docs.test/_conloca/editor/conloca.json']);
  });

  it('errors when the preview deploy answers no d4 conloca.json', async () => {
    const { outcome } = await run(D4, Response.json({ preview: { mode: 'd2', protocol: 2 } }));
    expect(outcome?.problems[0]?.message).toContain('does not serve as a separate preview deploy');
  });

  it('skips a site that previews next to itself, without a request', async () => {
    const { outcome, fetched } = await run(D3, null);
    expect(outcome?.skipped).toBe('no separate preview deploy (D4)');
    expect(fetched).toEqual([]);
  });

  it('keeps a slash after a base written without one', async () => {
    const based =
      "export default { base: '/docs', integrations: [conlocaCloud({ previewBuild: { separate: true } })] };";
    const { fetched } = await run(based, Response.json({ preview: { mode: 'd4', protocol: 2 } }));
    expect(fetched).toEqual(['https://p.lumen-docs.test/docs/_conloca/editor/conloca.json']);
  });
});
