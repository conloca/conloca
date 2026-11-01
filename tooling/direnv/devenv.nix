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
  # The shared SmoothBricks shell contract (smoo-managed): Node.js, the Rust and
  # Go toolchains, the cross profile, and the enterShell prologue and epilogue
  # that move to the workspace root, set PATH from tooling/direnv/repo-path, run
  # setup-environment.ts and return to the directory the shell was entered from.
  imports = [./devenv.smoo.nix];

  # https://devenv.sh/overlays/
  overlays = [
    inputs.nixpkgs-overlay.overlays.default
    inputs.rust-overlay.overlays.default
  ];

  # https://devenv.sh/packages/
  # Node.js comes from devenv.smoo.nix (its npm CLI is what npm trusted
  # publishing needs).
  packages = with pkgs; [
    gnutar # Tarball inspection for package validation
    coreutils # Provides fmt for commit message wrapping
    git # Git hooks and repository inspection
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
  # devenv.smoo.nix's prologue and epilogue do the shell entry; this only puts
  # libstdc++ on the loader path, which native Node.js modules (sharp,
  # @parcel/watcher) need on Linux.
  enterShell = ''
    export LD_LIBRARY_PATH="${pkgs.stdenv.cc.cc.lib}/lib''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  '';

  # See full reference at https://devenv.sh/reference/options/
}
