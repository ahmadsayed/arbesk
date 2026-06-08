# Smart Accounts (ERC-4337) — Solidity Smart Contracts

Proxy/bundler validation, event-based proof, MetaMask Smart Transactions, and Brave Wallet notes.

## 9. Smart Accounts (ERC-4337) & Proxy Contract Validation

### The Problem

MetaMask's **"Smart Transactions"** feature (and other ERC-4337 wallets) route user transactions through a **proxy/bundler contract** rather than calling the dapp contract directly. This means:

- `receipt.to` is the **proxy address**, NOT the dapp contract address
- `receipt.from` is the **bundler/entrypoint**, NOT the user's EOA
- Standard `receipt.to === CONTRACT_ADDRESS` validation **fails**

**Symptom:** Backend returns `WRONG_CONTRACT` even though the user successfully paid.

### The Solution: Event-Based Validation

Instead of validating `receipt.to`, validate that the transaction contains a valid payment event **emitted by the contract**:

```javascript
// src/api/assets/generate-node.js
const nativeEventSig = txWeb3.utils.keccak256(
  "AssetGenerationPaid(address,bytes32,string,uint256,uint256)"
);
const usdcEventSig = txWeb3.utils.keccak256(
  "AssetGenerationPaidUSDC(address,bytes32,string,uint256,uint256,uint8)"
);
const contractAddrLower = contractAddr?.toLowerCase();

const hasPaymentEvent = contractAddr
  ? receipt.logs.some(
      (log) =>
        (log.topics[0] === nativeEventSig || log.topics[0] === usdcEventSig) &&
        log.address.toLowerCase() === contractAddrLower
    )
  : false;

// Smart account support: accept if direct call OR payment event from contract
if (
  contractAddr &&
  receipt.to &&
  receipt.to.toLowerCase() !== contractAddrLower &&
  !hasPaymentEvent
) {
  return res.status(403).json({
    code: "WRONG_CONTRACT",
    message: "Transaction not sent to ArbeskAsset contract",
  });
}

if (contractAddr && !hasPaymentEvent) {
  return res.status(403).json({
    code: "EVENT_NOT_FOUND",
    message: "No valid payment event found in transaction logs",
  });
}
```

### Key Rules for Smart Account Support

1. **Always emit an event** for every payment — this is your proof
2. **Validate `log.address`** not `receipt.to` — `log.address` is the contract that emitted the event
3. **Check event signature** (topic[0]) to ensure it's the right event type
4. **Support both paths:** direct EOA calls AND proxy/bundler calls
5. **Log proxy detection** for debugging — log `receipt.to` vs expected contract

### MetaMask Smart Transaction Settings

In MetaMask Settings → Advanced:
- **"Smart Transactions"** — ON (routes through MetaMask's bundler)
- **"Smart account requests from dapps"** — ON (enables ERC-4337)

When these are enabled, the transaction flow is:
```
User → MetaMask → Bundler Proxy (0xdb9b...7db3) → EntryPoint → ArbeskAsset
```

When disabled:
```
User → MetaMask → ArbeskAsset (direct)
```

### Detecting Smart Account Transactions

```javascript
function isSmartAccountTx(receipt, contractAddr) {
  const isDirectCall =
    receipt.to && receipt.to.toLowerCase() === contractAddr.toLowerCase();
  const hasContractEvent = receipt.logs.some(
    (log) => log.address.toLowerCase() === contractAddr.toLowerCase()
  );
  return !isDirectCall && hasContractEvent;
}
```

### Brave Wallet Note

Brave Wallet also supports smart accounts and may route through proxies. The same event-based validation applies. If users report `WRONG_CONTRACT` or `-32603` errors with Brave Wallet, check if smart account features are enabled.
