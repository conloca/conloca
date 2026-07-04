#!/usr/bin/env bash
set -e

# Check if we have both tsconfig files
if [ -f "tsconfig.lib.json" ] && [ -f "tsconfig.spec.json" ]; then
  # If we have both, use --build to check both
  echo "Using tsconfig.lib.json and tsconfig.spec.json"
  tsc --build tsconfig.lib.json tsconfig.spec.json
  TYPECHECK_RESULT=$?
elif [ -f "tsconfig.lib.json" ]; then
  # Otherwise create a temporary tsconfig for tests
  trap 'rm -f tsconfig.spec.json' EXIT
  cat > tsconfig.spec.json << EOF
{
  "extends": "./tsconfig.lib.json",
  "compilerOptions": {
    "composite": false,
    "declaration": false,
    "declarationMap": false,
    "noEmit": true,
    "types": ["node", "bun"],
    "noUnusedLocals": false,
    "noUnusedParameters": false
  },
  "include": ["src/**/*.ts"],
  "exclude": []
}
EOF
  tsc --build tsconfig.lib.json tsconfig.spec.json
  TYPECHECK_RESULT=$?
else
  # Fallback to just tsc with all files
  echo "No tsconfig.lib.json found, using default TypeScript settings"
  tsc --noEmit src/**/*.ts
  TYPECHECK_RESULT=$?
fi

if [ $TYPECHECK_RESULT -ne 0 ]; then
  echo "Type checking failed"
  exit $TYPECHECK_RESULT
fi

# Run tests
bun test "$@"