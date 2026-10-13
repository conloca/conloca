#!/usr/bin/env bash
# Restore the index for the paths the commit just wrote.
#
# `git commit --only -- <paths>` — the form used whenever paths are named, and
# the one a shared worktree requires so a commit cannot sweep in a peer's
# staged work — is a PARTIAL commit, and git builds it from two different index
# files. It stages the worktree content of the named paths into the real index,
# locks it, and then hands the pre-commit hook a separate throwaway index which
# is what becomes the commit. So when the pre-commit formatter rewrites
# content, the rewrite reaches the commit and the worktree file, while the real
# index keeps the pre-format blob: an entry that matches neither HEAD nor the
# file on disk. `git diff HEAD` is then empty while `git diff --cached HEAD` is
# not, `git status` reports a path as staged immediately after committing it,
# and the next bare `git commit` sweeps that ghost in under another message.
#
# The formatter cannot repair this from pre-commit. While a pre-commit hook
# runs, the real index is locked — .git/index.lock exists and git renames it
# into place after the commit — so no hook can write it. Measured, not assumed:
# `git add` there fails with "Unable to create .git/index.lock: File exists",
# and formatting the worktree instead of the index only makes it worse, because
# the throwaway index was snapshotted before the hook started and would carry
# unformatted bytes into the commit. post-commit is the first point where the
# lock is gone; git even points GIT_INDEX_FILE at the real index for it.
#
# The repair is an invariant, not a heuristic: for every path this commit wrote,
# the index must equal the commit. Restricting it to those paths is what makes
# it safe in a shared worktree. A peer's staged work on any other path is never
# considered, and for the committed paths git itself already replaced the index
# entry with the worktree snapshot, so no staged intent is left there to lose.
# The one race is a peer running `git add` on a path this commit wrote in the
# moment between git unlocking the index and this hook running; it costs them a
# repeated `git add`, never file content, which is never touched here.
#
# That restriction has one measured edge: if the formatter reduces a staged
# change to what HEAD already holds, the commit writes no path at all, so the
# pre-format entry stays until the next commit that does write that path. The
# alternative — repairing any entry that matches neither HEAD nor the file on
# disk — is refused on purpose: that is also the shape of `git add -p` staging
# and of a deliberate `git rm --cached`, and no formatter ghost is worth
# deleting either of those.
#
# Needs nothing but git, so it does not enter the devenv profile.

cd "$(git rev-parse --show-toplevel)"

set -e -o pipefail

paths="$(mktemp)"
trap 'rm -f "$paths"' EXIT

# The paths this commit wrote, NUL-delimited so no path can be misread. A merge
# commit prints nothing (no single-parent diff), which is right: git refuses a
# partial commit during a merge, so there is nothing to repair. --root makes an
# initial commit list its paths instead of none.
git diff-tree -r -z --no-commit-id --name-only --root HEAD >"$paths"
[ -s "$paths" ] || exit 0

# Report before repairing, and only when there is something to report: a
# silently mutated index is the thing this hook exists to stop.
stale="$(xargs -0 git diff --cached --name-only HEAD -- <"$paths")"
[ -n "$stale" ] || exit 0

{
  echo "post-commit: index entries do not match the commit just made; restoring them from HEAD:"
  echo "$stale" | sed 's/^/  /'
} >&2

# Reset the whole committed set, not just the entries named above: it is one
# index write either way, and for exactly those paths HEAD is by definition
# what the index should hold. This never touches the working tree.
git reset -q --pathspec-from-file="$paths" --pathspec-file-nul
