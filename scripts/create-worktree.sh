#!/usr/bin/env bash
set -euo pipefail

# scripts/create-worktree.sh
#
# Create a fresh git worktree seeded with the current working-tree state and the
# environment files needed to run the full Arbesk test stack (unit/API/contracts/E2E).
#
# Usage:
#   ./scripts/create-worktree.sh <name>
#
# Example:
#   ./scripts/create-worktree.sh feature-xyz
#
# The worktree is created under .worktrees/<name>. It receives:
#   - all modified tracked files from the main checkout
#   - all untracked (but not gitignored) files from the main checkout
#   - the real root .env and blockchain/.env
#   - IPFS_BACKEND forced to kubo (local E2E requires the Kubo gateway/Qm CIDs)
#   - symlinks to the main checkout's node_modules trees (no re-install)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

NAME="${1:-}"
if [ -z "${NAME}" ]; then
  echo "Usage: $0 <worktree-name>"
  echo "Example: $0 feature-xyz"
  exit 1
fi

WORKTREE_DIR=".worktrees/${NAME}"
WORKTREE_PATH="${PROJECT_ROOT}/${WORKTREE_DIR}"

if [ -e "${WORKTREE_PATH}" ]; then
  echo "❌ Worktree path already exists: ${WORKTREE_PATH}"
  exit 1
fi

echo "═══════════════════════════════════════════"
echo "  Creating Arbesk worktree: ${NAME}"
echo "═══════════════════════════════════════════"
echo ""

# ─── 1. Create the git worktree ───────────────────────────────────────────────
echo "📁 Creating git worktree at ${WORKTREE_DIR}..."
git worktree add --detach "${WORKTREE_DIR}" HEAD

# ─── 2. Copy current working-tree changes into the worktree ───────────────────
# Modified tracked files
mapfile -t MODIFIED < <(git diff --name-only)
if [ ${#MODIFIED[@]} -gt 0 ]; then
  echo "📝 Copying ${#MODIFIED[@]} modified tracked file(s)..."
  for f in "${MODIFIED[@]}"; do
    if [ -f "${f}" ]; then
      mkdir -p "${WORKTREE_PATH}/$(dirname "${f}")"
      cp "${f}" "${WORKTREE_PATH}/${f}"
    fi
  done
fi

# Untracked (but not ignored) files — useful for new E2E specs, helpers, etc.
mapfile -t UNTRACKED < <(git ls-files --others --exclude-standard)
if [ ${#UNTRACKED[@]} -gt 0 ]; then
  echo "📝 Copying ${#UNTRACKED[@]} untracked file(s)..."
  for f in "${UNTRACKED[@]}"; do
    if [ -f "${f}" ]; then
      mkdir -p "${WORKTREE_PATH}/$(dirname "${f}")"
      cp "${f}" "${WORKTREE_PATH}/${f}"
    fi
  done
fi

# ─── 3. Seed environment files ────────────────────────────────────────────────
echo "🔐 Copying environment files..."
if [ -f ".env" ]; then
  cp ".env" "${WORKTREE_PATH}/.env"
else
  echo "⚠️  No root .env found; tests may fail without secrets/keys."
fi

if [ -f "blockchain/.env" ]; then
  cp "blockchain/.env" "${WORKTREE_PATH}/blockchain/.env"
else
  echo "⚠️  No blockchain/.env found."
fi

# E2E expects the local Kubo node; Pinata produces CIDv1 which breaks the Qm... assertions.
if [ -f "${WORKTREE_PATH}/.env" ]; then
  sed -i 's/^IPFS_BACKEND=.*/IPFS_BACKEND=kubo/' "${WORKTREE_PATH}/.env"
  echo "✅ Set IPFS_BACKEND=kubo in worktree .env"
fi

# ─── 4. Symlink node_modules to avoid re-installing ───────────────────────────
echo "🔗 Symlinking node_modules..."
for modules_dir in node_modules frontend/node_modules blockchain/node_modules; do
  if [ -d "${modules_dir}" ] && [ ! -e "${WORKTREE_PATH}/${modules_dir}" ]; then
    ln -s "${PROJECT_ROOT}/${modules_dir}" "${WORKTREE_PATH}/${modules_dir}"
    echo "   ${modules_dir} → main checkout"
  fi
done

# ─── 5. Build frontend and compile contracts (prerequisites for test:frontend) ──
echo ""
echo "🔨 Building frontend..."
(cd "${WORKTREE_PATH}" && npm run build:frontend)

COMPOSE_PROJECT="$(cd "${WORKTREE_PATH}" && ./scripts/start-dev-local.sh --print-project)"

echo "🔨 Compiling Solidity contracts..."
docker compose -p "${COMPOSE_PROJECT}" run --rm hardhat npx hardhat compile

# ─── 6. Report worktree identity ──────────────────────────────────────────────
BACKEND_PORT="$(cd "${WORKTREE_PATH}" && node -e "import('./e2e/lib/infra.mjs').then(m => console.log(m.BACKEND_PORT))")"

echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ Worktree ready: ${WORKTREE_DIR}"
echo "═══════════════════════════════════════════"
echo ""
echo "   Path:        ${WORKTREE_PATH}"
echo "   Compose:     ${COMPOSE_PROJECT}"
echo "   Backend:     http://127.0.0.1:${BACKEND_PORT}"
echo ""
echo "Next steps:"
echo "   cd ${WORKTREE_DIR}"
echo "   npm run test:frontend && npm run test:api"
echo "   COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT} npm run test:contracts"
echo "   npm run test:e2e -- --project=chromium"
echo ""
