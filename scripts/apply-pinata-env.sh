#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Load Pinata credentials from .env.pinata (project-specific format)
set -a
source .env.pinata
set +a

: "${GATEWAY:?GATEWAY not set in .env.pinata}"
: "${JWT:?JWT not set in .env.pinata}"

# Ensure .env exists
[ -f .env ] || cp .env.example .env

# Update or append Pinata settings in .env
update_env() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    echo "${key}=${value}" >> .env
  fi
}

update_env IPFS_BACKEND pinata
update_env PINATA_JWT "$JWT"
update_env PINATA_GATEWAY "$GATEWAY"
update_env IPFS_GATEWAY_URL "https://${GATEWAY}/ipfs/"

echo "Applied Pinata config from .env.pinata (backend=pinata gateway=${GATEWAY})"
