#!/usr/bin/env bash
# Git merge driver: keep whichever side pins the NEWER version.
#
# Used for nvfetcher-generated overlay files (_sources/generated.{json,nix}).
# Parallel changes can carry different runtime version pins (bun/node). Instead
# of stalling on a conflict, this driver keeps the higher version wholesale, so
# the repository converges to the newest runtime without manual resolution.
#
# Wired via .gitattributes (merge=nvfetcher-newer) + tooling/workspace.gitconfig.
# Invoked by git as: merge-newer.sh %O %A %B %P
#   %O base ancestor, %A ours (result written here), %B theirs, %P pathname.
set -euo pipefail

ours="$2"
theirs="$3"

# Highest semver-looking value from any version field. Handles both the JSON
# form (`"version": "1.3.14"`) and the nix form (`version = "1.3.14";`) by
# allowing quotes/colons/equals/space between the `version` key and the number.
maxver() {
  grep -oE 'version[[:space:]":=]*[0-9]+\.[0-9]+\.[0-9]+' "$1" 2>/dev/null \
    | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | sort -V | tail -1
}

ov="$(maxver "$ours" || true)"
tv="$(maxver "$theirs" || true)"
newest="$(printf '%s\n%s\n' "${ov:-0.0.0}" "${tv:-0.0.0}" | sort -V | tail -1)"

# Take theirs only when it is strictly newer; otherwise keep ours (already in $2).
if [ -n "$tv" ] && [ "$newest" = "$tv" ] && [ "$tv" != "${ov:-}" ]; then
  cp "$theirs" "$ours"
fi
exit 0
