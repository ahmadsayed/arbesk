#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

# ─── Worktree isolation ───
# If COMPOSE_PROJECT_NAME is already set (e.g. by the E2E global setup), reuse it.
# Otherwise derive a stable project name from the checkout path so different
# git worktrees do not share Docker containers or volume mounts.
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
echo "  Arbesk Local Dev Launcher (E2E-ready)"
echo "  worktree: ${COMPOSE_PROJECT_NAME}"
echo "  backend port: ${BACKEND_PORT}"
echo "═══════════════════════════════════════════"
echo ""

# ─── 1. Ensure blockchain .env exists ───
if [ ! -f "blockchain/.env" ]; then
    if [ -f "blockchain/.env.example" ]; then
        echo "⚙️  Creating blockchain/.env from example..."
        cp blockchain/.env.example blockchain/.env
    else
        echo "⚠️  blockchain/.env.example not found; creating minimal .env"
        cat > blockchain/.env << 'EOF'
API_URL=http://127.0.0.1:8545
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
PUBLIC_KEY=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
CONTRACT_ADDRESS=
TREASURY_ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
EOF
    fi
fi

# Force local Hardhat RPC for development
sed -i 's|^API_URL=.*|API_URL=http://127.0.0.1:8545|' blockchain/.env
echo "✅ blockchain/.env configured for local Hardhat"
echo ""

# ─── 2. Stop and remove any existing containers for a clean start ───
echo "🧹 Stopping any existing local infrastructure..."
${DC} down --volumes --remove-orphans 2>/dev/null || true
echo "✅ Existing infrastructure removed"
echo ""

# ─── 3. Start Docker infrastructure ───
start_docker_infra() {
    echo "🐳 Starting Docker infrastructure (IPFS + Hardhat + Nostr) for ${COMPOSE_PROJECT_NAME}..."
    ${DC} up -d
    echo "⏳ Waiting for Hardhat node to boot..."
    sleep 6

    for i in {1..30}; do
        if curl -s -X POST http://127.0.0.1:8545 \
            -H "Content-Type: application/json" \
            -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
            | grep -q '"result"'; then
            echo "✅ Hardhat RPC is ready"
            break
        fi
        if [ "$i" -eq 30 ]; then
            echo "❌ Hardhat RPC did not become ready in time"
            exit 1
        fi
        sleep 1
    done
}

start_docker_infra
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
    echo "📦 Installing blockchain dependencies..."
    (cd blockchain && npm install)
else
    echo "✅ Blockchain node_modules found"
fi
echo ""

# ─── 5. Reset Hardhat chain and deploy contracts fresh ───
echo "🧹 Resetting Hardhat chain to genesis for a clean deploy..."
curl -s -X POST http://127.0.0.1:8545 \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"hardhat_reset","params":[],"id":1}' >/dev/null
echo "✅ Hardhat chain reset"

# Ensure contracts are compiled before deploy.
echo "🔨 Compiling Solidity contracts..."
${DC} exec -T hardhat npx hardhat compile

# To avoid stale USDC_TOKEN poisoning the deploy, remove it inside the container
# before running the deploy script. This guarantees a fresh MockUSDC deploy.
echo "🧹 Ensuring clean USDC_TOKEN state for fresh MockUSDC deploy..."
${DC} exec -T hardhat sh -c '
    TMPFILE=$(mktemp)
    grep -v "^USDC_TOKEN=" /app/.env > "$TMPFILE" && cat "$TMPFILE" > /app/.env && rm "$TMPFILE"
'

echo "📜 Deploying ArbeskAsset + MockUSDC to Hardhat..."
${DC} exec -T hardhat npx hardhat run scripts/deploy.js --network localhost

# Read deployed addresses from the deployment artifacts inside the container.
FREE_ARTIFACT_RAW=$(${DC} exec -T hardhat cat /app/deployments/localhost/ArbeskAssetFree.json 2>/dev/null)
PAID_ARTIFACT_RAW=$(${DC} exec -T hardhat cat /app/deployments/localhost/ArbeskAsset.json 2>/dev/null)
FREE_ARTIFACT_JSON=$(echo "$FREE_ARTIFACT_RAW" | sed -n '/^{/,/^}/p')
PAID_ARTIFACT_JSON=$(echo "$PAID_ARTIFACT_RAW" | sed -n '/^{/,/^}/p')

