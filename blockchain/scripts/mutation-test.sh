#!/usr/bin/env bash
# Mutation testing for the Arbesk Solidity contracts via slither-mutate.
#
# Usage:
#   ./scripts/mutation-test.sh                       # all 3 contracts, sequentially
#   ./scripts/mutation-test.sh ArbeskAssetFree.sol    # single contract
#
# Run from blockchain/. Sets up an isolated venv on first run (blockchain/.venv-mutate/,
# gitignored) with slither-analyzer + solc-select pinned to the project's solc version.
#
# Known upstream slither-mutate bug this script works around: its per-mutant
# compile check (crytic_compile.CryticCompile in
# slither/tools/mutator/utils/testing_generated_mutant.py) never forwards
# --evm-version, so every mutant silently recompiles against solc's default
# (pre-Cancun) target and fails to compile against OpenZeppelin v5's mcopy
# usage — regardless of mutation validity. This script shims `solc` on PATH
# to always inject --evm-version cancun (matching hardhat.config.js) unless
# already specified. Without this shim you will see 100% "COMPILATION
# FAILURE" and zero real results.
#
# Also avoids --contract-names: combined with a directory codebase target it
# silently generates zero mutants in this slither-analyzer version. Passing
# individual contract file paths as the positional target works correctly.

set -euo pipefail
cd "$(dirname "$0")/.."

# Safety net: slither-mutate patches contract source files in place while
# testing each mutant and restores the original afterward — but if this
# script (or slither-mutate itself) is killed mid-mutant (Ctrl-C, timeout,
# OOM), the restore never runs and a mutated contract is left sitting in
# the working tree. Observed in practice, not hypothetical.
#
# Two things are required to actually catch this, not just one:
# 1. EXIT alone doesn't fire on an untrapped signal — bash only runs the
#    EXIT trap for a signal if a handler is ALSO registered for that exact
#    signal; otherwise SIGTERM (what `timeout` and most process managers
#    send) kills the shell immediately and skips EXIT entirely.
# 2. A trap on a synchronous *foreground* command (slither-mutate run
#    directly, no `&`) is not enough either: bash defers running the trap
#    until that foreground command exits on its own, so a killed wrapper
#    leaves slither-mutate running as an orphan, still patching the file.
#    `wait` is the one bash builtin that IS interrupted promptly by a
#    trapped signal — so the child must run backgrounded + waited-on, and
#    the trap must explicitly kill that child before restoring the file.
CHILD_PID=""
cleanup() {
  if [ -n "$CHILD_PID" ] && kill -0 "$CHILD_PID" 2>/dev/null; then
    kill -TERM "$CHILD_PID" 2>/dev/null || true
    wait "$CHILD_PID" 2>/dev/null || true
  fi
  git checkout -- contracts/ 2>/dev/null || true
}
trap cleanup EXIT INT TERM HUP

SOLC_VERSION="0.8.24"
VENV_DIR=".venv-mutate"
TEST_CMD="npx hardhat test"
TIMEOUT="${MUTATION_TEST_TIMEOUT:-30}"

if [ ! -d "$VENV_DIR" ]; then
  echo "### Setting up isolated mutation-testing venv ($VENV_DIR)..."
  python3 -m venv "$VENV_DIR"
  "$VENV_DIR/bin/pip" install --upgrade pip -q
  "$VENV_DIR/bin/pip" install slither-analyzer solc-select -q
  "$VENV_DIR/bin/solc-select" install "$SOLC_VERSION"
  "$VENV_DIR/bin/solc-select" use "$SOLC_VERSION"

  # Shim solc to always pass --evm-version (see header comment).
  mv "$VENV_DIR/bin/solc" "$VENV_DIR/bin/solc-real"
  cat > "$VENV_DIR/bin/solc" <<'EOF'
#!/usr/bin/env bash
args=("$@")
has_evm_version=0
for a in "${args[@]}"; do
  if [[ "$a" == "--evm-version" ]]; then has_evm_version=1; fi
done
if [[ $has_evm_version -eq 0 ]]; then
  args+=(--evm-version cancun)
fi
exec "$(dirname "$0")/solc-real" "${args[@]}"
EOF
  chmod +x "$VENV_DIR/bin/solc"
fi

export PATH="$PWD/$VENV_DIR/bin:$PATH"

run_one() {
  local target="$1"
  local outdir="mutation_campaign_$(basename "$target" .sol)"
  echo ""
  echo "### Mutation testing $target (timeout ${TIMEOUT}s/mutant)..."
  rm -rf "$outdir"
  slither-mutate "contracts/$target" \
    --test-cmd "$TEST_CMD" \
    --compile-force-framework solc \
    --solc-remaps "@openzeppelin/=node_modules/@openzeppelin/" \
    --timeout "$TIMEOUT" \
    --output-dir "$outdir" \
    -v &
  CHILD_PID=$!
  wait "$CHILD_PID"
  CHILD_PID=""
}

if [ $# -gt 0 ]; then
  run_one "$1"
else
  # mock/ (MockUSDC) is excluded — test-only stub, not deployed code.
  for f in ArbeskAssetBase.sol ArbeskAsset.sol ArbeskAssetFree.sol; do
    run_one "$f"
  done
fi
