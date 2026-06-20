#!/usr/bin/env bash
set -e

# ─── Arbesk Dev Launcher ─────────────────────────────────────────────────────
# One script, two modes.  Both modes require Docker (local Nostr relay).
#
#   ./scripts/start-dev.sh              → local:  IPFS + Hardhat + Nostr + backend       (UI testing)
#   ./scripts/start-dev.sh --setup-only → local:  IPFS + Hardhat + Nostr, no backend     (E2E testing)
#   ./scripts/start-dev.sh --testnet    → testnet: Optimism Sepolia + Pinata + Nostr + backend
#
# Flags:
#   --print-project   Print the Docker Compose project name and exit.
#   --setup-only      Skip starting the backend (E2E manages its own backend process).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

# ─── Parse flags ─────────────────────────────────────────────────────────────
MODE="local"
SETUP_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --testnet)       MODE="testnet" ;;
    --setup-only)    SETUP_ONLY=true ;;
    --print-project) PRINT_PROJECT=true ;;
  esac
done

# ─── Worktree isolation ──────────────────────────────────────────────────────
if [ -z "$COMPOSE_PROJECT_NAME" ]; then
  WT_NAME=$(basename "$PROJECT_ROOT")
  WT_HASH=$(printf '%s' "$PROJECT_ROOT" | sha256sum | cut -c1-8)
  WT_ID=$(echo "${WT_NAME}-${WT_HASH}" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g')
  COMPOSE_PROJECT_NAME="arbesk-${WT_ID}"
fi
export COMPOSE_PROJECT_NAME
DC="docker compose -p ${COMPOSE_PROJECT_NAME}"
BACKEND_PORT="${PORT:-9090}"

if [ "${PRINT_PROJECT:-}" = "true" ]; then
  echo "$COMPOSE_PROJECT_NAME"
  exit 0
fi

# ─── Load .env (source of truth for both modes) ───────────────────────────────
if [ -f ".env" ]; then
  set -a; source .env; set +a
fi

echo "═══════════════════════════════════════════"
echo "  Arbesk Dev Launcher"
echo "  mode:       ${MODE}"
echo "  worktree:   ${COMPOSE_PROJECT_NAME}"
echo "  backend:    ${BACKEND_PORT}"
echo "═══════════════════════════════════════════"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# LOCAL MODE
# ═══════════════════════════════════════════════════════════════════════════════
if [ "$MODE" = "local" ]; then

  # ── Ensure blockchain/.env exists ─────────────────────────────────────────
  if [ ! -f "blockchain/.env" ]; then
    echo "⚙️  Creating blockchain/.env from example..."
    cp blockchain/.env.example blockchain/.env 2>/dev/null || {
      echo "⚠️  blockchain/.env.example not found; creating minimal .env"
      cat > blockchain/.env << 'EOF'
API_URL=http://127.0.0.1:8545
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
PUBLIC_KEY=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
CONTRACT_ADDRESS=
TREASURY_ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
EOF
    }
  fi
  sed -i 's|^API_URL=.*|API_URL=http://127.0.0.1:8545|' blockchain/.env
  echo "✅ blockchain/.env configured for local Hardhat"
  echo ""

  # ── Clean start: stop containers, restart, wait for Hardhat ───────────────
  echo "🧹 Stopping any existing local infrastructure..."
  ${DC} down --volumes --remove-orphans 2>/dev/null || true

  echo "🐳 Starting Docker infrastructure (IPFS + Hardhat + Nostr)..."
  ${DC} up -d

  echo "⏳ Waiting for Hardhat RPC..."
  sleep 6
  for i in $(seq 1 30); do
    if curl -s -X POST http://127.0.0.1:8545 \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
        | grep -q '"result"'; then
      echo "✅ Hardhat RPC is ready"
      break
    fi
    [ "$i" -eq 30 ] && { echo "❌ Hardhat RPC did not become ready in time"; exit 1; }
    sleep 1
  done
  echo ""

  # ── Reset chain + deploy contracts ────────────────────────────────────────
  echo "🧹 Resetting Hardhat chain to genesis..."
  curl -s -X POST http://127.0.0.1:8545 \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"hardhat_reset","params":[],"id":1}' >/dev/null

  echo "🔨 Compiling Solidity contracts..."
  ${DC} exec -T hardhat npx hardhat compile

  # Force a fresh MockUSDC deploy by removing any cached address.
  # sed -i fails on volume mounts (atomic rename across fs). Use /tmp.
  ${DC} exec -T hardhat sh -c 'grep -v "^USDC_TOKEN=" /app/.env >/tmp/e && cat /tmp/e >/app/.env'

  echo "📜 Deploying ArbeskAsset + MockUSDC..."
  ${DC} exec -T hardhat npx hardhat run scripts/deploy.js --network localhost

  # ── Sync deployed addresses to all config files ───────────────────────────
  echo "📜 Syncing deployed addresses..."
  node scripts/sync-deployed-addresses.mjs
  # Re-source .env so banner + backend see the fresh addresses.
  set -a; source .env; set +a
  echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TESTNET MODE
# ═══════════════════════════════════════════════════════════════════════════════
else

  # Override with Pinata-specific config (IPFS_BACKEND, PINATA_JWT, etc.)
  [ -f ".env.pinata" ] && { set -a; source .env.pinata; set +a; }
  # --testnet always uses Pinata, regardless of what .env says.
  export IPFS_BACKEND=pinata

  MISSING=0
  [ -z "$PINATA_JWT" ]            && { echo "❌ PINATA_JWT is not set."; MISSING=1; }
  [ -z "$CONTRACT_ADDRESS" ]      && { echo "❌ CONTRACT_ADDRESS is not set."; MISSING=1; }
  [ -z "$PAID_CONTRACT_ADDRESS" ] && { echo "❌ PAID_CONTRACT_ADDRESS is not set."; MISSING=1; }
  [ -z "$USDC_TOKEN" ]            && { echo "❌ USDC_TOKEN is not set."; MISSING=1; }

  if [ -z "$API_URL" ] || [[ ! "$API_URL" =~ optimism|sepolia ]]; then
    echo "⚠️  API_URL is '${API_URL:-}'. For testnet it should point to Optimism Sepolia."
  fi

  if [ "$MISSING" -ne 0 ]; then
    echo ""
    echo "❌ Missing required configuration. Update your root .env and try again."
    exit 1
  fi

  echo "✅ Configuration valid for testnet + Pinata"
  echo "   IPFS:  pinata (remote)"
  echo "   Nostr: Docker (ws://127.0.0.1:7777)"
  echo "   RPC:   ${API_URL}"
  echo ""

  # ── Start local Nostr relay ───────────────────────────────────────────────
  if ! ${DC} ps --services --filter "status=running" 2>/dev/null | grep -qE 'nostr'; then
    echo "🐳 Starting local Nostr relay..."
    ${DC} up -d nostr
    echo "⏳ Waiting for Nostr..."
    for i in $(seq 1 30); do
      curl -s http://127.0.0.1:7777 >/dev/null 2>&1 && { echo "✅ Nostr relay ready on ws://127.0.0.1:7777"; break; }
      [ "$i" -eq 30 ] && echo "⚠️  Nostr relay did not become ready; continuing anyway"
      sleep 1
    done
  else
    echo "✅ Nostr relay already running"
  fi
  echo ""
fi

# ═══════════════════════════════════════════════════════════════════════════════
# SHARED STEPS (both modes)
# ═══════════════════════════════════════════════════════════════════════════════

# ── Install dependencies ──────────────────────────────────────────────────────
for dir in . frontend blockchain; do
  label="${dir#.}"; label="${label#/}"; [ -z "$label" ] && label="root"
  if [ -d "${dir}/node_modules" ]; then
    echo "✅ ${label} node_modules found"
  else
    echo "📦 Installing ${label} dependencies..."
    (cd "${dir}" && npm install)
  fi
done
echo ""

# ── Build frontend ────────────────────────────────────────────────────────────
echo "🔨 Building frontend..."
(cd frontend && npm run build)
echo ""

# ── Ready banner ──────────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════"
if [ "$MODE" = "local" ]; then
  echo "  🚀 Arbesk local stack is ready!"
  echo "═══════════════════════════════════════════"
  echo ""
  echo "   Studio:     http://localhost:${BACKEND_PORT}/studio.html"
  echo "   API:        http://localhost:${BACKEND_PORT}/api"
  echo "   Hardhat:    http://127.0.0.1:8545"
  echo "   IPFS API:   http://127.0.0.1:5001"
  echo "   IPFS GW:    http://127.0.0.1:8080"
  echo "   Nostr:      ws://127.0.0.1:7777"
  [ -n "${CONTRACT_ADDRESS:-}" ] && echo "   Contract:   ${CONTRACT_ADDRESS}"
  echo ""
  echo "   Wallet setup:"
  echo "     Network: Hardhat Local  |  Chain: 31415822 (0x1df5e0e)"
  echo "     RPC:     http://127.0.0.1:8545"
  echo "     Key:     0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
else
  echo "  🚀 Arbesk testnet stack is ready!"
  echo "═══════════════════════════════════════════"
  echo ""
  echo "   Studio:     http://localhost:${BACKEND_PORT}/studio.html"
  echo "   API:        http://localhost:${BACKEND_PORT}/api"
  echo "   IPFS:       Pinata (remote)"
  echo "   Nostr:      ws://127.0.0.1:7777 (Docker)"
  echo "   Network:    Optimism Sepolia"
  echo "   RPC:        ${API_URL}"
  echo "   Contract:   ${CONTRACT_ADDRESS}"
fi
echo ""

if [ "$SETUP_ONLY" = "true" ]; then
  echo "✅ Setup complete. Backend not started (--setup-only, for E2E testing)."
  exit 0
fi

# ── Start backend ─────────────────────────────────────────────────────────────
IPFS_BACKEND="$([ "$MODE" = "local" ] && echo kubo || echo pinata)"
PORT="${BACKEND_PORT}" IPFS_BACKEND="${IPFS_BACKEND}" node src/index.js
