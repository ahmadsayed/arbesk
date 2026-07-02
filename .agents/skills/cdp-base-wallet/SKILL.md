---
name: cdp-base-wallet
description: Expert guidance on the Arbesk CDP/Base email-login smart wallet integration. Covers the @coinbase/cdp-core SDK, EIP-1193 provider shim, ERC-4337 smart accounts on Base Sepolia, SIWE signing, sponsored UserOperations, and the common gotchas that break the flow. Use when asked about "CDP email login", "smart wallet", "Base Sepolia email wallet", "EVM account not found", "UserOperation", "paymaster", "wallet-cdp.js", or any CDP/Base wallet bug in this codebase. When you see a CDP wallet error, invoke this skill immediately.
---

# CDP Base Wallet Integration

Use this skill for any task involving CDP email-login smart wallets: debugging sign-in failures, fixing transaction submission, understanding the EIP-1193 shim, or updating the integration.

## Quick Decision Table

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Error: EVM account not found` during SIWE signing | `signEvmMessage` expects an **address string**, not the account object | Pass `eoaAccount.address`, not `eoaAccount` |
| `must be a valid HTTP or HTTPS URL with at least 11 characters` | `paymasterUrl` must be absolute; relative paths are rejected | Use `useCdpPaymaster: true` for local dev; for production custom paymasters expose the backend proxy on a public HTTPS URL |
| `POST https://sepolia.base.org/ 403` | `sepolia.base.org` blocks browser-origin RPC requests | Use `https://base-sepolia-rpc.publicnode.com` for RPC passthrough (already in CSP) |
| Transaction spinner never resolves after UserOperation submit | CDP returns a UserOperation hash; Web3.js expects an EVM txHash | Poll `getUserOperation()` and return `transactionHash` as soon as it appears — it's set once the op is broadcast and included in a block, before `status` reaches `"complete"` |
| `User is already authenticated` | Stale CDP session in localStorage/IndexedDB | Clear CDP/coinbase keys and call `disconnectCdpWallet()` before starting a new OTP flow |
| `Network Error` or CORS on `api.cdp.coinbase.com` | Origin not allowed in CDP Portal | Add `http://localhost:9090` (or your production origin) under Non-custodial Wallet → Clients |

## Architecture

```
User email ──► signInWithEmail() ──► verifyEmailOTP() ──► createOnLogin: "smart"
                                                          │
                                                          ▼
                                              EOA + ERC-4337 Smart Account
                                                          │
                                                          ▼
                                              buildCdpEip1193Provider()
                                                          │
                              ┌───────────────────────────┼───────────────────────────┐
                              ▼                           ▼                           ▼
                    eth_accounts / eth_chainId    personal_sign (SIWE)    eth_sendTransaction
                              │                           │                           ▼
                              │                           │                    sendUserOperation()
                              │                           │                           ▼
                              │                           │              getUserOperation() polling
                              │                           │                           ▼
                              │                           │              return real transactionHash
                              ▼                           ▼                           ▼
                         Web3.js / wallet-core      SIWE session          Web3.js receipt polling
```

## Key Files

- `frontend/src/js/blockchain/wallet-cdp.js` — CDP SDK wrapper + EIP-1193 shim
- `frontend/src/js/ui/wallet-modal.js` — email OTP UI; clears stale CDP browser state before starting a new OTP flow
- `frontend/src/js/ui/header-wallet-button.js` — displays the CDP user's email and hides the network selector for CDP sessions
- `frontend/src/js/blockchain/wallet-core.js` — wallet connection orchestration; persists the CDP email in `localStorage` under `arbesk-cdp-email` and auto-restores CDP, EOA, and WalletConnect sessions on page load
- `frontend/src/js/blockchain/smart-wallet-support.js` — Base Sepolia chain gating
- `frontend/src/js/blockchain/wallet-publishing.js` — publish/updateURI with smart-account gas skipping
- `src/api/routes/paymaster.js` — backend paymaster proxy (reserved for production custom paymasters)
- `src/api/siwe-verify.js` — SIWE verification with `eoaAddress` fallback

## Required Configuration

Root `.env`:
- `CDP_PROJECT_ID` — served to frontend via `/api/v1/config`
- `CDP_PAYMASTER_URL` — used only by backend proxy when `paymasterUrl` mode is enabled

CDP Portal:
- Non-custodial Wallet (Embedded Wallet API v2) product active
- Base Sepolia paymaster configured
- Domain allowed under Clients

Frontend persistence:
- `wallet-core.js` stores the CDP email in `localStorage` key `arbesk-cdp-email` so the header can display the user's email after sign-in. This value is cleared on disconnect.
- `wallet-core.js` stores the last-used wallet identifier (`arbesk-last-wallet`) and auto-restores CDP, EOA, and WalletConnect sessions on page reload via silent `eth_accounts` / session checks — no popup is shown.

## Implementation Rules

1. **Always pass address strings to CDP SDK signing methods.**
   ```js
   const eoaAccount = user.evmAccountObjects[0];
   await signEvmMessage({ evmAccount: eoaAccount.address, message });
   ```

2. **Smart accounts are Base Sepolia only.** Gate with `isSmartWalletSupported(chainId)`.

3. **Never return a UserOperation hash to Web3.js.** Web3.js will try to poll `eth_getTransactionReceipt` with it. Poll `getUserOperation()` and return the real `transactionHash` as soon as it's present — it's set once the op is broadcast and included in a block, independent of whether `status` has advanced to `"complete"`.

4. **Use `useCdpPaymaster: true` for local development.** CDP's bundler must be able to reach the paymaster URL; `localhost` is not reachable from CDP's servers.

5. **Clear stale CDP state before a new OTP flow.** `wallet-modal.js` clears CDP/coinbase storage and calls `disconnectCdpWallet()` before collecting the email and starting OTP verification. The SDK caches session data across localStorage, IndexedDB, and cookies.

## Common CDP SDK Error Messages

- `EVM account not found` — wrong argument type to `signEvmMessage`, or user genuinely has no EVM account (check CDP Portal product enabled + Base Sepolia)
- `User not signed in` — called SDK method before `verifyEmailOTP` completed
- `User is already authenticated` — stale session; clear storage and retry
- `must be a valid HTTP or HTTPS URL with at least 11 characters` — `paymasterUrl` is relative or malformed
- `failed to prepare calls: invalid request: capabilities.paymasterService.url = ...` — paymaster URL rejected (localhost, wrong protocol, etc.)
