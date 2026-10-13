#!/usr/bin/env bash
cd "$(git rev-parse --show-toplevel)"
TOOLING="$PWD/tooling"

export PATH="$("$TOOLING/direnv/repo-path")"
# ttsc compiles with the native TypeScript compiler, which the dev shell names in
# TTSC_TSGO_BINARY. A hook runs outside that shell, where ttsc would resolve the
# JavaScript compiler a package's `typescript` dependency names and refuse to run.
if [ -z "${TTSC_TSGO_BINARY:-}" ] && [ -x "$PWD/node_modules/@typescript/native/bin/tsc" ]; then
  export TTSC_TSGO_BINARY="$PWD/node_modules/@typescript/native/bin/tsc"
fi

set -e -o pipefail

# Format the index git handed this hook, which is what the commit will contain:
# the staged content for a plain `git commit`, and a snapshot of the working
# tree copies of the named paths for `git commit --only -- <paths>`. It rewrites
# that index and the working tree file, and post-commit then drops the
# pre-format entry a partial commit strands in the real index.
git-format-staged

# Adding a workspace package is rare and easy to leave half-wired. Run the
# full monorepo validator only for newly staged package manifests.
smoo monorepo validate --fail-fast --only-if-new-workspace-package