if [ -n "$FREE_ARTIFACT_JSON" ] && [ -n "$PAID_ARTIFACT_JSON" ]; then
    CONTRACT_ADDRESS=$(echo "$FREE_ARTIFACT_JSON" | grep '"address"' | head -1 | sed 's/.*"address"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
    PAID_CONTRACT_ADDRESS=$(echo "$PAID_ARTIFACT_JSON" | grep '"address"' | head -1 | sed 's/.*"address"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
    USDC_TOKEN=$(echo "$PAID_ARTIFACT_JSON" | grep '"usdcToken"' | head -1 | sed 's/.*"usdcToken"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

    if [ -n "$CONTRACT_ADDRESS" ] && [ -n "$PAID_CONTRACT_ADDRESS" ] && [ -n "$USDC_TOKEN" ]; then
        # Update blockchain/.env on HOST
        TMPFILE=$(mktemp)
        grep -v '^CONTRACT_ADDRESS=\|^PAID_CONTRACT_ADDRESS=\|^USDC_TOKEN=' blockchain/.env > "$TMPFILE" || true
        echo "CONTRACT_ADDRESS=${CONTRACT_ADDRESS}" >> "$TMPFILE"
        echo "PAID_CONTRACT_ADDRESS=${PAID_CONTRACT_ADDRESS}" >> "$TMPFILE"
        echo "USDC_TOKEN=${USDC_TOKEN}" >> "$TMPFILE"
        mv "$TMPFILE" blockchain/.env
        echo "✅ Contract deployed at ${CONTRACT_ADDRESS}"
        echo "✅ Paid contract deployed at ${PAID_CONTRACT_ADDRESS}"
        echo "✅ MockUSDC deployed at ${USDC_TOKEN}"

        # Sync CONTRACT_ADDRESS to root .env (backend reads root .env)
        if [ -f ".env" ]; then
            TMPFILE2=$(mktemp)
            grep -v '^CONTRACT_ADDRESS=\|^PAID_CONTRACT_ADDRESS=\|^USDC_TOKEN=' .env > "$TMPFILE2" || true
            echo "CONTRACT_ADDRESS=${CONTRACT_ADDRESS}" >> "$TMPFILE2"
            echo "PAID_CONTRACT_ADDRESS=${PAID_CONTRACT_ADDRESS}" >> "$TMPFILE2"
            echo "USDC_TOKEN=${USDC_TOKEN}" >> "$TMPFILE2"
            mv "$TMPFILE2" .env
            echo "✅ Root .env synced with deployed addresses"
        fi

        # Sync addresses into frontend and backend network configs for Hardhat Local
        node - "${CONTRACT_ADDRESS}" "${PAID_CONTRACT_ADDRESS}" "${USDC_TOKEN}" <<'NODE'
const fs = require("fs");
const [free, paid, usdc] = process.argv.slice(2);
const files = [
  "frontend/src/js/blockchain/network-config.js",
  "src/config.js",
];
for (const path of files) {
  if (!fs.existsSync(path)) {
    console.warn(`⚠️  Config file not found: ${path}`);
    continue;
  }
  let config = fs.readFileSync(path, "utf8");
  config = config.replace(
    /(\[CHAIN_IDS\.HARDHAT_LOCAL\]: \{[\s\S]*?contractAddress: )"[^"]*"/,
    `$1"${free}"`
  );
  config = config.replace(
    /(\[CHAIN_IDS\.HARDHAT_LOCAL\]: \{[\s\S]*?paidContractAddress: )"[^"]*"/,
    `$1"${paid}"`
  );
  config = config.replace(
    /(\[CHAIN_IDS\.HARDHAT_LOCAL\]: \{[\s\S]*?usdcToken: )"[^"]*"/,
    `$1"${usdc}"`
  );
  fs.writeFileSync(path, config);
  console.log(`✅ Synced ${path}`);
}
NODE
    else
        echo "⚠️  Could not parse deployed addresses from artifacts"
    fi
else
    echo "⚠️  Deployment artifact not found; contract may need manual deployment"
fi
echo ""

# ─── 6. Build frontend ───
echo "🔨 Building frontend..."
(cd frontend && npm run build)
echo ""

# ─── 7. Print ready banner ───
echo "═══════════════════════════════════════════"
echo "  🚀 Arbesk local stack is ready!"
echo "═══════════════════════════════════════════"
echo ""
echo "   Studio:     http://localhost:${BACKEND_PORT}/studio.html"
echo "   API:        http://localhost:${BACKEND_PORT}/api"
echo "   Hardhat:    http://127.0.0.1:8545"
echo "   IPFS API:   http://127.0.0.1:5001"
echo "   IPFS GW:    http://127.0.0.1:8080"
echo "   Nostr:      ws://127.0.0.1:7777"
if [ -n "$CONTRACT_ADDRESS" ]; then
    echo "   Contract:   ${CONTRACT_ADDRESS}"
fi
echo ""
echo "   MetaMask / Rabby setup:"
echo "     Network: Hardhat Local"
echo "     RPC:     http://127.0.0.1:8545"
echo "     Chain:   31415822 (0x1df5e0e)"
echo ""
echo "   Private key (dev account #0):"
echo "     0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
echo ""
echo "═══════════════════════════════════════════"
echo ""

if [ "${1:-}" = "--setup-only" ]; then
    echo "✅ Setup complete. Backend not started (--setup-only)."
    exit 0
fi

# ─── 8. Start backend ───
PORT="${BACKEND_PORT}" IPFS_BACKEND=kubo node src/index.js
