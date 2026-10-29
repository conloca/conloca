# Managed by `smoo monorepo`. Sourced from the workspace root by devenv.smoo.nix's
# enterShell prologue, before nx-socket-dir.sh rebinds NX_WORKSPACE_ROOT_PATH,
# and by the git hooks, which run outside that shell:
#
#   . tooling/direnv/ttsc-env.sh
#
# Exports ttsc's environment for this workspace: TTSC_TSGO_BINARY, the native
# TypeScript compiler (ttsc resolves only the unscoped `typescript` package by
# default, which here is the JavaScript compiler API), and TTSC_CACHE_DIR and
# TTSC_GO_CACHE_DIR, where ttsc keeps the plugin binaries it compiles and the
# Go build cache that compiles them.
#
# This checkout is the directory the script is sourced from: devenv.smoo.nix's
# enterShell enters the workspace root first, and each git hook enters
# `git rev-parse --show-toplevel`. Sourced from any other directory, $PWD names
# no checkout, and every cache below would land beside that directory instead:
# a shell in HOME would create ~/.cache/ttsc. That directory is refused.
if [ ! -f "$PWD/tooling/direnv/ttsc-env.sh" ]; then
  echo "ttsc-env.sh: not a workspace root (no tooling/direnv/ttsc-env.sh): $PWD; source it from the checkout root" >&2
  return 1
fi
# The compiler is always this checkout's own. An inherited cache directory is
# the host's choice and stays (CI points it at a cache shared across runs),
# unless the environment was bound for another workspace: an inherited
# NX_WORKSPACE_ROOT_PATH naming another directory says so, the evidence
# nx-socket-dir.sh drops that workspace's Nx state on. Its ttsc cache is then
# dropped too, and this workspace takes its own. A hook inherits whatever
# environment ran `git`; run from a shell bound to another checkout, every
# commit here compiled ttsc plugins into that checkout's cache, and failed
# outright once that checkout's cache was gone.
smoo_ttsc_checkout="$(pwd -P)"
if [ -n "${NX_WORKSPACE_ROOT_PATH:-}" ] &&
  [ "$(cd "$NX_WORKSPACE_ROOT_PATH" >/dev/null 2>&1 && pwd -P)" != "$smoo_ttsc_checkout" ]; then
  unset TTSC_CACHE_DIR TTSC_GO_CACHE_DIR
fi
unset smoo_ttsc_checkout
if [ -f "$PWD/tooling/direnv/typescript-go.nix" ]; then
  export TTSC_TSGO_BINARY="$PWD/tooling/direnv/.devenv/profile/bin/tsgo"
  if [ ! -x "$TTSC_TSGO_BINARY" ]; then
    echo "ttsc-env.sh: native TypeScript producer is declared, but checkout profile/bin/tsgo is unavailable: $TTSC_TSGO_BINARY" >&2
    return 1
  fi
else
  export TTSC_TSGO_BINARY="$PWD/node_modules/@typescript/native/bin/tsc"
fi
export TTSC_CACHE_DIR="${TTSC_CACHE_DIR:-$PWD/.cache/ttsc}"
export TTSC_GO_CACHE_DIR="${TTSC_GO_CACHE_DIR:-$TTSC_CACHE_DIR/go-build}"
mkdir -p "$TTSC_GO_CACHE_DIR"
