# MegaETH / MegaEVM Patterns for Arbesk Solidity

> Cross-reference: the `megaeth-developer` skill contains the full playbook. This file collects the Solidity-specific patterns most relevant when working on Arbesk contracts targeting MegaETH.

## Chain Configuration

| Network | Chain ID | RPC | Explorer |
|---------|----------|-----|----------|
| MegaETH Mainnet | 4326 | `https://mainnet.megaeth.com/rpc` | `https://mega.etherscan.io` |
| MegaETH Testnet | 6343 | `https://carrot.megaeth.com/rpc` | `https://megaeth-testnet-v2.blockscout.com` |

## Dual Gas Model

MegaEVM tracks **compute gas** and **storage gas** separately. Both are paid from the gas limit.

| Dimension | Covers | Key Difference |
|-----------|--------|----------------|
| Compute gas | Opcode execution, memory, calls | 200M per-tx limit |
| Storage gas | Persistent state modifications | New slots are very expensive |

A simple ETH transfer costs **60,000 gas** on MegaETH (21K compute + 39K storage), not 21,000.

## SSTORE Costs — The Big One

```solidity
SSTORE (0 → non-zero): 2,000,000 gas × bucket_multiplier
SSTORE (non-zero → non-zero): ~100–2,100 gas
```

Bucket multiplier grows with usage (1×, 2×, 4×, 8× …). At multiplier 1, storage gas is zero — this is why slot reuse dominates.

### Prefer Slot Reuse

```solidity
// ❌ Expensive: allocates a new slot per unique key
mapping(address => uint256) public balances;

// ✅ Better: fixed-size circular buffer reuses slots
uint256[100] public buffer;
uint256 public head;
function enqueue(uint256 value) external {
    buffer[head] = value;
    head = (head + 1) % 100;
}
```

### Solady RedBlackTreeLib

```solidity
import {RedBlackTreeLib} from "solady/src/utils/RedBlackTreeLib.sol";

contract OptimizedStorage {
    using RedBlackTreeLib for RedBlackTreeLib.Tree;
    RedBlackTreeLib.Tree private _tree;
    // Manages contiguous slots; insert/remove reuses existing slots
}
```

### Transient Storage (EIP-1153)

Use `TSTORE`/`TLOAD` for data that only needs to survive the current transaction:

```solidity
assembly {
    tstore(0, value)
    let v := tload(0)
}
```

## Volatile Data Access Cap

Accessing block metadata retroactively caps the **total** compute gas of the transaction at 20M.

**Affected opcodes:** `TIMESTAMP`, `NUMBER`, `BLOCKHASH`, `BASEFEE`, `PREVRANDAO`, `GASLIMIT`, `COINBASE`, `BLOBBASEFEE`, `BLOBHASH`, plus any access to the beneficiary account.

```solidity
// ❌ Will OOG if loop already burned >20M compute gas
function process() external {
    for (uint i = 0; i < 10000; i++) { /* heavy work */ }
    uint256 ts = block.timestamp;
}

// ✅ Keep total compute gas under 20M when using block metadata
function process() external {
    uint256 ts = block.timestamp;
    lastUpdated = ts;
    emit Processed(ts);
}
```

### Timestamp Oracle (Microsecond Precision)

Avoid the volatile-data cap by reading from the oracle:

```solidity
interface ITimestampOracle {
    function timestamp() external view returns (uint256); // microseconds
}

ITimestampOracle constant ORACLE =
    ITimestampOracle(0x6342000000000000000000000000000000000002);
```

### MegaAccessControl (Rex4)

System contract at `0x6342000000000000000000000000000000000004` lets you disable volatile data access for inner calls:

```solidity
IMegaAccessControl(0x6342000000000000000000000000000000000004).disableVolatileDataAccess();
(bool ok, ) = untrusted.call(data); // block.timestamp here reverts cleanly
IMegaAccessControl(0x6342000000000000000000000000000000000004).enableVolatileDataAccess();
```

## Gas Price & Estimation

- Base fee is fixed at **0.001 gwei** (`1_000_000` wei).
- `eth_maxPriorityFeePerGas` returns 0; ignore it during normal operation.
- Always use **remote** `eth_estimateGas`; local Hardhat/Foundry simulation uses standard EVM costs.
- Hardcode gas limits when possible to save round-trips.

```javascript
const tx = {
  maxFeePerGas: 1_000_000n,   // 0.001 gwei
  maxPriorityFeePerGas: 0n,   // usually sufficient
  gasLimit: 5_000_000n,       // hardcode after remote estimation
};
```

## Foundry on MegaETH

Use `--skip-simulation` so Foundry does not rely on local gas models:

```bash
forge script Deploy.s.sol \
  --rpc-url https://carrot.megaeth.com/rpc \
  --gas-limit 5000000 \
  --skip-simulation \
  --broadcast
```

Pitfall: `via_ir = true` can silently break return values. Use `optimizer = true` with `optimizer_runs = 200` instead.

## Transaction Submission

Prefer `eth_sendRawTransactionSync` (EIP-7966) for near-instant receipts on MegaETH:

```javascript
const receipt = await client.request({
  method: 'eth_sendRawTransactionSync',
  params: [signedTx],
});
```

## Contract Limits

| Resource | TX Limit |
|----------|----------|
| Contract code | 512 KB |
| Calldata | 128 KB |
| State growth slots | 1,000 |
| eth_call/estimateGas | 10M gas (public) |

Per-frame state growth (Rex4): child frames receive 98% of the parent's remaining budget. Exceeding a child frame's budget reverts that frame with `MegaLimitExceeded(3, limit)`.

## Useful OP Stack Predeploys

| Contract | Address |
|----------|---------|
| WETH9 | `0x4200000000000000000000000000000000000006` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| L2CrossDomainMessenger | `0x4200000000000000000000000000000000000007` |

## Verification

MegaETH uses the Etherscan V2 API with chain ID:

```bash
forge verify-contract <address> src/MyContract.sol:MyContract \
  --chain 4326 \
  --etherscan-api-key $ETHERSCAN_KEY \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=4326"
```

## Further Reading

- Full MegaETH playbook: `megaeth-developer` skill
- Detailed gas model: `megaeth-developer/gas-model.md`
- Storage optimization: `megaeth-developer/storage-optimization.md`
- Smart contract patterns: `megaeth-developer/smart-contracts.md`
- Foundry setup: `megaeth-developer/foundry-config.md`
- Debugging/replay: `megaeth-developer/mega-evme.md`
