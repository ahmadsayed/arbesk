#!/usr/bin/env bash
set -e

# ─── Arbesk Production Launcher ──────────────────────────────────────────────
# Bun-runtime production process: installs frozen deps, builds the frontend and
# workspace packages, compiles the backend into a single-file bytecode binary
# (bun build --compile --bytecode), and execs it with NODE_ENV=production.
#
#   ./scripts/start-prod.sh                → install, build, compile, run
#   ./scripts/start-prod.sh --skip-build   → run the existing dist/arbesk-server
#
# Required env (root .env): CONTRACT_ADDRESS. Refuses to run with
# MOCK_3D_GENERATION=true — the mock 3D adapter must never serve production.
# Runtime file reads (.env, frontend/dist, blockchain/artifacts, .data) resolve
# from the project root; override with ARBESK_ROOT when deploying elsewhere.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

# ─── Parse flags ─────────────────────────────────────────────────────────────
SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
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

if [ "${MOCK_3D_GENERATION}" = "true" ]; then
  echo "❌ MOCK_3D_GENERATION=true in .env — the mock 3D adapter must never run in production."
  exit 1
fi
if [ -z "${CONTRACT_ADDRESS}" ]; then
  echo "❌ CONTRACT_ADDRESS is not set in .env."
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
  (cd frontend && bun run build)

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
echo "  port:       ${PORT}"
echo "  contract:   ${CONTRACT_ADDRESS}"
echo "  ipfs:       ${IPFS_BACKEND:-kubo}"
echo "═══════════════════════════════════════════"
# exec so signals (SIGTERM/SIGINT) reach the server directly.
exec env NODE_ENV=production ARBESK_ROOT="${PROJECT_ROOT}" PORT="${PORT}" "${BINARY}"
