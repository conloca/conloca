#!/usr/bin/env bash
set -euo pipefail

# Resolve from this script's location, not the caller's cwd. GitHub Actions
# runs this from tooling/direnv today, but direct cwd-changing helpers are easy
# to misuse and break on repeated calls.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
# Host CI supplies its bind-mounted cache through the runner profile. Ephemeral
# runners must use the same repository path restored by cache-ttsc-plugins.
# A separate name on purpose: assigning to TTSC_CACHE_DIR itself would mutate
# the (possibly exported) environment that persist_devenv_environment later
# fingerprints as the pre-shell baseline.
ttsc_cache_dir_default="${TTSC_CACHE_DIR:-$repo_root/.cache/ttsc}"

add_repo_paths() {
  "$repo_root/tooling/direnv/repo-path" --github-path
}

# The CLI that evaluates the shell must be the commit whose modules the shell is
# locked to. devenv writes its own source rev into devenv.lock's `devenv` node,
# so the lock already names one coherent pair (CLI 2.3.1+190959a evaluating the
# 190959a modules) and nothing here restates it. Note `original` carries no rev:
# that node is HEAD-at-lock-time rather than a release tag, so this pin buys
# coherence, not blessing.
#
# An unpinned `github:cachix/devenv` instead installs whatever HEAD is on the day
# a cold runner misses the store cache — a version that moves with no commit
# behind it, so it cannot be reviewed or bisected, and a CLI newer than the
# locked modules breaks eval-cache or flag compatibility with no diff to blame.
# `--accept-flake-config` makes it worse than untidy: it pre-trusts the
# substituters declared by a commit nobody looked at.
#
# Resolved lazily, on the paths that need it, because a host runner never does
# and that is the one branch which must not pay for a `nix eval`.
devenv_locked_rev() {
  local lock="$repo_root/tooling/direnv/devenv.lock" rev
  # nix, not jq: jq arrives with the shell this script is about to build, while
  # nix is guaranteed by the install step before it. fromJSON also beats
  # hand-rolled parsing of a file whose key order is not ours to assume.
  # Absolute-path readFile needs --impure; nix's own error is left on stderr
  # rather than swallowed, because an unresolvable pin is the failure these
  # functions exist to prevent.
  rev="$(nix eval --raw --impure --expr \
    "(builtins.fromJSON (builtins.readFile \"$lock\")).nodes.devenv.locked.rev")" || rev=""
  if [ -z "$rev" ]; then
    echo "install-devenv: cannot resolve .nodes.devenv.locked.rev from $lock" >&2
    echo "                set DEVENV_FLAKE to install a devenv explicitly" >&2
    return 1
  fi
  printf '%s' "$rev"
}

# Whether a devenv binary is the commit the lock names. `devenv version` prints
# "devenv <semver>+<short rev> (<system>)", so the abbreviated commit is right
# there and a prefix test against the full rev is the entire comparison — no
# assumption about how many characters devenv chooses to abbreviate to. A build
# with no "+<rev>" at all cannot prefix a 40-char hex rev, so it reads as a
# mismatch, which is the safe direction.
devenv_matches_lock() {
  local bin="$1" rev="$2" printed
  printed="$("$bin" version 2>/dev/null)" || return 1
  printed="${printed#*+}"
  printed="${printed%% *}"
  [ -n "$printed" ] || return 1
  case "$rev" in
    "$printed"*) return 0 ;;
  esac
  return 1
}

