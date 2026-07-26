# CDP Base Wallet — Reference

Load on demand from SKILL.md. Full background on the Arbesk CDP/Base email-login smart wallet integration.

## Architecture Flow

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

## Key Files (full detail)

- `frontend/src/js/blockchain/wallet-cdp.js` — CDP SDK wrapper + EIP-1193 shim
- `frontend/src/js/blockchain/wallet-core.js` — wallet connection orchestration; persists CDP email in `localStorage` under `arbesk-cdp-email`; stores last-used wallet in `arbesk-last-wallet`; auto-restores CDP, EOA, and WalletConnect sessions on page load via silent `eth_accounts` / session checks (no popup)
- `frontend/src/js/ui/wallet-modal.js` — email OTP UI; clears stale CDP browser state before starting a new OTP flow
- `frontend/src/js/ui/header-wallet-button.js` — displays CDP user email; hides network selector for CDP sessions
- `frontend/src/js/blockchain/smart-wallet-support.js` — Base Sepolia chain gating (`isSmartWalletSupported(chainId)`)
- `frontend/src/js/blockchain/wallet-publishing.js` — publish/updateURI with smart-account gas skipping
- `src/api/routes/paymaster.js` — backend paymaster proxy (reserved for production custom paymasters)
- `src/api/siwe-verify.js` — SIWE verification with `eoaAddress` fallback (embedded EOA signs; `message.address` is the smart account)

## Required Configuration

Root `.env`:
- `CDP_PROJECT_ID` — served to frontend via `/api/v1/config`
- `CDP_PAYMASTER_URL` — used only by backend proxy when `paymasterUrl` mode is enabled

CDP Portal:
- Non-custodial Wallet (Embedded Wallet API v2) product active
- Base Sepolia paymaster configured
- Domain allowed under Clients (e.g. `http://localhost:9090`, production origin)

Frontend persistence:
- `arbesk-cdp-email` — user's email for header display; cleared on disconnect
- `arbesk-last-wallet` — last-used wallet id, drives silent auto-restore on reload

RPC:
- Browser passthrough RPC: `https://base-sepolia-rpc.publicnode.com` (already in CSP)
- `sepolia.base.org` blocks browser-origin requests (403) — backend use only

## CDP SDK Error Catalog

- `EVM account not found` — wrong argument type to `signEvmMessage` (must be address string), or user genuinely has no EVM account (check CDP Portal product enabled + Base Sepolia)
- `User not signed in` — SDK method called before `verifyEmailOTP` completed
- `User is already authenticated` — stale session; clear storage and retry
- `must be a valid HTTP or HTTPS URL with at least 11 characters` — `paymasterUrl` relative or malformed
- `failed to prepare calls: invalid request: capabilities.paymasterService.url = ...` — paymaster URL rejected (localhost, wrong protocol, etc.)

## Paymaster Notes

- Local dev: `useCdpPaymaster: true` — CDP's bundler must reach the paymaster URL; `localhost` is unreachable from CDP's servers.
- Production custom paymaster: expose the backend proxy (`src/api/routes/paymaster.js`) on a public absolute HTTPS URL.
