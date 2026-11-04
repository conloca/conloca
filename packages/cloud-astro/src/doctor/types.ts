import type { gitOutput } from '../git.js';
import type { RepositoryEnvironment } from '../repository.js';

/**
 * Structural mirror of @conloca/cli's doctor report types. The CLI ships no
 * type exports; the extension contract is documented in its README and pinned
 * by `contractVersion`.
 */
export interface DoctorProblem {
  check: string;
  level: 'error' | 'warn';
  message: string;
  path?: string;
}

export interface CheckOutcome {
  id: string;
  label: string;
  problems: DoctorProblem[];
  /** Extra context for the human pass/fail line. The doctor has no info level; this is where infos go. */
  detail?: string;
  /** Why a prerequisite kept the check from running. */
  skipped?: string;
}

/** What the CLI hands the extension (doctor extension contract 1). */
export interface CloudDoctorContext {
  contractVersion: 1;
  projectDir: string;
  contentRoot: string;
  /** Only under `conloca doctor --live` may the checks network — and only to the configured endpoint. */
  live: boolean;
}

export interface CloudDoctorResult {
  contractVersion: 1;
  checks: CheckOutcome[];
}

/** Seams for tests: every side effect the checks perform goes through here. */
export interface DoctorDeps {
  env: RepositoryEnvironment;
  exists(path: string): boolean;
  readFile(path: string): string;
  git: typeof gitOutput;
  /** The callable half of fetch: Bun's `typeof fetch` also demands the `preconnect` static, which a test fake never has. */
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

/** Insertion order is the report order. */
const CHECK_LABELS = {
  CC1: 'conlocaCloud is wired next to conlocaCMS',
  CC9: 'the site domain is declared in sites.json',
  CC10: 'committed headers allow framing the editor page',
  CC14: 'no build key leftovers',
  CC8: 'how the preview build serves drafts',
  CC15: 'the preview deploys to Cloudflare Workers',
  CC16: 'Wrangler is 4.36 or newer',
  CC17: 'wrangler.jsonc runs the preview dispatcher',
  CC18: 'run_worker_first lists every on-demand route',
  CC19: 'a plain wrangler deploy ships the site',
  CC20: 'misses and negotiated pages reach the right place',
  CC21: 'no tag manager runs on draft pages',
  CC22: "the preview route's rate limit fits the plan",
  CC23: 'the recorded Cloudflare plan fits draft previews',
  CC25: 'the adapter is one draft preview supports',
  CC26: 'nothing in astro.config turns draft preview off',
  CC27: 'the host routes the preview as d8 needs',
  CC28: 'the Node server allows the site domains',
  CC11: 'the deployed editor page answers',
  CC12: 'the deployed editor page may be framed',
  CC13: "the editor speaks this page's protocol",
  CC24: 'the separate preview deploy runs this release',
  CC29: "the site's preview route answers, uncached",
} as const;

/** A typo in a check id fails tsc here; the CLI would otherwise drop a label-less outcome silently. */
export type CheckId = keyof typeof CHECK_LABELS;

/** Every doctor request is bounded: a hanging host must never hang `conloca doctor` (the CLI seam has no timer of its own). */
export const REQUEST_TIMEOUT_MS = 10_000;

export function outcomeOf(id: CheckId): CheckOutcome {
  return { id, label: CHECK_LABELS[id], problems: [] };
}

export function skipped(id: CheckId, reason: string): CheckOutcome {
  return { ...outcomeOf(id), skipped: reason };
}
