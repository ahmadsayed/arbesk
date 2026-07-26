---
name: cdp-base-wallet
description: Use for CDP/Base email-login smart wallet work — "CDP email login", "smart wallet", Base Sepolia ERC-4337 accounts, "EVM account not found", UserOperation/paymaster errors, SIWE signing, or any wallet-cdp.js bug. When you see a CDP wallet error, invoke this skill immediately.
---

# CDP Base Wallet Integration

CDP email-login smart wallets: sign-in failures, transaction submission, EIP-1193 shim, integration updates.

## Quick Decision Table

| Symptom | Cause | Fix |
|---------|-------|-----|
| `EVM account not found` during SIWE signing | `signEvmMessage` expects an **address string**, not the account object | Pass `eoaAccount.address`, not `eoaAccount` |
| `must be a valid HTTP or HTTPS URL with at least 11 characters` | `paymasterUrl` relative/malformed; must be absolute | `useCdpPaymaster: true` for local dev; production custom paymasters need the backend proxy on a public HTTPS URL |
| `POST https://sepolia.base.org/ 403` | blocks browser-origin RPC requests | Use `https://base-sepolia-rpc.publicnode.com` for RPC passthrough (already in CSP) |
| Transaction spinner never resolves after UserOperation submit | CDP returns a UserOperation hash; Web3.js expects an EVM txHash | Poll `getUserOperation()`; return `transactionHash` as soon as set — before `status` reaches `"complete"` |
| `User is already authenticated` | Stale CDP session (localStorage/IndexedDB/cookies) | Clear CDP/coinbase keys + `disconnectCdpWallet()` before a new OTP flow |
| Network Error / CORS on `api.cdp.coinbase.com` | Origin not allowed in CDP Portal | Add origin under Non-custodial Wallet → Clients |

## Hard Rules

1. **Address strings to CDP SDK signing methods** — objects are rejected:
   ```js
   const eoaAccount = user.evmAccountObjects[0];
   await signEvmMessage({ evmAccount: eoaAccount.address, message });
   ```
2. **Smart accounts are Base Sepolia only** — gate with `isSmartWalletSupported(chainId)` (`smart-wallet-support.js`).
3. **Never return a UserOperation hash to Web3.js** — it polls `eth_getTransactionReceipt` with it. Return the real `transactionHash` from `getUserOperation()` (set once the op is in a block, independent of `status`).
4. **`useCdpPaymaster: true` for local dev** — CDP's bundler can't reach `localhost`.
5. **Clear stale CDP state before a new OTP flow** — `wallet-modal.js` clears CDP/coinbase storage + `disconnectCdpWallet()` first; the SDK caches across localStorage, IndexedDB, and cookies.

## Key Files

- `frontend/src/js/blockchain/wallet-cdp.js` — CDP SDK wrapper + EIP-1193 shim
- `frontend/src/js/blockchain/wallet-core.js` — orchestration; `localStorage` `arbesk-cdp-email` / `arbesk-last-wallet`; silent auto-restore on page load
- `frontend/src/js/ui/wallet-modal.js` — email OTP UI; clears stale CDP state first
- `frontend/src/js/ui/header-wallet-button.js` — shows CDP email; hides network selector for CDP sessions
- `frontend/src/js/blockchain/wallet-publishing.js` — publish/updateURI with smart-account gas skipping
- `src/api/routes/paymaster.js` — backend paymaster proxy (production custom paymasters)
- `src/api/siwe-verify.js` — SIWE verification with `eoaAddress` fallback

## References

- Read `reference.md` when you need the architecture flow diagram, full config checklist (`.env`, CDP Portal, persistence keys, RPC URLs), the complete CDP SDK error catalog, or paymaster dev/prod details.
