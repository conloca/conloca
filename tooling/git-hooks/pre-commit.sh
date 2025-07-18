#!/usr/bin/env bash
cd "$(git rev-parse --show-toplevel)" # Workspace root
TOOLING="$PWD/tooling"

# Add hook scripts, bun installed tools and Devenv to PATH:
export PATH="$TOOLING/git-hooks:$TOOLING:$PWD/node_modules/.bin:$TOOLING/direnv/.devenv/profile/bin:$PATH"

# Make bash abort on errors and output commands
set -e -o pipefail

git-format-staged
