/**
 * The commit a registration names and the commit the artifact was built from.
 * They differ only when CI hands over the branch's latest commit
 * (`CF_PAGES_COMMIT_SHA`) while building another commit — a pull request's
 * merge commit — because the endpoint can only serve a commit the branch
 * actually carries.
 */
export interface RegistrationCommits {
  gitSha: string | undefined;
  buildId: string | undefined;
}

/** Resolves which commit the registration names and which commit produced the bundle. */
export function registrationCommits(input: {
  /** The branch's latest commit, as CI hands it over through CF_PAGES_COMMIT_SHA. */
  eventCommitSha: string | undefined;
  /** git rev-parse HEAD in the build checkout. */
  checkoutCommitSha: string | undefined;
}): RegistrationCommits {
  const gitSha = input.eventCommitSha ?? input.checkoutCommitSha;
  return { gitSha, buildId: input.checkoutCommitSha ?? gitSha };
}
