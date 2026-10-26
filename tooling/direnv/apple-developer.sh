# Managed by `smoo monorepo`. Sourced on Darwin by devenv.smoo.nix's enterShell
# prologue, naming the Nix store:
#
#   . "$DEVENV_ROOT/apple-developer.sh" /nix/store
#
# Xcode answers for the Apple toolchain in this shell: its clang, its licensed
# macOS SDK and its xcrun. A Nix stand-in for any of them is dropped, and each
# drop is announced, so a shell never silently swaps what a build compiles and
# links against. Only a value inside the store is dropped: an SDKROOT the
# operator exported deliberately (the documented way to link Darwin from a
# Linux host), or an xcrun the operator installed into a profile, stays exactly
# as given.
#
# CC/CXX go so xcodebuild finds Xcode's clang (it supports -index-store-path);
# bun/node native addons find compilers through node-gyp. CC/CXX are what
# xcodebuild reads, which is why they go rather than being pointed somewhere
# else.
#
# The Apple SDK is the same boundary, and dropping CC/CXX alone does not hold
# it. An outer nix stdenv exports SDKROOT and DEVELOPER_DIR pointing at
# nixpkgs' RECONSTRUCTED apple-sdk, so Xcode's own clang goes on to compile
# against that sysroot. It is not a substitute for the licensed SDK:
# apple-sdk-14.4 carries usr/include and the frameworks but NO libc++
# whatsoever — no usr/include/c++/v1 and no usr/lib/libc++* — so any C++ build
# script that resolves the SDK by name dies at `ld: library 'c++' not found`,
# which a CMake `*-sys` crate reaches before compiling a line of the project.
# DEVELOPER_DIR is the half that hides: `xcrun --show-sdk-path` honours it, so
# even code that correctly asks xcrun for the SDK is handed the nix one, while
# `xcrun --find clang` and `xcodebuild -version` keep reporting Xcode and look
# healthy. It also defeats any later guard that unsets a nix SDKROOT and then
# re-resolves it through xcrun, because xcrun answers with the same tree again.
#
# xcrun itself is the last half. The same outer shell (an ancestor directory's
# devenv, a `nix develop`, anything with nixpkgs' apple-sdk in scope) leaves
# xcbuild's reimplementation of xcrun on PATH ahead of /usr/bin. With the nix
# DEVELOPER_DIR gone it has no developer directory to read and answers `xcrun
# --sdk macosx --show-sdk-path` with "unable to find sdk: 'macosx'": rustc
# warns at every link, and a build script that asks xcrun for the SDK fails.
# Exporting DEVELOPER_DIR=$(xcode-select -p) does not repair it: it then finds
# the SDK, but prints eighteen "unhandled Platform key" warnings on every call
# and names the unversioned MacOSX.sdk link where Apple's xcrun names
# MacOSX<version>.sdk (measured, Xcode 26.5). So a store directory holding an
# xcrun leaves the shell's PATH, and `xcrun` is Apple's /usr/bin/xcrun, which
# follows `xcode-select` the moment it changes. A store PATH entry is a single
# package's bin — nixpkgs propagates xcbuild's xcrun-only output — so nothing
# else leaves with it. A profile (devenv's, the user's, the system's) is a link
# outside the store and is never dropped. devenv's direnv integration appends
# every caller PATH entry the shell no longer holds after the shell's own PATH,
# so under direnv the dropped directory comes back behind /usr/bin, where its
# xcrun is never the one that answers.
smoo_apple_store="$1"
unset CC CXX
case "${SDKROOT:-}" in
  "$smoo_apple_store"/*)
    echo "devenv: dropping nix-store SDKROOT ($SDKROOT); Xcode holds the licensed macOS SDK" >&2
    unset SDKROOT NIX_APPLE_SDK_VERSION
    ;;
esac
case "${DEVELOPER_DIR:-}" in
  "$smoo_apple_store"/*)
    echo "devenv: dropping nix-store DEVELOPER_DIR ($DEVELOPER_DIR); xcrun must answer from Xcode" >&2
    unset DEVELOPER_DIR NIX_APPLE_SDK_VERSION
    ;;
esac
# Walk PATH entry by entry, keeping empty entries (the current directory) in
# place: each kept entry is appended after a ':' and the first one is stripped.
smoo_apple_path=""
smoo_apple_rest="$PATH:"
while [ -n "$smoo_apple_rest" ]; do
  smoo_apple_entry="${smoo_apple_rest%%:*}"
  smoo_apple_rest="${smoo_apple_rest#*:}"
  case "$smoo_apple_entry" in
    "$smoo_apple_store"/*)
      if [ -x "$smoo_apple_entry/xcrun" ]; then
        echo "devenv: dropping nix-store $smoo_apple_entry from PATH; xcrun must answer from Xcode" >&2
        continue
      fi
      ;;
  esac
  smoo_apple_path="$smoo_apple_path:$smoo_apple_entry"
done
export PATH="${smoo_apple_path#:}"
unset smoo_apple_store smoo_apple_path smoo_apple_rest smoo_apple_entry
