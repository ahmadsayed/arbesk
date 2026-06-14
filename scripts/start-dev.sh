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

DEPLOYMENT_FILE="blockchain/deployments/localhost/ArbeskAsset.json"
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
    # Ensure contracts are compiled before deploy.
    # Hardhat auto-compiles inside getContractFactory but an explicit step
    # catches stale artifacts and missing dependencies before the deploy runs.
    echo "🔨 Compiling Solidity contracts..."
    docker compose exec -T hardhat npx hardhat compile

    # Docker bind mounts on some systems don't sync container→host file writes.
    # To avoid stale USDC_TOKEN poisoning the deploy, we MUST remove it inside
    # the container before running the deploy script.
    # See: test/frontend/deployment-integrity.test.js for regression coverage.
    echo "🧹 Ensuring clean USDC_TOKEN state for fresh MockUSDC deploy..."
    docker compose exec -T hardhat sh -c '
        TMPFILE=$(mktemp)
        grep -v "^USDC_TOKEN=" /app/.env > "$TMPFILE" && cat "$TMPFILE" > /app/.env && rm "$TMPFILE"
    '

    echo "📜 Deploying ArbeskAsset + MockUSDC to Hardhat..."
    docker compose exec -T hardhat npx hardhat run scripts/deploy.js --network localhost

    # Read deployed addresses from the deployment artifact inside the container.
    # docker-compose exec output includes non-JSON noise; filter to the JSON.
    ARTIFACT_RAW=$(docker compose exec -T hardhat cat /app/deployments/localhost/ArbeskAsset.json 2>/dev/null)
    # Find the JSON object between { and }
    ARTIFACT_JSON=$(echo "$ARTIFACT_RAW" | sed -n '/^{/,/^}/p')

    if [ -n "$ARTIFACT_JSON" ]; then
        CONTRACT_ADDRESS=$(echo "$ARTIFACT_JSON" | grep '"address"' | head -1 | sed 's/.*"address"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
        USDC_TOKEN=$(echo "$ARTIFACT_JSON" | grep '"usdcToken"' | head -1 | sed 's/.*"usdcToken"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

        if [ -n "$CONTRACT_ADDRESS" ] && [ -n "$USDC_TOKEN" ]; then
            # Update blockchain/.env on HOST (write from host side, not container)
            TMPFILE=$(mktemp)
            grep -v '^CONTRACT_ADDRESS=\|^USDC_TOKEN=' blockchain/.env > "$TMPFILE"
            echo "CONTRACT_ADDRESS=${CONTRACT_ADDRESS}" >> "$TMPFILE"
            echo "USDC_TOKEN=${USDC_TOKEN}" >> "$TMPFILE"
            mv "$TMPFILE" blockchain/.env
            echo "✅ Contract deployed at ${CONTRACT_ADDRESS}"
            echo "✅ MockUSDC deployed at ${USDC_TOKEN}"

            # Sync CONTRACT_ADDRESS to root .env (backend reads root .env)
            if [ -f ".env" ]; then
                TMPFILE2=$(mktemp)
                grep -v '^CONTRACT_ADDRESS=' .env > "$TMPFILE2" || true
                echo "CONTRACT_ADDRESS=${CONTRACT_ADDRESS}" >> "$TMPFILE2"
                mv "$TMPFILE2" .env
                echo "✅ Root .env synced with CONTRACT_ADDRESS"
            fi

            # Verify MockUSDC is a real ERC20 (not the same contract as ArbeskAsset)
            USDC_CODE=$(curl -s -X POST http://127.0.0.1:8545 \
                -H "Content-Type: application/json" \
                -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getCode\",\"params\":[\"${USDC_TOKEN}\",\"latest\"],\"id\":1}" \
                | grep -o '"result":"[^"]*"' | sed 's/"result":"//;s/"$//')
            ARB_CODE=$(curl -s -X POST http://127.0.0.1:8545 \
                -H "Content-Type: application/json" \
                -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getCode\",\"params\":[\"${CONTRACT_ADDRESS}\",\"latest\"],\"id\":1}" \
                | grep -o '"result":"[^"]*"' | sed 's/"result":"//;s/"$//')
            if [ "$USDC_CODE" = "$ARB_CODE" ] && [ "$USDC_CODE" != "0x" ]; then
                echo "❌ CRITICAL: MockUSDC and ArbeskAsset have the SAME bytecode!"
                echo "   This causes ERC721NonexistentToken errors."
                echo "   Remove USDC_TOKEN from blockchain/.env and re-run."
            else
                echo "✅ MockUSDC verified as distinct ERC20 at ${USDC_TOKEN}"
            fi
        else
            echo "⚠️  Could not parse deployment artifact; .env files may need manual update."
        fi
    else
        echo "⚠️  Deployment artifact not found; contract may need manual deployment."
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

if [ "${1:-}" = "--setup-only" ]; then
    echo "✅ Setup complete. Backend not started (--setup-only)."
    exit 0
fi

node src/index.js
