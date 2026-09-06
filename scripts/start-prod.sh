#!/usr/bin/env bash
set -e

# ─── Arbesk Production Launcher ──────────────────────────────────────────────
# Bun-runtime production process: installs frozen deps, builds the frontend and
# workspace packages, compiles the backend into a single-file bytecode binary
# (bun build --compile --bytecode), and execs it with NODE_ENV=production.
#
#   ./scripts/start-prod.sh                → install, build, compile, run
#   ./scripts/start-prod.sh --testnet      → Base Sepolia + Pinata config (validates
#                                            PINATA_JWT/CONTRACT_ADDRESS, starts the
#                                            local Nostr relay via Docker)
#   ./scripts/start-prod.sh --skip-build   → run the existing dist/arbesk-server
#
# Env layering: root .env is sourced first, then .env.production (if present)
# overrides it. Required: CONTRACT_ADDRESS. MOCK_3D_GENERATION=true is allowed
# (owner decision — mock 3D generation may serve production) but is warned about.
# Runtime file reads (.env, frontend/dist, blockchain/artifacts, .data) resolve
# from the project root; override with ARBESK_ROOT when deploying elsewhere.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

# ─── Worktree isolation (same scheme as start-dev.sh — shares its stack) ─────
if [ -z "$COMPOSE_PROJECT_NAME" ]; then
  WT_NAME=$(basename "$PROJECT_ROOT")
  WT_HASH=$(printf '%s' "$PROJECT_ROOT" | sha256sum | cut -c1-8)
  WT_ID=$(echo "${WT_NAME}-${WT_HASH}" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g')
  COMPOSE_PROJECT_NAME="arbesk-${WT_ID}"
fi
export COMPOSE_PROJECT_NAME

# ─── Parse flags ─────────────────────────────────────────────────────────────
SKIP_BUILD=false
TESTNET=false
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
    --testnet)    TESTNET=true ;;
    *) echo "❌ Unknown flag: $arg"; exit 1 ;;
  esac
done

# ─── Bun on PATH ─────────────────────────────────────────────────────────────
if ! command -v bun >/dev/null 2>&1; then
  export PATH="$HOME/.bun/bin:$PATH"
fi
if ! command -v bun >/dev/null 2>&1; then
  echo "❌ bun not found. Install Bun ≥1.4: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

# ─── Load .env and validate production config ────────────────────────────────
if [ ! -f ".env" ]; then
  echo "❌ Root .env not found — copy .env.example and configure it first."
  exit 1
fi
set -a; source .env; set +a
# Optional production overrides (keeps dev settings like MOCK_3D_GENERATION=true
# out of the production process).
[ -f ".env.production" ] && { set -a; source .env.production; set +a; }

if [ "$TESTNET" = "true" ]; then
  # Pinata-specific overrides (IPFS_BACKEND, PINATA_JWT, etc.), same as start-dev.sh.
  [ -f ".env.pinata" ] && { set -a; source .env.pinata; set +a; }
  # --testnet always uses Pinata, regardless of what .env says.
  export IPFS_BACKEND=pinata
  # --testnet means Base Sepolia (chain 84532, constants/chains.js): without this
  # the backend defaults to Hardhat local and anonymous chain reads go to a
  # nonexistent local RPC. API_URL only overrides the Hardhat-local RPC.
  export DEFAULT_CHAIN_ID="${DEFAULT_CHAIN_ID:-84532}"
  export API_URL="${API_URL:-https://sepolia.base.org}"

  MISSING=0
  [ -z "$PINATA_JWT" ]       && { echo "❌ PINATA_JWT is not set."; MISSING=1; }
  [ -z "$CONTRACT_ADDRESS" ] && { echo "❌ CONTRACT_ADDRESS is not set."; MISSING=1; }
  if [ -z "$API_URL" ] || [[ "$API_URL" =~ (localhost|127\.0\.0\.1) ]]; then
    echo "⚠️  API_URL is '${API_URL:-}'. For testnet it should point to Base Sepolia (https://sepolia.base.org)."
  fi
  [ "$MISSING" -ne 0 ] && { echo "❌ Missing required testnet configuration. Update .env / .env.production / .env.pinata."; exit 1; }

  # Comments/live-updates need the Nostr relay; prod does not manage the rest
  # of the Docker stack (no Hardhat/Kubo on testnet), just the relay. Probe the
  # port first — any reachable relay (e.g. the dev stack's) is good enough.
  DC="docker compose -p ${COMPOSE_PROJECT_NAME}"
  if curl -s http://127.0.0.1:7777 >/dev/null 2>&1; then
    echo "✅ Nostr relay reachable on ws://127.0.0.1:7777"
  elif ! ${DC} ps --services --filter "status=running" 2>/dev/null | grep -qE 'nostr'; then
    echo "🐳 Starting local Nostr relay..."
    ${DC} up -d nostr
    for i in $(seq 1 30); do
      curl -s http://127.0.0.1:7777 >/dev/null 2>&1 && { echo "✅ Nostr relay ready on ws://127.0.0.1:7777"; break; }
      [ "$i" -eq 30 ] && echo "⚠️  Nostr relay did not become ready; continuing anyway"
      sleep 1
    done
  else
    echo "✅ Nostr relay already running"
  fi
fi

if [ "${MOCK_3D_GENERATION}" = "true" ]; then
  echo "⚠️  MOCK_3D_GENERATION=true — running with the mock 3D generation adapter (allowed per project owner)."
fi
if [ -z "${CONTRACT_ADDRESS}" ]; then
  echo "❌ CONTRACT_ADDRESS is not set."
  exit 1
fi
[ -z "${IPFS_BACKEND}" ] && echo "⚠️  IPFS_BACKEND unset — defaulting to kubo (expects a reachable Kubo API)."

BINARY="dist/arbesk-server"

# ─── Build ───────────────────────────────────────────────────────────────────
if [ "$SKIP_BUILD" = "false" ]; then
  echo "📦 Installing dependencies (frozen lockfile)..."
  bun install --frozen-lockfile
  (cd frontend && bun install --frozen-lockfile)

  echo "🔨 Building workspace packages..."
  bun run build:packages

  echo "🔨 Building frontend..."
  # Strips the dev-only browser console bridge from the HTML (head.pug).
  (cd frontend && ARBESK_PRODUCTION_BUILD=1 bun run build)

  echo "📦 Compiling backend binary (bytecode, minified, NODE_ENV=production)..."
  bun run build:server
fi

if [ ! -x "$BINARY" ]; then
  echo "❌ ${BINARY} missing — run without --skip-build first."
  exit 1
fi

# ─── Run ─────────────────────────────────────────────────────────────────────
PORT="${PORT:-9090}"
echo "═══════════════════════════════════════════"
echo "  Arbesk production server (Bun binary)"
echo "  mode:       $([ "$TESTNET" = "true" ] && echo "testnet (Base Sepolia)" || echo "production")"
echo "  port:       ${PORT}"
echo "  contract:   ${CONTRACT_ADDRESS}"
echo "  ipfs:       ${IPFS_BACKEND:-kubo}"
echo "═══════════════════════════════════════════"
# exec so signals (SIGTERM/SIGINT) reach the server directly.
exec env NODE_ENV=production ARBESK_ROOT="${PROJECT_ROOT}" PORT="${PORT}" "${BINARY}"
