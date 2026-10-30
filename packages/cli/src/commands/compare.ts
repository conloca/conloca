import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';
import { type JsonValue, readSitesConfig } from '@conloca/content-api/node';
import { fail, withStdoutRedirected } from '../lib/cli-output.js';
import { stripComments } from '../lib/config-text.js';
import { contentRootOf } from '../lib/content-root.js';
import { lockfileInstall, packageManagerCommands } from '../lib/package-manager.js';
import { compareOutputs, isComparedOutputFile, routeOfOutputFile } from '../lib/page-compare.js';
import { readConlocaPages, readFileRoutes, siteRoutes } from '../lib/site-routes.js';
import { terminalIo } from './connect.js';
import { astroI18nOf, astroOutputOf, findAstroConfig } from './doctor-astro.js';

type Baseline = {
  chosenRoutes: string[];
  /** Conloca routes the site showed at baseline time. */
  conlocaRoutes: string[];
  /** Conloca routes a src/pages file already hid at baseline time. */
  hiddenRoutes: string[];
};

const isStringArray = (value: JsonValue | undefined): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

function isBaseline(value: JsonValue): value is Baseline {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    isStringArray(value.chosenRoutes) &&
    isStringArray(value.conlocaRoutes) &&
    isStringArray(value.hiddenRoutes)
  );
}

/** Every file under `dir`, relative with `/`; none when `dir` does not exist. */
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'));
}

/**
 * Builds the project and compares the output with a baseline saved by the first run: untouched routes must be
 * identical, chosen routes that became Conloca pages keep their facts. Never commits, pushes or deploys.
 */
