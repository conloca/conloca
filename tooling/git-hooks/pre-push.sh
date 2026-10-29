#!/usr/bin/env bash
# Two gates, in order.
#
# 1. On every OS, the public denylist: every commit this push publishes is
# refused if its tree, or the message of any commit the remote does not hold
# yet, matches a pattern from this clone's local `smoothbricks.publicDenylist`
# git config (or SMOOTHBRICKS_PUBLIC_DENYLIST). The patterns live outside the
# repository so the guard never publishes what it guards; with none
# configured the check passes silently.
#
# 2. The macOS-only Linux cross-compile gate. It asks Nx for cargo-lint-cross,
# whose hit means a real `cargo-zigbuild clippy --target x86_64-unknown-linux-gnu`
# already passed for exactly this tree, so the push is safe with no toolchain
# present. From a plain shell the cross target itself never compiles here: on
# a miss its guard refuses. Its dependencies are ordinary Nx tasks whose outputs
# the cross key reads, so Nx restores them from the cache or, for a tree no gate
# ran, builds them. A refusal names the one command that fixes it; any other
# failure is said as that, never as a cache miss.
#
# Nx runs in this checkout's environment, `direnv exec <checkout>`, which is the
# environment the land gate runs in, never in the environment of whatever shell
# ran `git push`. devenv declares this checkout's tooling and the environment it
# builds with (the macOS SDK it links against among it), and tasks key on that
# environment as well as on the tree: a push from a shell carrying another
# directory's devenv keyed the gate's tasks on that shell's SDKROOT and
# DEVELOPER_DIR, missed every one of them, and then built them against the wrong
# SDK. Under the checkout's environment the keys are the gate's, and a dependency
# that does miss builds the way the gate builds it.
#
# Why the cross target never compiles here. The cross-clippy needs zig and
# cargo-zigbuild, which a macOS host carries only in the linux-cross devenv
# profile, not in the default shell `direnv exec` enters. A hook that entered
# that profile spent minutes compiling on a push the user expected to take a
# second. Pushing is not the place to discover that the tree has not been
# compiled for Linux: the land gate, or `bun run check:linux`, is.
#
# The target's own guard refuses to start when cargo-zigbuild is not on PATH,
# which is what turns a miss into a refusal here. A push made from a shell that
# already carries cargo-zigbuild — an entered linux-cross shell — passes that
# guard, so there a miss runs the check itself: the same clippy `check:linux`
# runs, in the toolchain the user entered for it.
#
# The denylist gate needs only tooling/direnv/repo-path's PATH; the cross gate
# needs direnv on the caller's PATH, and the checkout's own devenv through it,
# not a devenv the caller entered. It must never pretend a check ran that did not.

cd "$(git rev-parse --show-toplevel)"
TOOLING="$PWD/tooling"
# A push to the `backup` remote is a private mirror, not publication: both
# gates below guard publication only, so they do not apply.
if [ "${1:-}" = backup ]; then exit 0; fi

# A bare assignment, not `export PATH=$(…)`: export's status would hide repo-path's refusal of an unserved workspace.
PATH="$("$TOOLING/direnv/repo-path")" || exit $?
# ttsc compiles with this checkout's native TypeScript compiler into this
# checkout's plugin cache, which the dev shell names. A hook runs outside that
# shell, in whatever environment ran `git`; ttsc-env.sh names them the same way.
. "$TOOLING/direnv/ttsc-env.sh"

# git hands a pre-push hook the remote's name as $1 and one
# `<local ref> <local sha> <remote ref> <remote sha>` line per ref it updates;
# an all-zero local sha is a deletion, which publishes no tree. The pushed shas
# are the tips to judge; --remote narrows the commit messages judged to those
# the remote's tracking branches do not already hold, so history that is
# already public is not judged again on every push.
pushed=()
while read -r _local_ref local_sha _remote_ref _remote_sha; do
  case "$local_sha" in
    *[!0]*) pushed+=("$local_sha") ;;
  esac
done
if [ "${#pushed[@]}" -gt 0 ]; then
  smoo monorepo check-public-denylist --remote "$1" "${pushed[@]}" || {
    echo 'pre-push: rewrite a refused commit message in place with tooling/git-reword-commit <commit> (the new message on stdin), then push again' >&2
    exit 1
  }
fi

case "$(uname -s)" in
  Darwin) ;;
  *) exit 0 ;;
esac

# The refusal uses shell builtins alone: without direnv nothing proves the
# caller's PATH carries coreutils, and a Nix-built host's /usr/bin and /bin
# hold none of them.
if ! command -v direnv >/dev/null; then
  printf '%s\n' \
    'pre-push: direnv is not on PATH, so the Linux cross-compile check cannot run in' \
    "this checkout's environment, and a check run in any other environment keys on" \
    'values the land gate never used. Put direnv on PATH, then push again.' >&2
  exit 1
fi

# The guard's refusal (nx-plugin cross-check-policy.ts CARGO_CROSS_LINT_REFUSAL)
# is the one line that means the key missed. Nx exits 1 for every task failure,
# so the hook reads the output for it rather than guessing from the status.
output=$(mktemp "${TMPDIR:-/tmp}/pre-push-cross.XXXXXX") || exit 1
trap 'rm -f "$output"' EXIT
set -o pipefail
direnv exec "$PWD" nx run-many -t cargo-lint-cross --output-style=static 2>&1 | tee "$output"
status=$?
[ "$status" -eq 0 ] && exit 0

if grep -qF 'cargo-lint-cross needs cargo-zigbuild from the linux-cross toolchain; run: bun run check:linux' "$output"; then
  cat >&2 <<'EOF'

pre-push: the Linux cross-compile check is NOT cached for this tree, so this
push would ship code that has never been compiled for Linux. The "needs
cargo-zigbuild" line above is the cross target refusing to compile here, not a
broken toolchain.

  Run:  bun run check:linux
  Wait for it to pass, then push again.
EOF
else
  cat >&2 <<EOF

pre-push: the Linux cross-compile check failed (exit $status) before it reached
a cache verdict, in Nx or in direnv entering this checkout's environment; the
output above names why. This is not a cache miss, and bun run check:linux will
not fix it.
EOF
fi
exit 1