install_devenv() {
  local rev flake found=""
  # Host runners own their Nix profile, and that profile roots a /nix/store the
  # whole fleet shares, so an image-provided devenv is authoritative here
  # whatever commit it is — and a wrong one is never REPLACED, because
  # `nix profile remove --all` on a host would take the fleet's other roots with
  # it. SMOO_HOST_RUNNER comes from setup-devenv's runner-kind detection.
  #
  # With none present these runners install from the FLOATING branch, not the
  # locked rev, which is the one place this script deliberately accepts drift.
  # The pin exists to make the ephemeral runners' cached devenv reproducible;
  # a host installs into a long-lived shared profile whose blast radius is the
  # whole fleet, and pinning it down to an older CLI than the fleet had been
  # running broke it: run 34374650577 segfaulted the Rust linker
  # (devenv-rust-linker, clang exit 139) building cowshed-cli tests, where run
  # 34371205556 on the same commit range was green with floating 2a399e9.
  # 190959a is TWO COMMITS OLDER than what these hosts had been getting, so the
  # pin was moving them backwards. A host's toolchain moves when its image or
  # the lock moves, not when a repository decides to hold it back.
  if [ "${SMOO_HOST_RUNNER:-false}" = true ]; then
    if command -v devenv >/dev/null 2>&1; then
      echo "using host devenv: $(command -v devenv) ($(devenv version))"
    else
      flake="${DEVENV_FLAKE:-github:cachix/devenv}"
      echo "host runner has no devenv; nix profile add ${flake}"
      nix profile add --accept-flake-config "$flake"
    fi
    devenv_path_and_caches
    return 0
  fi

  rev="$(devenv_locked_rev)"
  # The store cache carries content only, never the Nix profiles, so the normal
  # ephemeral case is that nothing is installed yet and this profile-adds the
  # locked rev against an already-warm /nix — an evaluation and a link, not a
  # download. Anything that does turn up on PATH is still checked rather than
  # trusted, because "a devenv exists" was never the question.
  if command -v devenv >/dev/null 2>&1; then
    found="$(command -v devenv)"
  elif [ -x "$HOME/.nix-profile/bin/devenv" ]; then
    found="$HOME/.nix-profile/bin/devenv"
  fi

  if [ -n "$found" ] && devenv_matches_lock "$found" "$rev"; then
    echo "using locked devenv: $found ($("$found" version))"
  else
    flake="${DEVENV_FLAKE:-github:cachix/devenv/$rev}"
    if [ -n "$found" ]; then
      # Replacing needs the old entry gone first: `nix profile add` would
      # otherwise refuse on a bin/devenv collision at equal priority. --all is
      # exact rather than blunt, because devenv is the only thing this script
      # ever profile-adds, so a wrong devenv means a wrong profile.
      echo "replacing devenv $("$found" version 2>/dev/null) — lock names ${rev:0:7}"
      nix profile remove --all
    fi
    echo "nix profile add ${flake}"
    nix profile add --accept-flake-config "$flake"
  fi
  devenv_path_and_caches
}

devenv_path_and_caches() {
  if [ -d "$HOME/.nix-profile/bin" ]; then
    echo "$HOME/.nix-profile/bin" >> "${GITHUB_PATH:-/dev/null}"
  fi
  if [ -n "$ttsc_cache_dir_default" ]; then
    mkdir -p "$ttsc_cache_dir_default"
  fi
}

build_devenv_shell() {
  local since
  since="$(date +%s)"
  # One evaluation: the shell that captures the environment is the shell
  # build. A separate `devenv shell -- date` evaluated everything twice.
  persist_devenv_environment
  # Only the ephemeral-runner path of setup-devenv opts in: the scan walks the
  # whole store, which on a developer host or a host runner is large and not
  # ours to root.
  if [ "${SMOO_ROOT_BUILD_INPUTS:-false}" = true ]; then
    root_build_inputs "$since"
  fi
  # Add repo-local tools only after the shell exists; cleanup steps use an
  # explicit PATH because failures before this point must still refresh caches.
  add_repo_paths
}

# The store cache's post phase collects garbage down to the live roots before
# it saves, and the shell's own root (.devenv/gc/shell) covers only the build
# closure. What evaluation fetched and built - flake input sources, the
# import-from-derivation outputs devenv-nixpkgs-patched and cabal2nix-* - has
# no root, so it was collected on the miss run and every hit run rebuilt it
# (measured at ~80s of a 150s setup on hosted macOS, run 34427309827). devenv
# records no store paths in its eval cache, so the exact set is the paths this
# build registered: root them under .devenv/gc, which the devenv cache carries
# and /nix/var/nix/gcroots/auto (inside the store cache) points at.
root_build_inputs() {
  local since="$1" gcdir="$PWD/.devenv/gc/build-inputs" paths
  rm -rf "$gcdir"
  mkdir -p "$gcdir"
  # `nix path-info --all --json` is an object keyed by path on Nix >= 2.19 and
  # an array of {path} objects before that.
  paths="$(nix path-info --all --json 2>/dev/null | jq -r --argjson since "$since" '
    (if type == "array" then map({key: .path, value: .}) | from_entries else . end)
    | to_entries[] | select(.value.registrationTime >= $since) | select(.key | endswith(".drv") | not) | .key')"
  if [ -z "$paths" ]; then
    echo "no store paths registered since $since; nothing to root"
    return 0
  fi
  # Store paths are installables; --out-link names the first link and numbers
  # the rest, each an indirect gc root. Derivations are excluded: keep-derivations
  # retains the ones whose outputs are rooted, and realising a .drv would build it.
  # shellcheck disable=SC2086
  nix build --out-link "$gcdir/path" $paths
  echo "rooted $(printf '%s\n' "$paths" | wc -l | tr -d ' ') store paths registered during the shell build under $gcdir"
}

