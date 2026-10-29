# Managed by `smoo monorepo`. Sourced by devenv.smoo.nix's enterShell prologue
# (bash) on every platform, naming the cc-rs compiler variables the shell's
# own `env` declares:
#
#   . "$DEVENV_ROOT/compiler-variables.sh" CC_x86_64_unknown_linux_gnu ...
#
# cc-rs's compiler variables are this shell's: the ones it declares and no
# others. They are the per-target CC_<target>, CXX_<target>, AR_<target> and
# RANLIB_<target> (either spelling of the target), HOST_ and TARGET_ forms of
# each, and CFLAGS, CXXFLAGS, ARFLAGS and RANLIBFLAGS in every one of those
# forms and generic. cc-rs looks a compiler up through them in that order and
# declares rerun-if-env-changed on each name it looks up, so a value is part of
# that build script's run and of every unit that depends on its package. One a
# caller's environment carries in (an agent started in another checkout's
# devenv shell exports Apple's clang as CC_aarch64_apple_darwin) reruns every
# such script, and rebuilds everything above it, against a target main's land
# built without it (specs/cowshed/16_build_volumes.md, "One Cargo environment
# on every path"). Each inherited one is dropped, and each drop is announced. A
# deliberate value belongs in the shell's `env`, or in .envrc-local, which
# direnv sources after this shell.
#
# The generic tool names stay where they are: on Linux the stdenv sets CC, CXX,
# AR and RANLIB, and on Darwin apple-developer.sh drops CC and CXX.
smoo_compiler_declared=" $* "
for smoo_compiler_name in ${!CC_@} ${!CXX_@} ${!AR_@} ${!RANLIB_@} ${!CFLAGS@} ${!CXXFLAGS@} ${!ARFLAGS@} ${!RANLIBFLAGS@} ${!HOST_@} ${!TARGET_@}; do
  # A target names a lowercase architecture; CC_ENABLE_DEBUG_OUTPUT and its
  # kind are cc-rs settings, not compilers.
  case "$smoo_compiler_name" in
    CC_[[:lower:]]* | CXX_[[:lower:]]* | AR_[[:lower:]]* | RANLIB_[[:lower:]]*) ;;
    CFLAGS | CXXFLAGS | ARFLAGS | RANLIBFLAGS) ;;
    CFLAGS_[[:lower:]]* | CXXFLAGS_[[:lower:]]* | ARFLAGS_[[:lower:]]* | RANLIBFLAGS_[[:lower:]]*) ;;
    HOST_CC | HOST_CXX | HOST_AR | HOST_RANLIB | HOST_CFLAGS | HOST_CXXFLAGS | HOST_ARFLAGS | HOST_RANLIBFLAGS) ;;
    TARGET_CC | TARGET_CXX | TARGET_AR | TARGET_RANLIB | TARGET_CFLAGS | TARGET_CXXFLAGS | TARGET_ARFLAGS | TARGET_RANLIBFLAGS) ;;
    *) continue ;;
  esac
  case "$smoo_compiler_declared" in
    *" $smoo_compiler_name "*) continue ;;
  esac
  echo "devenv: dropping inherited $smoo_compiler_name (${!smoo_compiler_name}); this shell declares cc-rs's compiler variables" >&2
  unset "$smoo_compiler_name"
done
unset smoo_compiler_declared smoo_compiler_name
