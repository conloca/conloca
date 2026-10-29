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
# keys when the caller's root is another workspace (WORKSPACE_STATE_ENV_KEYS).
#
# The root is not the only evidence: an environment can carry another
# workspace's absolute overrides with no root at all, or with a root a
# launcher rebound to this checkout (an agent session that came from main's
# shell, through `cowshed exec --host`, kept main's cache and task database
# and wrote into main's .nx). An override whose path lies inside an Nx
# workspace, the nearest nx.json at or above it, other than this checkout
# belongs to that workspace, and the whole set goes with it: the cache moves
# with the database. An override inside this checkout, inside its build
# volume, or inside no workspace at all (CI's shared bind) is the caller's
# own and stays.
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
# the link when cowshed has not yet, exactly as cowshed would.
#
# In a cowshed workspace (.cowshed/workspace.json marks one) that link is the
# only socket dir, and anything else fails (cowshed specs/cowshed/04_sandbox.md):
# a .cowshed/env that names no link is a workspace its supervisor never served
# (an interrupted fork leaves one, still linking its source's build volume), and
# a link that leads elsewhere is another checkout's. Either is refused, and the
# link is left alone; a socket dir of the shell's own would be a second daemon.
#
# Outside cowshed, a socket dir that already resolves inside this checkout is
# the caller's binding for it and stays. An inherited one that resolves
# elsewhere belongs to another workspace, so the workspace takes its own.
smoo_nx_checkout="$(pwd -P)"
smoo_nx_foreign=
if [ -n "${NX_WORKSPACE_ROOT_PATH:-}" ] &&
  [ "$(cd "$NX_WORKSPACE_ROOT_PATH" >/dev/null 2>&1 && pwd -P)" != "$smoo_nx_checkout" ]; then
  smoo_nx_foreign=1
fi
for smoo_nx_state in "${NX_WORKSPACE_DATA_DIRECTORY:-}" "${NX_CACHE_DIRECTORY:-}" "${NX_DAEMON_SOCKET_DIR:-}"; do
  case "$smoo_nx_state" in
    /*) ;;
    *) continue ;;
  esac
  while [ -n "$smoo_nx_state" ] && [ ! -f "$smoo_nx_state/nx.json" ]; do
    smoo_nx_state="${smoo_nx_state%/*}"
  done
  if [ -n "$smoo_nx_state" ] &&
    [ "$(cd "$smoo_nx_state" >/dev/null 2>&1 && pwd -P)" != "$smoo_nx_checkout" ]; then
    smoo_nx_foreign=1
  fi
done
if [ -n "$smoo_nx_foreign" ]; then
  unset NX_WORKSPACE_DATA_DIRECTORY NX_CACHE_DIRECTORY NX_DAEMON_SOCKET_DIR
fi
unset smoo_nx_foreign smoo_nx_state
export NX_WORKSPACE_ROOT_PATH="$PWD"
smoo_nx_socket=""
if [ -f .cowshed/workspace.json ]; then
  smoo_nx_link=""
  if [ -f .cowshed/env ]; then
    smoo_nx_link="$(sed -n 's/^export COWSHED_RUNTIME_LINK=\(\/[A-Za-z0-9._\/-]*\)$/\1/p' .cowshed/env)"
  fi
  if [ -z "$smoo_nx_link" ]; then
    echo "devenv: $smoo_nx_checkout/.cowshed/env names no COWSHED_RUNTIME_LINK: cowshed has not served this workspace, so Nx here has no socket dir; tooling/direnv/repo-path names the workspace and its next step" >&2
    unset smoo_nx_checkout smoo_nx_socket smoo_nx_link
    return 1
  fi
  smoo_nx_run="$(cd "$smoo_nx_checkout/.cowshed/run" && pwd -P)" || return $?
  if [ ! -e "$smoo_nx_link" ] && [ ! -L "$smoo_nx_link" ]; then
    ln -s "$smoo_nx_run" "$smoo_nx_link"
  fi
  if [ "$(cd "$smoo_nx_link" >/dev/null 2>&1 && pwd -P)" != "$smoo_nx_run" ]; then
    echo "devenv: $smoo_nx_link does not lead to this checkout's $smoo_nx_run; Nx here cannot reach the workspace's sandboxed daemon" >&2
    unset smoo_nx_checkout smoo_nx_socket smoo_nx_link smoo_nx_run
    return 1
  fi
  smoo_nx_socket="$smoo_nx_link/nx"
  unset smoo_nx_run
else
  case "$(cd "${NX_SOCKET_DIR:-/nonexistent}" >/dev/null 2>&1 && pwd -P)/" in
    "$smoo_nx_checkout"/*) smoo_nx_socket="$NX_SOCKET_DIR" ;;
    *) smoo_nx_socket="$DEVENV_RUNTIME/nx-$(printf '%s' "$smoo_nx_checkout" | cksum | cut -d' ' -f1)" ;;
  esac
fi
export NX_SOCKET_DIR="$smoo_nx_socket"
mkdir -p "$NX_SOCKET_DIR" || return $?
unset smoo_nx_checkout smoo_nx_socket smoo_nx_link
