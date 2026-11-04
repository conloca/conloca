import { join } from 'node:path';
import { isRecord } from '@conloca/content-api/component-vocabulary';
import { type EditorPageInfo, hostOf } from '@conloca/content-api/editor-host';
import { PREVIEW_LABEL_HEADER, PREVIEW_MODE_HEADER, previewRoutePrefix } from '../preview/preview-path.js';
import { type ConfigScan, previewServeSetting, siteAdapter } from './config-scan.js';
import {
  type CheckOutcome,
  type CloudDoctorContext,
  type DoctorDeps,
  outcomeOf,
  REQUEST_TIMEOUT_MS,
  skipped,
} from './types.js';

interface Input {
  context: CloudDoctorContext;
  deps: DoctorDeps;
  scan: ConfigScan;
  /** The deployed site's conloca.json, when CC11 read it. */
  info: EditorPageInfo | undefined;
  /** The production address with its base, ending in `/` (CC9). */
  address: string;
}

/** Where each host shows the logs of the code that serves the preview route. */
const LOGS = {
  vercel: 'Project → Logs',
  netlify: 'Logs → Functions',
  cloudflare: 'the Cloudflare dashboard → your site → Observability → Logs',
  node: "your server's own log output",
} as const;

/** The host whose logs to name: the one the production build recorded, else the adapter's, else D3's Cloudflare. */
function logsOf(input: Input, mode: 'd3' | 'd8'): string {
  const recorded = input.info === undefined ? undefined : hostOf(input.info);
  if (recorded === 'vercel' || recorded === 'netlify' || recorded === 'cloudflare') return LOGS[recorded];
  if (mode === 'd3') return LOGS.cloudflare;
  const adapter = input.scan.kind === 'read' ? siteAdapter(input.scan) : undefined;
  if (adapter === '@astrojs/vercel') return LOGS.vercel;
  if (adapter === '@astrojs/netlify') return LOGS.netlify;
  if (adapter === '@astrojs/cloudflare') return LOGS.cloudflare;
  return LOGS.node;
}

/** What is wrong with one exit answer, or null; `mode` is what the config text says the build serves. */
function exitProblem(answer: Response, url: string, mode: 'd3' | 'd8', prefix: string): string | null {
  const { status, headers } = answer;
  const location = headers.get('location');
  const elsewhere =
    location !== null && status >= 300 && status < 400 && new URL(location, url).host !== new URL(url).host;
  if ([401, 403, 429].includes(status) || headers.has('cf-mitigated') || elsewhere) {
    return `answered ${status}: something in front of the site answered (auth, firewall or bot challenge): let ${prefix}/* through`;
  }
  if (status !== 302 || headers.get(PREVIEW_LABEL_HEADER) === null) {
    const label = headers.get(PREVIEW_LABEL_HEADER) === null ? ' without the conloca-preview label' : '';
    return `answered ${status} (location: ${location ?? 'none'})${label}, not the preview route's 302`;
  }
  const served = headers.get(PREVIEW_MODE_HEADER);
  if (served !== mode) return `serves preview mode ${served ?? 'none'}, but astro.config builds ${mode}`;
  const hit = (name: string) =>
    headers.get(name)?.toUpperCase().includes('HIT') ? `${name}: ${headers.get(name)}` : null;
  const cached = [
    Number(headers.get('age') ?? 0) > 0 ? `age: ${headers.get('age')}` : null,
    hit('cf-cache-status'),
    hit('x-cache'),
    hit('x-vercel-cache'),
    /;\s*hit\b/iu.test(headers.get('cache-status') ?? '') ? `cache-status: ${headers.get('cache-status')}` : null,
  ].filter((item) => item !== null);
  if (cached.length > 0) {
    return `a CDN caches the preview route (${cached.join(', ')}): bypass the cache for ${prefix}/*`;
  }
  if (!/\bno-store\b/iu.test(headers.get('cache-control') ?? '') || !/\bcookie\b/iu.test(headers.get('vary') ?? '')) {
    return 'answers without cache-control: no-store and Vary: Cookie, so a CDN may cache drafts';
  }
  return null;
}

