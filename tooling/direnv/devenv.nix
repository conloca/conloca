# https://devenv.sh/basics/
{
  inputs,
  pkgs,
  lib,
  ...
}:
# https://devenv.sh/inputs/
let
  git-format-staged = inputs.git-format-staged.packages.${pkgs.stdenv.system}.default;
in {
  # https://devenv.sh/overlays/
  overlays = [
    inputs.nixpkgs-overlay.overlays.default
  ];

  # https://devenv.sh/packages/
  packages = with pkgs; [
    gnutar # Tarball inspection for package validation
    coreutils # Provides fmt for commit message wrapping
    git # Git hooks and repository inspection
    # Latest Node.js includes the npm CLI needed for npm trusted publishing.
    nodejs_latest
    # Bun.sh for javascript dependencies
    bun
    # Git hooks and formatters
    git-format-staged
    jq # Used in pre-commit hook and generally useful
    alejandra # Nix formatter
    # C++ standard library for native Node.js modules (@parcel/watcher, etc.)
    stdenv.cc.cc.lib
  ];

  # https://devenv.sh/languages/
  # languages.nix.enable = true;

  # We're not using Devenv's pre-commit-hooks, because this repo's pre-commit hook
  # uses `git-format-staged` to format only the content that is about to be committed.
  # See https://devenv.sh/pre-commit-hooks/ for more details (uses Python pre-commit)

  # https://devenv.sh/processes/
  # processes.ping.exec = "ping example.com";

  # https://devenv.sh/scripts/#entershell
  # This runs when entering the devenv shell
  # - When using the devenv wrapper from tooling/, restore the original working directory
  #   (The wrapper runs devenv from tooling/direnv but we want the shell to start where the user was)

  # Set up PATH first so setup script can find tools
  enterShell = ''
    cd "$DEVENV_ROOT/../.."
    export PATH="$PWD/tooling:$PWD/node_modules/.bin:$PATH"
    # Keep the entrypoint in the worktree so Bun resolves tooling/node_modules.
    # Nix path interpolation copies it to /nix/store, outside the workspace.
    bun "$DEVENV_ROOT/setup-environment.ts"

    if [ -n "$DEVENV_SHELL_PWD" ]; then
      cd "$DEVENV_SHELL_PWD"
    fi
  '';

  # See full reference at https://devenv.sh/reference/options/
}
