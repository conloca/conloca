#!/usr/bin/env bash
cd "$(git rev-parse --show-toplevel)"
TOOLING="$PWD/tooling"

# A bare assignment, not `export PATH=$(…)`: export's status would hide repo-path's refusal of an unserved workspace.
PATH="$("$TOOLING/direnv/repo-path")" || exit $?
# ttsc compiles with this checkout's native TypeScript compiler into this
# checkout's plugin cache, which the dev shell names. A hook runs outside that
# shell, in whatever environment ran `git`; ttsc-env.sh names them the same way.
. "$TOOLING/direnv/ttsc-env.sh"

set -e -o pipefail

smoo monorepo validate-commit-msg --fix "$1"
smoo monorepo check-public-denylist --commit-message "$1"
