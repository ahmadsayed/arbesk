#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

echo "═══════════════════════════════════════════"
echo "  Arbesk Dev Launcher"
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
if [ -f "blockchain/.env" ]; then
    sed -i 's|^API_URL=.*|API_URL=http://127.0.0.1:8545|' blockchain/.env
    echo "✅ blockchain/.env configured for local Hardhat"
fi
echo ""

# ─── 2. Start Docker infrastructure ───
if docker compose ps --services --filter "status=running" 2>/dev/null | grep -qE 'ipfs|hardhat'; then
    echo "✅ Docker infrastructure already running"
else
    echo "🐳 Starting Docker infrastructure (IPFS + Hardhat)..."
    docker compose up -d
    echo "⏳ Waiting for Hardhat node to boot..."
    sleep 6

    # Wait until Hardhat RPC responds
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
fi
echo ""

# ─── 3. Install dependencies ───
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

# Install blockchain deps on host for IDE intellisense (optional)
if [ ! -d "blockchain/node_modules" ]; then
    echo "📦 Installing blockchain dependencies..."
    (cd blockchain && npm install)
else
    echo "✅ Blockchain node_modules found"
fi
echo ""

# ─── 4. Deploy contract if needed ───
CONTRACT_ADDRESS=""
if [ -f "blockchain/.env" ]; then
    CONTRACT_ADDRESS=$(grep '^CONTRACT_ADDRESS=' blockchain/.env | cut -d'=' -f2 | tr -d ' ')
fi

DEPLOYMENT_FILE="blockchain/deployments/localhost/ArbeskWorld.json"
NEEDS_DEPLOY=false

if [ -z "$CONTRACT_ADDRESS" ] || [ ! -f "$DEPLOYMENT_FILE" ]; then
    NEEDS_DEPLOY=true
else
    # Verify the contract actually has bytecode on-chain (Hardhat state is not persistent)
    CODE=$(curl -s -X POST http://127.0.0.1:8545 \
        -H "Content-Type: application/json" \
        -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getCode\",\"params\":[\"${CONTRACT_ADDRESS}\",\"latest\"],\"id\":1}" \
        | grep -o '"result":"[^"]*"' | sed 's/"result":"//;s/"$//')
    if [ "$CODE" = "0x" ] || [ -z "$CODE" ]; then
        echo "⚠️  Contract at ${CONTRACT_ADDRESS} has no bytecode on-chain (Hardhat was restarted)"
        NEEDS_DEPLOY=true
    fi
fi

if [ "$NEEDS_DEPLOY" = true ]; then
    echo "📜 Deploying ArbeskWorld contract to Hardhat..."
    docker compose exec hardhat npx hardhat run scripts/deploy.js --network localhost

    # Extract deployed address from deployment record
    if [ -f "$DEPLOYMENT_FILE" ]; then
        CONTRACT_ADDRESS=$(grep '"address"' "$DEPLOYMENT_FILE" | head -1 | sed 's/.*"address".*"\([^"]*\)".*/\1/')
        if [ -n "$CONTRACT_ADDRESS" ]; then
            sed -i "s|^CONTRACT_ADDRESS=.*|CONTRACT_ADDRESS=${CONTRACT_ADDRESS}|" blockchain/.env
            echo "✅ Contract deployed at ${CONTRACT_ADDRESS}"
        fi
    else
        echo "⚠️  Deployment file not found; contract may need manual deployment."
    fi
else
    echo "✅ Contract verified on-chain at ${CONTRACT_ADDRESS}"
fi
echo ""

# ─── 5. Build frontend ───
echo "🔨 Building frontend..."
(cd frontend && npm run build)
echo ""

# ─── 6. Start backend ───
echo "═══════════════════════════════════════════"
echo "  🚀 Arbesk is ready!"
echo "═══════════════════════════════════════════"
echo ""
echo "   Studio:     http://localhost:9090/studio.html"
echo "   API:        http://localhost:9090/api"
echo "   Hardhat:    http://127.0.0.1:8545"
echo "   IPFS API:   http://127.0.0.1:5001"
echo "   IPFS GW:    http://127.0.0.1:8080"
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

node src/index.js
