#!/usr/bin/env bash
cd "$(dirname "$0")"/direnv/nixpkgs-overlay
nix shell nixpkgs#nvfetcher -c nvfetcher -o _sources
