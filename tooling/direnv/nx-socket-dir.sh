# Managed by `smoo monorepo`. Sourced by devenv.smoo.nix's enterShell prologue
# from the workspace root:
#
#   . "$DEVENV_ROOT/nx-socket-dir.sh"
#
# Exports NX_WORKSPACE_ROOT_PATH and NX_SOCKET_DIR for this Nx workspace, and
# drops the Nx state overrides another workspace's shell left behind.
#
# An inherited NX_WORKSPACE_ROOT_PATH that names another directory says the
# environment was bound for that workspace, and so were its Nx state
# overrides: NX_WORKSPACE_DATA_DIRECTORY, NX_CACHE_DIRECTORY and
# NX_DAEMON_SOCKET_DIR. They are absolute, so a repository shell that keeps
# an inherited absolute value (CI binds a shared tree that way) kept that
# workspace's, and every Nx here opened its task database and cache. A
# cowshed fork entered from a shell that had been in main's checkout did
# exactly that: its Nx held main's database on main's build volume, and the
# next land into main could not adopt. The smoo Nx wrappers drop the same
# keys on the same evidence (WORKSPACE_STATE_ENV_KEYS). An override
# inherited without a root, or with this root, is the caller's own and stays.
#
# One socket dir per Nx workspace. DEVENV_RUNTIME is keyed to the devenv ROOT,
# so every workspace sharing one devenv - a sibling repository, a
# copy-on-write clone, a scratch workspace created inside this shell - would
# land on one socket. The first daemon to claim it then refuses every message
# from the others ("received a message from a different workspace"), which
# reads as a hung Nx in a workspace that did nothing wrong.
#
# In a cowshed checkout, host shells, sandboxed jobs and land checks share the
# checkout's one Nx daemon record (cowshed specs/cowshed/04_sandbox.md), and
# the daemon that record names may run inside the sandbox. Every one of them
# must name the same socket dir, as the same literal path:
# - Nx's daemon adopts the environment of each client that connects, so its
#   plugin workers bind their sockets under the client's NX_SOCKET_DIR.
# - The sandbox admits Unix sockets by literal path. It grants the `nx` leaf of
#   <checkout>/.cowshed/run under the name cowshed hands its jobs,
#   <runtime link>/nx, and refuses the same leaf reached through any other
#   link: the worker's socket gets EPERM and its plugin fails to load.
# So a host shell takes cowshed's own short link. A checkout path is too long
# for the plugin workers' sockets ("exceeds the maximum socket length"), and
# Nx refuses a symlinked leaf, so only the parent is a link. Cowshed names the
# link after the checkout's mount and writes it as COWSHED_RUNTIME_LINK into
# the checkout's .cowshed/env at every supervisor start; the shell reads it
# from there, never re-deriving it, and never from the caller's environment,
# whose COWSHED_RUNTIME_LINK may be another workspace's. A host shell creates
# the link when cowshed has not yet, exactly as cowshed would. A link that
# leads elsewhere is reported and left alone.
#
# Without that link, a socket dir that already resolves inside this checkout
# is cowshed's binding for the job and stays. An inherited one that resolves
# elsewhere belongs to another workspace, so the workspace takes its own.
smoo_nx_checkout="$(pwd -P)"
if [ -n "${NX_WORKSPACE_ROOT_PATH:-}" ] &&
  [ "$(cd "$NX_WORKSPACE_ROOT_PATH" >/dev/null 2>&1 && pwd -P)" != "$smoo_nx_checkout" ]; then
  unset NX_WORKSPACE_DATA_DIRECTORY NX_CACHE_DIRECTORY NX_DAEMON_SOCKET_DIR
fi
export NX_WORKSPACE_ROOT_PATH="$PWD"
smoo_nx_socket=""
smoo_nx_link=""
if [ -d .cowshed/run ] && [ -f .cowshed/env ]; then
  smoo_nx_link="$(sed -n 's/^export COWSHED_RUNTIME_LINK=\(\/[A-Za-z0-9._\/-]*\)$/\1/p' .cowshed/env)"
fi
if [ -n "$smoo_nx_link" ]; then
  smoo_nx_run="$(cd "$smoo_nx_checkout/.cowshed/run" && pwd -P)"
  if [ ! -e "$smoo_nx_link" ] && [ ! -L "$smoo_nx_link" ]; then
    ln -s "$smoo_nx_run" "$smoo_nx_link"
  fi
  if [ "$(cd "$smoo_nx_link" >/dev/null 2>&1 && pwd -P)" = "$smoo_nx_run" ]; then
    smoo_nx_socket="$smoo_nx_link/nx"
  else
    echo "devenv: $smoo_nx_link does not lead to this checkout's $smoo_nx_run; Nx here cannot reach the workspace's sandboxed daemon" >&2
  fi
  unset smoo_nx_run
fi
if [ -z "$smoo_nx_socket" ]; then
  case "$(cd "${NX_SOCKET_DIR:-/nonexistent}" >/dev/null 2>&1 && pwd -P)/" in
    "$smoo_nx_checkout"/*) smoo_nx_socket="$NX_SOCKET_DIR" ;;
    *) smoo_nx_socket="$DEVENV_RUNTIME/nx-$(printf '%s' "$smoo_nx_checkout" | cksum | cut -d' ' -f1)" ;;
  esac
fi
export NX_SOCKET_DIR="$smoo_nx_socket"
mkdir -p "$NX_SOCKET_DIR" || return $?
unset smoo_nx_checkout smoo_nx_socket smoo_nx_link
