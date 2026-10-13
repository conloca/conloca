#!/usr/bin/env bash
# macOS-only Linux cross-compile gate. This hook is a cache PROBE and nothing
# else: it reads the nx cache and never compiles. A hit means a real
# `cargo clippy --target x86_64-unknown-linux-gnu` already passed for exactly
# this tree, so the push is safe with no toolchain present. Anything else
# refuses the push and names the one command that fixes it.
#
# Why probe-only. The cross-clippy needs the linux-cross C toolchain, which
# lives in a devenv profile. A hook that entered that profile spent minutes
# compiling on a push the user expected to take a second, and it did so in an
# environment they never asked for. Pushing is not the place to discover that
# the tree has not been compiled for Linux; `bun run check:linux` is.
#
# CC_x86_64_unknown_linux_gnu is unset for the probe deliberately. The target's
# own guard reads it to decide whether the toolchain is present, so leaving it
# set would let a push made from inside an already-entered linux-cross shell
# fall through into a real multi-minute compile. It is not a declared input of
# the target, so unsetting it cannot change the task hash — a warm entry still
# hits.
#
# Everything in tooling depends only on devenv.nix packages, so this hook also
# works with no devenv on PATH. It must never pretend a check ran that did not.

cd "$(git rev-parse --show-toplevel)"
TOOLING="$PWD/tooling"

export PATH="$("$TOOLING/direnv/repo-path")"
# ttsc compiles with the native TypeScript compiler, which the dev shell names in
# TTSC_TSGO_BINARY. A hook runs outside that shell, where ttsc would resolve the
# JavaScript compiler a package's `typescript` dependency names and refuse to run.
if [ -z "${TTSC_TSGO_BINARY:-}" ] && [ -x "$PWD/node_modules/@typescript/native/bin/tsc" ]; then
  export TTSC_TSGO_BINARY="$PWD/node_modules/@typescript/native/bin/tsc"
fi

case "$(uname -s)" in
  Darwin) ;;
  *) exit 0 ;;
esac

if env -u CC_x86_64_unknown_linux_gnu nx run-many -t cargo-lint-cross --output-style=static; then
  exit 0
fi

cat >&2 <<'EOF'

pre-push: the Linux cross-compile check is NOT cached for this tree, so this
push would ship code that has never been compiled for Linux. This hook only
reads the cache; it does not build. The "needs the linux-cross C toolchain"
line above is the probe refusing to compile, not a broken toolchain.

  Run:  bun run check:linux
  Wait for it to pass, then push again.
EOF
exit 1
