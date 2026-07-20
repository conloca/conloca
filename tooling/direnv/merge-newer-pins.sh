#!/usr/bin/env bash
# smoo-managed git merge driver: keep whichever side pins the NEWER version.
#
# Runtime version pins (nvfetcher overlay _sources/generated.{json,nix}) and the
# devenv/flake lock (devenv.lock) frequently differ across branches or across a
# mirror sync's `git am --3way`. Instead of stalling on a conflict, keep the
# higher pin wholesale so the tree always converges to the newest runtime.
# Repair package.json engine/packageManager pins explicitly with
# `smoo monorepo init --runtime-only` when needed.
#
# Wired by `smoo` (managed .gitattributes -> merge=smoo-newer-pins, and
# `git config merge.smoo-newer-pins.driver` installed by applyWorkspaceGitConfig).
# git invokes it as: merge-newer-pins.sh %O %A %B %P
#   %O base, %A ours (result written here), %B theirs, %P pathname.
set -euo pipefail

ours="$2"
theirs="$3"

# Flake locks are ordered by lastModified (unix seconds); nvfetcher outputs by
# the semver in their version fields. A given file is one kind or the other.
max_last_modified() {
  grep -oE '"lastModified"[[:space:]]*:[[:space:]]*[0-9]+' "$1" 2>/dev/null \
    | grep -oE '[0-9]+' | sort -n | tail -1
}
max_semver() {
  grep -oE 'version[[:space:]":=]*[0-9]+\.[0-9]+\.[0-9]+' "$1" 2>/dev/null \
    | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | sort -V | tail -1
}

ours_lm="$(max_last_modified "$ours" || true)"
theirs_lm="$(max_last_modified "$theirs" || true)"

if [ -n "${ours_lm}${theirs_lm}" ]; then
  # Flake lock: numeric lastModified comparison.
  if [ -n "$theirs_lm" ] && [ "${theirs_lm:-0}" -gt "${ours_lm:-0}" ]; then
    cp "$theirs" "$ours"
  fi
else
  # nvfetcher / version-pinned file: semver comparison.
  ov="$(max_semver "$ours" || true)"
  tv="$(max_semver "$theirs" || true)"
  newest="$(printf '%s\n%s\n' "${ov:-0.0.0}" "${tv:-0.0.0}" | sort -V | tail -1)"
  if [ -n "$tv" ] && [ "$newest" = "$tv" ] && [ "$tv" != "${ov:-}" ]; then
    cp "$theirs" "$ours"
  fi
fi
exit 0
