import { findNodeAtLocation, parseTree } from 'jsonc-parser';
import { isRecord } from '../is-record.js';
import { previewOwnEntries, setIn } from './preview-deploy.js';
import type { FileEdit } from './step.js';

/** The site's Cloudflare Workers plan, as its owner answered: it decides whether the preview rate limit is written. */
export type CfPlan = 'free' | 'paid';

export function isCfPlan(value: unknown): value is CfPlan {
  return value === 'free' || value === 'paid';
}

/** package.json as an object, or undefined; the return type is `isRecord`'s narrowing, never written out. */
function parsed(text: string | null) {
  if (text === null) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** package.json `conloca.cfPlan`, the answer connect recorded; undefined when there is none. */
export function recordedCfPlan(packageJson: string | null): CfPlan | undefined {
  const conloca = parsed(packageJson)?.conloca;
  const plan = isRecord(conloca) ? conloca.cfPlan : undefined;
  return isCfPlan(plan) ? plan : undefined;
}

/**
 * package.json with `conloca.cfPlan` set and every other byte kept. A new `conloca` key is written after the last
 * one by hand: jsonc-parser's formatter would also reflow the line before it (a one-line `devDependencies`).
 */
function withPlan(text: string, plan: CfPlan): string {
  const tree = parseTree(text);
  const last = tree?.type === 'object' ? tree.children?.at(-1) : undefined;
  if (tree === undefined || findNodeAtLocation(tree, ['conloca']) !== undefined || last === undefined) {
    return setIn(text, ['conloca', 'cfPlan'], plan);
  }
  const end = last.offset + last.length;
  const indent = /^[ \t]*/u.exec(text.slice(text.lastIndexOf('\n', last.offset) + 1))?.[0] || '  ';
  const value = JSON.stringify({ cfPlan: plan }, null, indent).replaceAll('\n', `\n${indent}`);
  return `${text.slice(0, end)},\n${indent}"conloca": ${value}${text.slice(end)}`;
}

/** package.json with the plan recorded as a minimal edit, its layout kept; null when it is recorded already. */
export function cfPlanEdit(path: string, packageJson: string, plan: CfPlan): FileEdit | null {
  if (parsed(packageJson) === undefined || recordedCfPlan(packageJson) === plan) return null;
  return { path, before: packageJson, after: withPlan(packageJson, plan) };
}

/** The site's own on-demand routes, which on the Free plan share one daily request quota with previews. */
export function sharedQuotaRoutes(routes: readonly string[] | null, prefix: string): string[] {
  const own = previewOwnEntries(prefix);
  return (routes ?? []).filter((route) => !own.includes(route) && !route.startsWith(`${prefix}/`));
}
