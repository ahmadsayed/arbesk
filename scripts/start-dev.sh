#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

# ─── Worktree isolation ───
# Nostr is the only local container in this mode; keep a stable project name
# per checkout so multiple worktrees do not collide on port 7777.
if [ -z "$COMPOSE_PROJECT_NAME" ]; then
    WORKTREE_BASENAME=$(basename "$PROJECT_ROOT")
    WORKTREE_HASH=$(printf '%s' "$PROJECT_ROOT" | sha256sum | cut -c1-8)
    WORKTREE_ID="${WORKTREE_BASENAME}-${WORKTREE_HASH}"
    WORKTREE_ID_SANITIZED=$(echo "$WORKTREE_ID" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g')
    COMPOSE_PROJECT_NAME="arbesk-${WORKTREE_ID_SANITIZED}"
fi
export COMPOSE_PROJECT_NAME

# Convenience flag for scripts/docs that need the current worktree's project name.
if [ "${1:-}" = "--print-project" ]; then
    echo "$COMPOSE_PROJECT_NAME"
    exit 0
fi

BACKEND_PORT="${PORT:-9090}"

# Docker Compose shorthand scoped to this worktree.
DC="docker compose -p ${COMPOSE_PROJECT_NAME}"

echo "═══════════════════════════════════════════"
echo "  Arbesk Dev Launcher (testnet + Pinata)"
echo "  worktree: ${COMPOSE_PROJECT_NAME}"
echo "  backend port: ${BACKEND_PORT}"
echo "═══════════════════════════════════════════"
echo ""

# ─── 1. Load environment ───
load_env_var() {
    local key="$1"
    local value=""
    if [ -f ".env" ]; then
        value=$(grep "^${key}=" .env | cut -d'=' -f2- | tr -d ' \r' || true)
    fi
    echo "$value"
}

IPFS_BACKEND="${IPFS_BACKEND:-$(load_env_var IPFS_BACKEND)}"
PINATA_JWT="${PINATA_JWT:-$(load_env_var PINATA_JWT)}"
CONTRACT_ADDRESS="${CONTRACT_ADDRESS:-$(load_env_var CONTRACT_ADDRESS)}"
PAID_CONTRACT_ADDRESS="${PAID_CONTRACT_ADDRESS:-$(load_env_var PAID_CONTRACT_ADDRESS)}"
USDC_TOKEN="${USDC_TOKEN:-$(load_env_var USDC_TOKEN)}"
API_URL="${API_URL:-$(load_env_var API_URL)}"

# ─── 2. Validate required configuration ───
MISSING=0

if [ "$IPFS_BACKEND" != "pinata" ]; then
    echo "⚠️  IPFS_BACKEND is '${IPFS_BACKEND:-}'. For testnet dev it should be 'pinata'."
    echo "   Set IPFS_BACKEND=pinata in your root .env, or export it before running this script."
    MISSING=1
fi

if [ -z "$PINATA_JWT" ]; then
    echo "❌ PINATA_JWT is not set. Add it to your root .env or export it."
    MISSING=1
fi

if [ -z "$CONTRACT_ADDRESS" ]; then
    echo "❌ CONTRACT_ADDRESS is not set. Add the Optimism Sepolia free-contract address to your root .env."
    MISSING=1
fi

if [ -z "$PAID_CONTRACT_ADDRESS" ]; then
    echo "❌ PAID_CONTRACT_ADDRESS is not set. Add the Optimism Sepolia paid-contract address to your root .env."
    MISSING=1
fi

if [ -z "$USDC_TOKEN" ]; then
    echo "❌ USDC_TOKEN is not set. Add the Optimism Sepolia USDC address (0x5fd84259d66Cd461235407180D3B4c8d0F273e15) to your root .env."
    MISSING=1
fi

if [ -z "$API_URL" ] || [[ ! "$API_URL" =~ optimism|sepolia ]]; then
    echo "⚠️  API_URL is '${API_URL:-}'. For testnet dev it should point to an Optimism Sepolia RPC."
    echo "   Example: https://sepolia.optimism.io"
fi

if [ "$MISSING" -ne 0 ]; then
    echo ""
    echo "❌ Missing required configuration. Please update your root .env and try again."
    exit 1
fi

echo "✅ Configuration valid for testnet + Pinata mode"
echo "   IPFS backend: pinata"
echo "   Blockchain:   ${API_URL:-(from .env)}"
echo "   Contract:     ${CONTRACT_ADDRESS}"
echo "   Paid contract: ${PAID_CONTRACT_ADDRESS}"
echo "   USDC token:   ${USDC_TOKEN}"
echo ""

# ─── 3. Start only the local Nostr relay ───
start_nostr() {
    if ${DC} ps --services --filter "status=running" 2>/dev/null | grep -qE 'nostr'; then
        echo "✅ Nostr relay already running for ${COMPOSE_PROJECT_NAME}"
        return
    fi

    echo "🐳 Starting local Nostr relay for ${COMPOSE_PROJECT_NAME}..."
    ${DC} up -d nostr
    echo "⏳ Waiting for Nostr relay to boot..."
    for i in {1..30}; do
        if curl -s http://127.0.0.1:7777 >/dev/null 2>&1 || nc -z 127.0.0.1 7777 2>/dev/null; then
            echo "✅ Nostr relay is ready on ws://127.0.0.1:7777"
            break
        fi
        if [ "$i" -eq 30 ]; then
            echo "⚠️  Nostr relay did not become ready in time; continuing anyway"
        fi
        sleep 1
    done
}

start_nostr
echo ""

# ─── 4. Install dependencies ───
if [ ! -d "node_modules" ]; then
    echo "📦 Installing root dependencies..."
    npm install
else
    echo "✅ Root node_modules found"
fi

if [ ! -d "frontend/node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    (cd frontend && npm install)
else
    echo "✅ Frontend node_modules found"
fi

if [ ! -d "blockchain/node_modules" ]; then
    echo "📦 Installing blockchain dependencies (for IDE intellisense)..."
    (cd blockchain && npm install)
else
    echo "✅ Blockchain node_modules found"
fi
echo ""

# ─── 5. Build frontend ───
echo "🔨 Building frontend..."
(cd frontend && npm run build)
echo ""

# ─── 6. Print ready banner ───
echo "═══════════════════════════════════════════"
echo "  🚀 Arbesk testnet stack is ready!"
echo "═══════════════════════════════════════════"
echo ""
echo "   Studio:     http://localhost:${BACKEND_PORT}/studio.html"
echo "   API:        http://localhost:${BACKEND_PORT}/api"
echo "   Nostr:      ws://127.0.0.1:7777"
echo "   Network:    Optimism Sepolia"
echo "   RPC:        ${API_URL}"
echo "   Contract:   ${CONTRACT_ADDRESS}"
echo "   Paid:       ${PAID_CONTRACT_ADDRESS}"
echo "   USDC:       ${USDC_TOKEN}"
echo ""
echo "═══════════════════════════════════════════"
echo ""

if [ "${1:-}" = "--setup-only" ]; then
    echo "✅ Setup complete. Backend not started (--setup-only)."
    exit 0
fi

# ─── 7. Start backend ───
PORT="${BACKEND_PORT}" IPFS_BACKEND=pinata node src/index.js
