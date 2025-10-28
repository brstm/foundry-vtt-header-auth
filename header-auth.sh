#!/usr/bin/env bash

set -euo pipefail

HEADER_AUTH_ID="${HEADER_AUTH_ID:-}"

if [ -z "$HEADER_AUTH_ID" ]; then
  echo "header-auth: HEADER_AUTH_ID not set; skipping patch."
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_RUNNER="$SCRIPT_DIR/header-auth/patch-runner.js"
SERVER_PATCH="${SERVER_PATCH:-$SCRIPT_DIR/header-auth/server-patch.js}"

for file in "$SERVER_PATCH" "$PATCH_RUNNER"; do
  if [[ ! -f "$file" ]]; then
    >&2 echo "header-auth: required file not found: $file"
    exit 1
  fi
done

export HEADER_AUTH_ID

node "$SERVER_PATCH"
