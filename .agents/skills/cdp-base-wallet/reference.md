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

- `frontend/src/js/blockchain/wallet-cdp.ts` — CDP SDK wrapper + EIP-1193 shim
- `frontend/src/js/blockchain/wallet-core.ts` — wallet connection orchestration; persists CDP email in `localStorage` under `arbesk-cdp-email`; stores last-used wallet in `arbesk-last-wallet`; auto-restores CDP, EOA, and WalletConnect sessions on page load via silent `eth_accounts` / session checks (no popup)
- `frontend/src/js/ui/wallet-modal.ts` — email OTP UI; clears stale CDP browser state before starting a new OTP flow
- `frontend/src/js/ui/header-wallet-button.ts` — displays CDP user email; hides network selector for CDP sessions
- `frontend/src/js/blockchain/smart-wallet-support.ts` — Base Sepolia chain gating (`isSmartWalletSupported(chainId)`)
- `frontend/src/js/blockchain/wallet-publishing.ts` — publish/updateURI with smart-account gas skipping
- `src/api/routes/paymaster.ts` — backend paymaster proxy (reserved for production custom paymasters)
- `src/api/siwe-verify.ts` — SIWE verification with `eoaAddress` fallback (embedded EOA signs; `message.address` is the smart account)

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
- `otp_verification_code_invalid` — wrong code entered
- `otp_verification_expired` — code TTL passed; restart the flow with `signInWithEmail`
- `otp_verification_destination_mismatch` — code was issued to a different email; restart the flow
- `otp_verification_required` / `otp_verification_not_found` / `otp_verification_invalid` — stale or unknown `flowId`; restart the flow
- `policy_violation` — a CDP Portal policy blocked the operation (server-side policy rules govern end-user transactions)
- `rate_limit_exceeded` — back off and retry
- Full server-side error catalog: https://docs.cdp.coinbase.com/api-reference/v2/errors

## UserOperation Lifecycle

Status enum (shared by browser and server SDKs): `pending → signed → broadcast → complete | failed | dropped`.

- Prepared ops **expire** — responses include `expiresAt` (ISO 8601). Flow is prepare → owner signs `userOpHash` → broadcast; the returned status is `broadcast`.
- Coinbase's server-side `waitForUserOperation` treats only `complete`/`failed` as terminal — a `dropped` op polls until timeout there. Our browser poller (`_waitForUserOperationTransaction` in `wallet-cdp.js`) treats both `failed` and `dropped` as terminal — keep it that way.
- Timeouts are ambiguous: Coinbase's `TimeoutError` says the op "may still succeed". Server SDK defaults: 30s timeout, 0.2s poll interval; ours: 60 × 1s. Before retrying a timed-out op, re-check with `getUserOperation()` — blind resubmission can double-execute.
- `calls: []` fails with `Calls array is empty`.

## Paymaster Notes

- Base Sepolia user operations are **gasless by default** (CDP SDK README) — `useCdpPaymaster: true` is the supported path, not a workaround.
- Local dev: `useCdpPaymaster: true` — CDP's bundler must reach the paymaster URL; `localhost` is unreachable from CDP's servers.
- Production custom paymaster: expose the backend proxy (`src/api/routes/paymaster.ts`) on a public absolute HTTPS URL. Custom paymasters must be **ERC-7677** compliant (`paymasterUrl` + optional `paymasterContext`).

## SIWE & Undeployed Smart Accounts

A fresh smart account may be **undeployed** at SIWE time; CDP wraps signatures with **EIP-6492** so they remain verifiable pre-deployment. `siwe-verify.ts` currently verifies against the embedded EOA signature (with the `eoaAddress` fallback), so nothing to change — but if smart-account SIWE verification ever moves on-chain, keep EIP-6492 unwrapping in mind or verification will fail for undeployed accounts.
