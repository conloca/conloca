#!/usr/bin/env bash
cd "$(git rev-parse --show-toplevel)"
TOOLING="$PWD/tooling"

export PATH="$("$TOOLING/direnv/repo-path")"

set -e -o pipefail

smoo monorepo validate-commit-msg --fix "$1"
