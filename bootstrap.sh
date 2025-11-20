#!/usr/bin/env bash

set -euo pipefail

REPO="brstm/foundry-vtt-header-auth"
PATCH_NAME="header-auth"

VERSION="${PATCH_VERSION:-latest}"
PACKAGE="${PATCH_NAME}.tar.gz"
PATCH="${PATCH_NAME}.js"

for var in $(compgen -A variable | grep '^PATCH_' || true); do
  export "$var=${!var}"
done

if [ -n "${PATCH_SOURCE_URL:-}" ]; then
  SOURCE_URL="$PATCH_SOURCE_URL"
elif [ "$VERSION" = "latest" ]; then
  SOURCE_URL="https://github.com/${REPO}/releases/latest/download/${PACKAGE}"
else
  SOURCE_URL="https://github.com/${REPO}/releases/download/${VERSION}/${PACKAGE}"
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

curl -fsSL "$SOURCE_URL" | tar -xz -C "$TMP_DIR"

node "${TMP_DIR}/exec.js" "${TMP_DIR}/${PATCH}"
