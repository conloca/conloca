import { join } from 'node:path';
import { isRecord } from '@conloca/content-api/component-vocabulary';
import { parseWranglerConfig } from '../preview/cloudflare-adapter.js';
import { previewOwnEntries, previewRoutePrefix } from '../preview/preview-path.js';
import { type ConfigScan, previewServeSetting } from './config-scan.js';
import { type CheckOutcome, type DoctorDeps, outcomeOf, skipped } from './types.js';

type LimitDeps = Pick<DoctorDeps, 'exists' | 'readFile'>;
const UPDATE = '— run `conloca connect --update --yes`';
/** The binding connect writes: 60 requests per 10 s per visitor, not configurable. */
const BINDING = 'conlocaPreviewLimit';
const LIMIT = 60;
const PERIOD = 10;

/** A JSON file's object, or undefined; the return type is `isRecord`'s narrowing, never written out. */
function jsonRecord(deps: LimitDeps, path: string) {
  try {
    const value: unknown = JSON.parse(deps.readFile(path));
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** A JSON file's array of strings, or undefined. */
function jsonStrings(deps: LimitDeps, path: string): string[] | undefined {
  try {
    const value: unknown = JSON.parse(deps.readFile(path));
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;
  } catch {
    return undefined;
  }
}

/** What is wrong with one config block's preview binding, or null when it is the one connect writes. */
function bindingProblem(block: unknown, where: string): string | null {
  const list: unknown[] = isRecord(block) && Array.isArray(block.ratelimits) ? block.ratelimits : [];
  const binding = list.find((entry) => isRecord(entry) && entry.name === BINDING);
  if (!isRecord(binding)) {
    return `${where} has no ${BINDING} rate-limit binding, so nothing limits preview requests ${UPDATE}`;
  }
  if (typeof binding.namespace_id !== 'string' || !/^[1-9]\d*$/u.test(binding.namespace_id)) {
    return `${where}'s ${BINDING} namespace_id must be a positive integer, as a string ${UPDATE}`;
  }
  const simple = isRecord(binding.simple) ? binding.simple : {};
  if (simple.limit !== LIMIT || simple.period !== PERIOD) {
    return `${where} limits previews to ${String(simple.limit)} requests per ${String(simple.period)} s; previews use ${LIMIT} per ${PERIOD} s ${UPDATE}`;
  }
  return null;
}

/**
 * CC22–CC23: the dispatcher's rate-limit binding and the Cloudflare plan connect recorded, read from the project's
 * files. Never networks and reads no token: Conloca's own setup is all doctor checks; a dashboard rule is the site's
 * choice.
 */
export function runPreviewLimitChecks(scan: ConfigScan, projectDir: string, deps: LimitDeps): CheckOutcome[] {
  if (previewServeSetting(scan) !== 'd3') {
    const reason = 'only a static site previewing next to itself (D3) shares a Worker with previews';
    return [skipped('CC22', reason), skipped('CC23', reason)];
  }
  const base = scan.kind === 'read' ? (scan.config.site.base ?? '/') : '/';
  const prefix = previewRoutePrefix(base);

  // The recorded plan decides CC22 (the binding is for the Paid plan only) and is CC23 itself.
  const manifest = jsonRecord(deps, join(projectDir, 'package.json'));
  const conloca = isRecord(manifest?.conloca) ? manifest.conloca : {};
  const recorded = conloca.cfPlan;

  // CC22
  const path = ['wrangler.jsonc', 'wrangler.json'].map((name) => join(projectDir, name)).find((p) => deps.exists(p));
  let text: string | undefined;
  try {
    text = path === undefined ? undefined : deps.readFile(path);
  } catch {
    text = undefined;
  }
  const config = text === undefined ? undefined : parseWranglerConfig(text);
  let limited: CheckOutcome;
  if (config === undefined) limited = skipped('CC22', 'no wrangler.jsonc (see CC15)');
  else {
    limited = outcomeOf('CC22');
    // Wrangler does not inherit bindings into env blocks: each one needs its own.
    const envs = Object.entries(isRecord(config.env) ? config.env : {});
    const blocks: [string, unknown][] = [
      ['wrangler.jsonc', config],
      ...envs.map(([name, block]): [string, unknown] => [`wrangler.jsonc env.${name}`, block]),
    ];
    if (recorded === 'free') {
      // On Free a blocked request still counts against the daily quota, so connect writes no binding; one left over
      // from a Paid answer does no harm.
      const present = blocks.some(
        ([, block]) =>
          isRecord(block) &&
          Array.isArray(block.ratelimits) &&
          block.ratelimits.some((entry) => isRecord(entry) && entry.name === BINDING),
      );
      limited.detail = present
        ? `a ${BINDING} binding is there; the Free plan needs none, and \`conloca connect --update --yes\` removes it`
        : 'no rate limit on the Cloudflare Workers Free plan, as expected';
    } else {
      // Paid, or no plan recorded yet (CC23 reports that): the binding is required, as the build requires it.
      for (const [where, block] of blocks) {
        const problem = bindingProblem(block, where);
        if (problem !== null) limited.problems.push({ check: 'CC22', level: 'error', message: problem, path });
      }
      if (limited.problems.length === 0) limited.detail = `${LIMIT} preview requests per ${PERIOD} s per visitor`;
    }
  }

  // CC23
  const plan = outcomeOf('CC23');
  if (recorded === 'paid') plan.detail = 'the Cloudflare Workers Paid plan, recorded in package.json';
  else if (recorded !== 'free') {
    plan.problems.push({
      check: 'CC23',
      level: 'error',
      message:
        'package.json records no Cloudflare plan (conloca.cfPlan) — run `conloca connect`, or `conloca connect --yes --cf-plan paid` (or `free`)',
    });
  } else {
    const reported = jsonStrings(deps, join(projectDir, '.conloca', 'dispatcher', 'run_worker_first.json')) ?? [];
    const own = previewOwnEntries(base);
    const onDemand = reported.filter((entry) => !own.includes(entry) && !entry.startsWith(`${prefix}/`));
    // The site's on-demand routes stay next to the preview (a separate deploy would leave them without a Worker): a
    // warning, as connect gives, never an error.
    plan.problems.push({
      check: 'CC23',
      level: 'warn',
      message:
        onDemand.length > 0
          ? `On the Free plan, previews and your on-demand routes (${onDemand.join(', ')}) share one daily request quota; a flood of preview requests can stop those routes until 00:00 UTC. Cloudflare Workers Paid removes the daily limit.`
          : "On the Cloudflare Workers Free plan, a preview page over 10 ms of CPU fails, and a flood of preview requests can use up the day's requests and pause preview, never the published pages, until the quota resets: the Paid plan avoids both",
    });
  }
  return [limited, plan];
}
