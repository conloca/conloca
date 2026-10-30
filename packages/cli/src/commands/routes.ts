import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readSitesConfig } from '@conloca/content-api/node';
import { fail, withStdoutRedirected } from '../lib/cli-output.js';
import { stripComments } from '../lib/config-text.js';
import { contentRootOf } from '../lib/content-root.js';
import { readConlocaPages, readFileRoutes, siteRoutes } from '../lib/site-routes.js';
import { astroI18nOf, astroOutputOf, findAstroConfig } from './doctor-astro.js';

/** Lists a site's static src/pages routes and its Conloca pages, marking each page a file hides. Read-only. */
export async function routes(directory: string, options: { site?: string; json: boolean }): Promise<void> {
  const { json } = options;
  const projectDir = resolve(directory);
  const configPath = findAstroConfig(projectDir);
  if (configPath === undefined) fail(json, `no astro.config found in ${projectDir} — run it in the Astro project`);
  const source = await readFile(configPath, 'utf-8').catch(() => null);
  if (source === null) fail(json, `could not read ${configPath} — check its file permissions`);
  const configText = stripComments(source);

  const contentRoot = contentRootOf(directory);
  const sites = await withStdoutRedirected(json, () => readSitesConfig(contentRoot));
  const existing = Object.keys(sites.sites);
  const site = options.site ?? existing[0];
  if (site === undefined) fail(json, 'no sites are configured in sites.json', 'site');
  if (!Object.hasOwn(sites.sites, site)) {
    fail(json, `Site '${site}' is not in sites.json. Existing sites: ${existing.join(', ')}`, 'site');
  }
  const pages = await withStdoutRedirected(json, () => readConlocaPages(contentRoot, sites));

  // An unreadable output counts as not server: every file without `prerender = false` is listed prerendered.
  const config = { serverOutput: astroOutputOf(configText) === 'server', i18n: astroI18nOf(configText) };
  const list = siteRoutes(await readFileRoutes(projectDir, config, sites, site), pages, site);

  if (json) {
    console.log(JSON.stringify({ ok: true, site, routes: list }));
    return;
  }
  for (const route of list) {
    console.log(`${route.route}  ${route.file ?? `Conloca page ${route.pageId}`}`);
    if (route.hidden) console.log(`  ${route.file} hides Conloca page ${route.pageId}`);
  }
}
