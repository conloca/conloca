#!/usr/bin/env bash
set -e

pushd "$(dirname "$0")" > /dev/null
  # Find the tooling and workspace root absolute paths
  cd ..
  TOOLING="$(pwd)"
  cd "$TOOLING/.."
  WORKSPACE_ROOT="$(pwd)"
popd > /dev/null

# Get the .git directory location reliably (submodule or not)
GIT_DIR="$(git rev-parse --git-dir)"

# Find and pushd to the git repository root
pushd "$(git rev-parse --show-toplevel)" > /dev/null || {
  echo "Error: Not in a git repository"
  exit 1
}
  # Include workspace specific Git configuration
  git config --local include.path "$TOOLING/workspace.gitconfig"

  # Make sure the pre-commit hook is linked:
  pre_commit_hook="$TOOLING/git-hooks/pre-commit.sh"
  [ "$(readlink "$GIT_DIR/hooks/pre-commit")" = "$pre_commit_hook" ] || {
    echo "[!] Linking pre-commit hook in ${GIT_DIR}"
    rm -f "$GIT_DIR/hooks/pre-commit"
    ln -vs "$pre_commit_hook" "$GIT_DIR/hooks/pre-commit"
    echo
  }
popd > /dev/null
