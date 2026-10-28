/** Minimal environment surface used for zero-config repository detection. */
export type RepositoryEnvironment = Record<string, string | undefined>;

export interface DetectRepositoryUriInput {
  /** Advanced escape hatch for non-standard checkouts. Normal builds omit it. */
  explicit?: string;
  env?: RepositoryEnvironment;
  /** `remote.origin.url`, supplied by the integration after a best-effort git read. */
  remote?: string;
}

const REPO_SEGMENT = /^[A-Za-z0-9_.-]+$/;

/**
 * Normalize a provider full_name or common Git remote into `owner/repo`.
 * Deliberately rejects local paths and nested groups: the editor page names
 * its repository GitHub-style, as two segments.
 */
export function normalizeRepositoryUri(input: string | undefined): string | undefined {
  if (input === undefined) return undefined;
  let value = input.trim();
  if (value === '' || value.startsWith('/')) return undefined;

  const scp = /^[^@/]+@[^:/]+:(.+)$/.exec(value);
  if (scp) {
    value = scp[1];
  } else if (value.includes('://')) {
    try {
      value = new URL(value).pathname;
    } catch {
      return undefined;
    }
  }

  value = value.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  let parts = value.split('/');
  if (parts.length === 3 && parts[0].includes('.')) parts = parts.slice(1);
  if (parts.length !== 2 || !parts.every((part) => REPO_SEGMENT.test(part))) return undefined;
  return `${parts[0]}/${parts[1]}`;
}

/** Resolve repo identity from configuration-free CI metadata, then Git. */
export function detectRepositoryUri(input: DetectRepositoryUriInput = {}): string | undefined {
  const env = input.env ?? process.env;
  const vercel =
    env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG
      ? `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}`
      : undefined;
  for (const candidate of [input.explicit, env.GITHUB_REPOSITORY, vercel, env.CI_PROJECT_PATH, input.remote]) {
    const normalized = normalizeRepositoryUri(candidate);
    if (normalized !== undefined) return normalized;
  }
  return undefined;
}
