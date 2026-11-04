import { describe, expect, test } from 'bun:test';
import { addAstroSiteStep } from '../src/lib/connect/astro-config.js';

const NO_SITE = `import vercel from '@astrojs/vercel';
import { defineConfig } from 'astro/config';

export default defineConfig({
  adapter: vercel(),
});
`;
const SITES = `${JSON.stringify({ sites: { default: { locales: ['en'], defaultLocale: 'en', domains: { en: 'www.example.com' } } } })}\n`;
const NO_DOMAIN = `${JSON.stringify({ sites: { default: { locales: ['en'], defaultLocale: 'en' } } })}\n`;
const input = { path: 'astro.config.mjs', text: NO_SITE, sitesText: SITES, adapter: '@astrojs/vercel' } as const;

describe('addAstroSiteStep', () => {
  test('proposes site from the sites.json domain, asking first', () => {
    const result = addAstroSiteStep(input);
    expect(result.state).toBe('differs');
    expect(result.edits).toEqual([]);
    expect(result.lines).toEqual(["site: 'https://www.example.com',"]);
    expect(result.message).toContain('(302)');
    expect(result.question).toBe(
      'Set site to https://www.example.com in astro.config? It changes canonical, sitemap, RSS and Open Graph URLs on your live pages.',
    );
    const [edit] = result.replacement ?? [];
    expect(edit?.before).toBe(NO_SITE);
    expect(edit?.after).toBe(NO_SITE.replace('  adapter', "  site: 'https://www.example.com',\n  adapter"));
  });

  test('--site-url wins over sites.json, on Netlify too', () => {
    const result = addAstroSiteStep({ ...input, adapter: '@astrojs/netlify', siteUrl: 'https://a.example.org' });
    expect(result.lines).toEqual(["site: 'https://a.example.org',"]);
  });

  test('an http or path --site-url is needs-you; a URL with a path proposes its origin', () => {
    for (const siteUrl of ['http://a.example.org', 'a.example.org/x']) {
      const result = addAstroSiteStep({ ...input, siteUrl });
      expect(result.state).toBe('needs-you');
      expect(result.message).toBe(`Astro's site must be an https URL, got ${siteUrl}`);
    }
    expect(addAstroSiteStep({ ...input, siteUrl: "https://a.example.org/x'y" }).lines).toEqual([
      "site: 'https://a.example.org',",
    ]);
  });

  test('no domain anywhere is needs-you with the line', () => {
    const result = addAstroSiteStep({ ...input, sitesText: NO_DOMAIN });
    expect(result.state).toBe('needs-you');
    expect(result.message).toContain("site: '<your production URL>'");
    expect(result.lines).toEqual(["site: '<your production URL>',"]);
    expect(result.replacement).toBeUndefined();
  });

  test('a site already set is done; a computed one is skipped', () => {
    const set = NO_SITE.replace('  adapter', "  site: 'https://x.example',\n  adapter");
    expect(addAstroSiteStep({ ...input, text: set }).state).toBe('done');
    const computed = NO_SITE.replace('  adapter', '  site: process.env.SITE,\n  adapter');
    expect(addAstroSiteStep({ ...input, text: computed }).state).toBe('skipped');
  });

  test('node and cloudflare adapters get no proposal', () => {
    expect(addAstroSiteStep({ ...input, adapter: '@astrojs/node' }).state).toBe('skipped');
    expect(addAstroSiteStep({ ...input, adapter: '@astrojs/cloudflare' }).state).toBe('skipped');
  });
});
