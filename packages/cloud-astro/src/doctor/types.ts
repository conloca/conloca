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
  CC8: 'the preview build, when previewBuild is set, has an SSR adapter',
  CC11: 'the deployed editor page answers',
  CC12: 'the deployed editor page may be framed',
  CC13: "the editor speaks this page's protocol",
} as const;

/** A typo in a check id fails tsc here; the CLI would otherwise drop a label-less outcome silently. */
export type CheckId = keyof typeof CHECK_LABELS;

export function outcomeOf(id: CheckId): CheckOutcome {
  return { id, label: CHECK_LABELS[id], problems: [] };
}

export function skipped(id: CheckId, reason: string): CheckOutcome {
  return { ...outcomeOf(id), skipped: reason };
}