export async function compare(
  directory: string,
  options: { reset: boolean; routes?: string; json: boolean },
): Promise<never> {
  const { json } = options;
  const projectDir = resolve(directory);
  const configPath = findAstroConfig(projectDir);
  if (configPath === undefined) fail(json, `no astro.config found in ${projectDir} — run it in the Astro project`);
  const source = await readFile(configPath, 'utf-8').catch(() => null);
  if (source === null) fail(json, `could not read ${configPath} — check its file permissions`);
  const configText = stripComments(source);

  const chosen = options.routes
    ?.split(',')
    .map((route) => route.trim())
    .filter((route) => route !== '');
  const notRoute = chosen?.find((route) => !route.startsWith('/'));
  if (notRoute !== undefined) fail(json, `--routes takes routes starting with /, separated by commas; got ${notRoute}`);

  const baselineRoot = join(projectDir, 'node_modules', '.cache', 'conloca-compare');
  const baselinePath = join(baselineRoot, 'baseline.json');
  const outputRoot = join(baselineRoot, 'output');
  if (options.reset) await rm(baselineRoot, { recursive: true, force: true });
  const baselineText = await readFile(baselinePath, 'utf-8').catch(() => null);
  let baseline: Baseline | null = null;
  if (baselineText !== null) {
    let parsed: JsonValue = null;
    try {
      parsed = JSON.parse(baselineText);
    } catch {
      // An unparseable file fails the check below like a malformed one.
    }
    if (!isBaseline(parsed))
      fail(json, `${baselinePath} is unreadable; run conloca compare --reset to save a new baseline`);
    baseline = parsed;
  }
  if (baseline !== null && options.routes !== undefined) {
    fail(json, `a baseline exists; run conloca compare --reset --routes ${options.routes} to choose again`);
  }

  const contentRoot = contentRootOf(directory);
  const sites = await withStdoutRedirected(json, () => readSitesConfig(contentRoot));
  const site = Object.keys(sites.sites)[0];
  if (site === undefined) fail(json, 'no sites are configured in sites.json', 'site');

  const startedAt = Date.now();
  const packageManager = lockfileInstall(projectDir, parse(projectDir).root)?.packageManager ?? 'npm';
  const buildCommand = `${packageManagerCommands(packageManager).run} build`;
  if (!(await terminalIo(json).run(buildCommand, projectDir))) {
    fail(json, `${buildCommand} failed; fix the build, then run conloca compare again`);
  }

  // A server adapter writes dist/client beside dist/server; a static site's dist/client is just its /client route.
  const serverLayout = existsSync(join(projectDir, 'dist', 'server')) && existsSync(join(projectDir, 'dist', 'client'));
  const outName = serverLayout ? 'dist/client' : 'dist';
  const outDir = join(projectDir, outName);
  const outFiles = await filesUnder(outDir);
  const htmlTimes = await Promise.all(
    outFiles.filter((file) => file.endsWith('.html')).map(async (file) => (await stat(join(outDir, file))).mtimeMs),
  );
  if (!htmlTimes.some((time) => time >= startedAt)) {
    fail(json, 'the build wrote no fresh HTML to dist or dist/client; conloca compare reads only those folders');
  }

  const pages = await withStdoutRedirected(json, () => readConlocaPages(contentRoot, sites));
  const config = { serverOutput: astroOutputOf(configText) === 'server', i18n: astroI18nOf(configText) };
  const routesNow = siteRoutes(await readFileRoutes(projectDir, config, sites, site), pages, site);
  const conlocaRoutes = routesNow
    .filter((route) => route.pageId !== undefined && route.hidden !== true)
    .map((route) => route.route);
  const hiddenNow = routesNow.filter((route) => route.hidden);

  if (baseline === null) {
    const saved = outFiles.filter(
      (file) => isComparedOutputFile(file) || (file.startsWith('_astro/') && file.endsWith('.css')),
    );
    await rm(baselineRoot, { recursive: true, force: true });
    await Promise.all(
      saved.map(async (file) => {
        await mkdir(dirname(join(outputRoot, file)), { recursive: true });
        await copyFile(join(outDir, file), join(outputRoot, file));
      }),
    );
    const chosenRoutes = chosen ?? [];
    const hiddenRoutes = hiddenNow.map((route) => route.route);
    // Written last: a baseline.json only exists next to a complete output/.
    await writeFile(baselinePath, JSON.stringify({ chosenRoutes, conlocaRoutes, hiddenRoutes } satisfies Baseline));
    const routeCount = new Set(saved.filter(isComparedOutputFile).map(routeOfOutputFile)).size;
    if (json) {
      console.log(
        JSON.stringify({
          ok: true,
          baseline: 'saved',
          chosenRoutes,
          routes: [],
          missing: [],
          added: [],
          unchosen: [],
          hidden: [],
        }),
      );
    } else {
      console.log(
        `Saved the baseline (${routeCount} routes from ${outName}; chosen: ${chosenRoutes.join(', ') || 'none'}). Convert the pages, then run conloca compare again.`,
      );
    }
    process.exit(0);
  }

  const chosenRoutes = new Set(baseline.chosenRoutes);
  const before = new Set(baseline.conlocaRoutes);
  // A page hidden at baseline that is shown now counts as new: converted when chosen, an unchosen failure otherwise.
  const newPages = conlocaRoutes.filter((route) => !before.has(route));
  const convertedRoutes = new Set(newPages.filter((route) => chosenRoutes.has(route)));
  const unchosen = newPages
    .filter((route) => !chosenRoutes.has(route))
    .map((route) => `${route} became a Conloca page but was not chosen`);
  const comparison = await compareOutputs({ baselineDir: outputRoot, currentDir: outDir, convertedRoutes });
  // Pages hidden already at baseline belong to routes the agent must not touch, unless the user chose them.
  const hiddenBefore = new Set(baseline.hiddenRoutes);
  const hidden = hiddenNow
    .filter((route) => chosenRoutes.has(route.route) || !hiddenBefore.has(route.route))
    .map((route) => `${route.route} is a Conloca page hidden behind ${route.file} — delete the file`);
  const ok =
    comparison.routes.every((route) => route.differences.length === 0) &&
    comparison.missing.length === 0 &&
    unchosen.length === 0 &&
    hidden.length === 0;

  if (json) {
    console.log(
      JSON.stringify({
        ok,
        baseline: 'compared',
        chosenRoutes: baseline.chosenRoutes,
        ...comparison,
        unchosen,
        hidden,
      }),
    );
  } else {
    for (const route of comparison.routes) {
      if (route.differences.length === 0 && route.allowed.length === 0) continue;
      console.log(`${route.route} (${route.kind})`);
      for (const difference of route.differences) console.log(`  differs: ${difference}`);
      for (const allowed of route.allowed) console.log(`  allowed: ${allowed}`);
    }
    for (const route of comparison.missing) console.log(`${route} is missing from the build`);
    for (const route of comparison.added) console.log(`${route} is new in the build`);
    for (const line of [...unchosen, ...hidden]) console.log(line);
    console.log(
      ok
        ? `All ${comparison.routes.length} routes match the baseline.`
        : 'The build differs from the baseline; fix it, then run conloca compare again.',
    );
  }
  process.exit(ok ? 0 : 1);
}