/** CC29, under --live only: the site's preview route answers its exit as the configured mode, uncached, twice. */
async function checkPreviewExit(input: Input): Promise<CheckOutcome> {
  const { scan, deps, address } = input;
  const mode = previewServeSetting(scan);
  if (mode !== 'd3' && mode !== 'd8') return skipped('CC29', 'only D3 and d8 serve the preview route on the site');
  const base = (scan.kind === 'read' ? (scan.config.site.base ?? '/') : '/').replace(/\/?$/u, '/');
  const url = `${address}_conloca/preview/__exit?to=${base}`;
  const outcome = outcomeOf('CC29');
  const logs = logsOf(input, mode);
  const probe = async () => {
    const started = Date.now();
    try {
      const answer = await deps.fetch(url, {
        redirect: 'manual',
        credentials: 'omit',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return { problem: exitProblem(answer, url, mode, previewRoutePrefix(base)), ms: Date.now() - started };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { problem: `could not be reached (${reason})`, ms: Date.now() - started };
    }
  };
  // Twice, one after the other: a CDN that caches the route answers the second from its cache.
  const first = await probe();
  const second = await probe();
  const problem = first.problem ?? second.problem;
  if (problem !== null) {
    const timing = `(${first.ms} ms, ${second.ms} ms)`;
    outcome.problems.push({ check: 'CC29', level: 'error', message: `${url} ${problem} ${timing} — logs: ${logs}` });
  } else {
    outcome.detail = `302 in ${first.ms} ms and ${second.ms} ms`;
  }
  return outcome;
}

/** sites.json's previewUrl for the default site's default locale, when it names one. */
function declaredPreviewUrl(contentRoot: string, deps: DoctorDeps): string | undefined {
  let sites: unknown;
  try {
    sites = JSON.parse(deps.readFile(join(contentRoot, 'sites.json')));
  } catch {
    return undefined;
  }
  const all = isRecord(sites) && isRecord(sites.sites) ? sites.sites : {};
  const names = Object.keys(all);
  const site = all.default ?? (names.length === 1 ? all[names[0] ?? ''] : undefined);
  if (!isRecord(site) || !isRecord(site.previewUrl) || typeof site.defaultLocale !== 'string') return undefined;
  const value = site.previewUrl[site.defaultLocale];
  return typeof value === 'string' ? value : undefined;
}

/**
 * CC24 and CC29, under --live only: the separate preview deploy answers its own conloca.json as D4, on the site's
 * release; the site's own preview route answers its exit.
 */
export function runPreviewLiveChecks(input: Input): Promise<CheckOutcome[]> {
  return Promise.all([checkSeparateDeploy(input), checkPreviewExit(input)]);
}

async function checkSeparateDeploy(input: Input): Promise<CheckOutcome> {
  const { context, deps, scan } = input;
  if (previewServeSetting(scan) !== 'd4') return skipped('CC24', 'no separate preview deploy (D4)');
  const base = scan.kind === 'read' ? (scan.config.site.base ?? '/') : '/';
  const release = outcomeOf('CC24');
  const previewUrl = declaredPreviewUrl(context.contentRoot, deps);
  if (previewUrl === undefined) {
    release.problems.push({
      check: 'CC24',
      level: 'error',
      message:
        "sites.json names no previewUrl for the default locale: add the separate preview deploy's https:// address",
    });
    return release;
  }
  // A base written without its trailing slash (`/docs`) still needs one before `_conloca`.
  const url = `${previewUrl.replace(/\/+$/u, '')}${base.replace(/\/?$/u, '/')}_conloca/editor/conloca.json`;
  let served: unknown;
  try {
    const answer = await deps.fetch(url, {
      redirect: 'manual',
      credentials: 'omit',
      signal: AbortSignal.timeout(10_000),
    });
    served = answer.ok ? await answer.json() : undefined;
  } catch {
    served = undefined;
  }
  const preview = isRecord(served) && isRecord(served.preview) ? served.preview : undefined;
  if (preview?.mode !== 'd4') {
    release.problems.push({
      check: 'CC24',
      level: 'error',
      message: `${url} does not serve as a separate preview deploy: build it with CONLOCA_PREVIEW_BUILD=1 and deploy it`,
    });
  } else if (isRecord(served) && input.info !== undefined && served.builtWith !== input.info.builtWith) {
    release.problems.push({
      check: 'CC24',
      level: 'warn',
      message: `the preview deploy runs ${String(served.builtWith)} and the site ${input.info.builtWith}: deploy both from the same commit`,
    });
  } else {
    release.detail = 'the preview deploy answers as D4';
  }
  return release;
}
