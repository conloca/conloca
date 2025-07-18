#!/usr/bin/env bash
set -euo pipefail

# Go to project root
cd "$DEVENV_ROOT/../.."

# Make sure Biome is executable
chmod +x node_modules/@biomejs/cli-*/biome 2>/dev/null || true

# Install dependencies first so node_modules/.bin tools are available
if [ -n "${CI:-}" ]; then
  bun install --frozen-lockfile || {
    echo "⚠️ Failed to install dependencies with frozen lockfile"
    bun install
    echo "git diff after install:"
    git diff
    exit 1
  }
else
  bun install --no-summary
fi

# Add tooling and node_modules/.bin to PATH
export PATH="$PWD/tooling:$PWD/node_modules/.bin:$PATH"

if [ -z "${CI:-}" ]; then
  # Update package.json with current versions from devenv
  NODE_VERSION=$(node --version | sed 's/v//')
  BUN_VERSION=$(bun --version)
  CURRENT_NODE_ENGINE=$(jq -r '.engines.node // ""' package.json)
  CURRENT_PKG_MANAGER=$(jq -r '.packageManager // ""' package.json)
  CURRENT_TYPES_NODE=$(jq -r '.devDependencies["@types/node"] // ""' package.json)
  EXPECTED_NODE_ENGINE=">=${NODE_VERSION%%.*}.0.0"
  EXPECTED_PKG_MANAGER="bun@$BUN_VERSION"
  EXPECTED_TYPES_NODE="~${NODE_VERSION%%.*}.0.0"

  if [[ "$CURRENT_NODE_ENGINE" != "$EXPECTED_NODE_ENGINE" ]] || [[ "$CURRENT_PKG_MANAGER" != "$EXPECTED_PKG_MANAGER" ]] || [[ "$CURRENT_TYPES_NODE" != "$EXPECTED_TYPES_NODE" ]]; then
    # Update package.json and format with biome (now available via node_modules/.bin)
    jq --arg node "$EXPECTED_NODE_ENGINE" \
      --arg bun "$EXPECTED_PKG_MANAGER" \
      --arg types_node "$EXPECTED_TYPES_NODE" \
      '.engines.node = $node | .packageManager = $bun | .devDependencies["@types/node"] = $types_node' \
      package.json | biome format --stdin-file-path=package.json > package.json.tmp && mv package.json.tmp package.json
  fi
fi

# Apply workspace git configuration
if [ -f "$DEVENV_ROOT/apply-workspace-git-config.sh" ]; then
  "$DEVENV_ROOT/apply-workspace-git-config.sh"
fi

# Done, as this script is sourced from devenv's `enterShell` hook, restore the default pipefail behavior:
set +euo pipefail
