#!/usr/bin/env bash

# Bootstrap script for felddy/foundryvtt CONTAINER_PATCH_URLS
# - Downloads a versioned release asset from GitHub
# - Installs into /data/container_patches
# - Runs header-auth.sh once during install

set -euo pipefail

BOOTSTRAP_REPO="brstm/foundry-vtt-header-auth"
BOOTSTRAP_VERSION="${HEADER_AUTH_VERSION:-13.350}"
BOOTSTRAP_ASSET="header-auth.tar.gz"
# Allow overriding destination for testing by setting DEST_DIR
DEST_DIR="${DEST_DIR:-/data/container_patches}"

log() { echo "[bootstrap header-auth] $*"; }

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

ASSET_URL="https://github.com/${BOOTSTRAP_REPO}/releases/download/${BOOTSTRAP_VERSION}/${BOOTSTRAP_ASSET}"
log "fetching ${ASSET_URL}"

curl -fsSL -o "$tmpdir/$BOOTSTRAP_ASSET" -L "$ASSET_URL"
mkdir -p "$tmpdir/pkg"
tar -xzf "$tmpdir/$BOOTSTRAP_ASSET" -C "$tmpdir/pkg"

mkdir -p "$DEST_DIR/header-auth"
cp -f "$tmpdir/pkg/header-auth.sh" "$DEST_DIR/"
cp -rf "$tmpdir/pkg/header-auth/"* "$DEST_DIR/header-auth/"

chmod +x "$DEST_DIR/header-auth.sh"
log "installed to $DEST_DIR; executing header-auth.sh"

"$DEST_DIR/header-auth.sh"

log "done"