# Workflow steps run their commands directly — never through `devenv shell` —
# so nothing the shell hooks export survives this composite action on its own.
# Persisting a hand-picked list here proved to be whack-a-mole: the TTSC
# variables were copied while LD_LIBRARY_PATH was not, and Bun-spawned native
# bindings dlopen-failed on NixOS runners (Bun has no Nix RUNPATH, unlike the
# patched Node, so it resolves libstdc++ only through that variable). Instead,
# capture the exported environment the devenv shell actually produces and
# persist everything it added or changed, minus what belongs to the runner
# step itself or to shell-session bookkeeping.
persist_devenv_environment() {
  [ -n "${GITHUB_ENV:-}" ] || return 0
  local name entry value captured bkey persisted=""
  # Baseline: this step's own exported variables, before shell influence.
  # Stored as smoo_baseline_<name> pseudo-map entries (printf -v), not a
  # bash-4 associative array — macOS runners still ship bash 3.2. compgen -e
  # only lists names that are valid identifiers, so the composed variable
  # name is always valid too.
  while IFS= read -r name; do
    printf -v "smoo_baseline_$name" '%s' "${!name}"
  done < <(compgen -e)
  # NUL separators keep multi-line values intact, and compgen -e lists
  # exported variables only (no BASH_FUNC_* noise). bash is the one
  # interpreter every devenv shell provides, so this needs no coreutils.
  # The capture writes to a file, NOT stdout: enterShell hooks print their
  # own progress to stdout and would corrupt an inline capture.
  captured="$(mktemp)"
  SMOO_ENV_CAPTURE_OUT="$captured" devenv shell -- bash -c \
    'while IFS= read -r n; do printf "%s=%s\0" "$n" "${!n}"; done < <(compgen -e) > "$SMOO_ENV_CAPTURE_OUT"'
  while IFS= read -r -d '' entry; do
    name="${entry%%=*}"
    value="${entry#*=}"
    case "$name" in
      # The runner step owns these; PATH persistence is add_repo_paths' job.
      PATH | PWD | OLDPWD | SHLVL | SHELL | HOME | USER | LOGNAME | HOSTNAME | TERM | TMPDIR | TMP | TEMP | _ | PS1) continue ;;
      GITHUB_* | RUNNER_* | ACTIONS_* | CI) continue ;;
      # Shell-session bookkeeping, meaningful only inside the shell itself.
      DIRENV_* | DEVENV_* | NIX_* | BASH* | XDG_* | IN_NIX_SHELL | SMOO_ENV_CAPTURE_OUT) continue ;;
    esac
    bkey="smoo_baseline_$name"
    if [ "${!bkey+set}" = set ] && [ "${!bkey}" = "$value" ]; then
      continue
    fi
    if [ "${value#*$'\n'}" != "$value" ]; then
      # GITHUB_ENV heredoc form for multi-line values; the delimiter only has
      # to never appear as a full line inside the value.
      printf '%s<<__SMOO_DEVENV_ENV__\n%s\n__SMOO_DEVENV_ENV__\n' "$name" "$value" >> "$GITHUB_ENV"
    else
      printf '%s=%s\n' "$name" "$value" >> "$GITHUB_ENV"
    fi
    persisted="$persisted $name"
  done < "$captured"
  rm -f "$captured"
  echo "devenv environment persisted for later steps:${persisted:- (none)}"
}

case "${1:-}" in
  install-devenv) install_devenv ;;
  build-shell) build_devenv_shell ;;
  *)
    echo "Usage: $0 {install-devenv|build-shell}" >&2
    exit 1
    ;;
esac
