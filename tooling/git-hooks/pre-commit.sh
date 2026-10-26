#!/usr/bin/env bash
cd "$(git rev-parse --show-toplevel)"
TOOLING="$PWD/tooling"

export PATH="$("$TOOLING/direnv/repo-path")"
# ttsc compiles with this checkout's native TypeScript compiler into this
# checkout's plugin cache, which the dev shell names. A hook runs outside that
# shell, in whatever environment ran `git`; ttsc-env.sh names them the same way.
. "$TOOLING/direnv/ttsc-env.sh"

set -e -o pipefail

# Format the index git handed this hook, which is what the commit will contain:
# the staged content for a plain `git commit`, and a snapshot of the working
# tree copies of the named paths for `git commit --only -- <paths>`. It rewrites
# that index and the working tree file, and post-commit then drops the
# pre-format entry a partial commit strands in the real index.
git-format-staged

# Judge the formatted added lines from that same index, not unstaged edits.
smoo monorepo check-public-denylist --staged

# Adding a workspace package is rare and easy to leave half-wired. Run the
# full monorepo validator only for newly staged package manifests.
smoo monorepo validate --fail-fast --only-if-new-workspace-package
