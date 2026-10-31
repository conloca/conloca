import { join } from 'node:path';
import { isRecord } from '@conloca/content-api/component-vocabulary';
import type { EditorPageInfo } from '@conloca/content-api/editor-host';
import { type ConfigScan, previewServeSetting } from './config-scan.js';
import { type CheckOutcome, type CloudDoctorContext, type DoctorDeps, outcomeOf, skipped } from './types.js';

interface Input {
  context: CloudDoctorContext;
  deps: DoctorDeps;
  scan: ConfigScan;
  /** The deployed site's conloca.json, when CC11 read it. */
  info: EditorPageInfo | undefined;
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

/** CC24, under --live only: the separate preview deploy answers its own conloca.json as D4, on the site's release. */
export async function runPreviewLiveChecks(input: Input): Promise<CheckOutcome[]> {
  const { context, deps, scan } = input;
  if (previewServeSetting(scan) !== 'd4') return [skipped('CC24', 'no separate preview deploy (D4)')];
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
    return [release];
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
  return [release];
}
