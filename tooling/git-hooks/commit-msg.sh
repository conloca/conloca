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

smoo monorepo validate-commit-msg --fix "$1"
