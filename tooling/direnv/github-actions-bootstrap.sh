#!/bin/bash
set -euo pipefail

NIX_STORE_NAR="${NIX_STORE_NAR:-/tmp/nix-store.nar}"
nix_store_cmd="/nix/var/nix/profiles/default/bin/nix-store"
# Resolve from this script's location, not the caller's cwd. GitHub Actions
# runs this from tooling/direnv today, but direct cwd-changing helpers are easy
# to misuse and break on repeated calls.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"

clear_devenv_cache_state() {
  rm -rf "$repo_root/tooling/direnv/.devenv" "$repo_root/tooling/direnv/.direnv"
}

add_repo_paths() {
  "$repo_root/tooling/direnv/repo-path" --github-path
}

restore_nix_store() {
  if [ -s "$NIX_STORE_NAR" ]; then
    if ! sudo "$nix_store_cmd" --import --quiet < "$NIX_STORE_NAR"; then
      # .devenv/.direnv contain absolute /nix/store references. If importing the
      # matching store closure fails, clearing them prevents incoherent restores.
      clear_devenv_cache_state
      exit 1
    fi
    # The restored NAR is only the import source. Cleanup exports a fresh NAR for
    # the next cache save, so remove this workspace scratch file before release
    # steps run git cleanliness checks.
    rm -f "$NIX_STORE_NAR"
  else
    echo "No NAR file found; clearing devenv cache state"
    clear_devenv_cache_state
  fi
}

install_devenv() {
  sudo mkdir -p /nix/var/nix/gcroots/ci
  if ! command -v devenv >/dev/null 2>&1; then
    nix profile add --accept-flake-config nixpkgs#devenv
  fi
  echo "$HOME/.nix-profile/bin" >> "$GITHUB_PATH"
  sudo ln -sf "$HOME/.nix-profile" /nix/var/nix/gcroots/ci/profile
}

build_devenv_shell() {
  devenv shell --verbose -- date
  # Add repo-local tools only after the shell exists; cleanup steps use an
  # explicit PATH because failures before this point must still refresh caches.
  add_repo_paths
}

case "${1:-}" in
  restore-store) restore_nix_store ;;
  install-devenv) install_devenv ;;
  build-shell) build_devenv_shell ;;
  *)
    echo "Usage: $0 {restore-store|install-devenv|build-shell}" >&2
    exit 1
    ;;
esac
