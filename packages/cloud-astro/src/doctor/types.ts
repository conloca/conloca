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
  CC2: 'build token is available and well-formed',
  CC3: 'endpoint and public base URL are usable',
  CC4: "conlocaCMS options the endpoint's editor ignores",
  CC5: 'the endpoint answers the build token',
  CC6: 'a registration serves this branch and site',
  CC7: 'the registered editor assets are still deployed',
  CC8: 'the preview build has an SSR adapter, or is off',
} as const;

/** A typo in a check id fails tsc here; the CLI would otherwise drop a label-less outcome silently. */
export type CheckId = keyof typeof CHECK_LABELS;

export function outcomeOf(id: CheckId): CheckOutcome {
  return { id, label: CHECK_LABELS[id], problems: [] };
}

export function skipped(id: CheckId, reason: string): CheckOutcome {
  return { ...outcomeOf(id), skipped: reason };
}
