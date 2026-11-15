---
name: cdp-base-wallet
description: Use for CDP/Base email-login smart wallet work — "CDP email login", "smart wallet", Base Sepolia ERC-4337 accounts, "EVM account not found", UserOperation/paymaster errors, SIWE signing, or any wallet-cdp.js bug. When you see a CDP wallet error, invoke this skill immediately.
---

# CDP Base Wallet

Email login creates an embedded EOA plus an ERC-4337 smart account, on Base Sepolia only. Browser side: `frontend/src/js/blockchain/wallet-cdp.ts` (SDK wrapper and native `Signer`). Publish, update and burn for CDP sessions go through the backend relay (`wallet-publishing.ts` `_relayForCdp` → `src/api/routes/wallet-relay.ts` → `src/api/cdp-signer.ts`); payments are sent from the browser.

## Symptoms

| Symptom | Cause and fix |
|---|---|
| `EVM account not found` on SIWE signing | `signEvmMessage` wants the address **string**: pass `eoaAccount.address`, not the account object. If it still fails, the CDP Portal product or Base Sepolia is not enabled. |
| `must be a valid HTTP or HTTPS URL with at least 11 characters` | `paymasterUrl` is relative or malformed. Local dev uses `useCdpPaymaster: true`. |
| `POST https://sepolia.base.org/ 403` | That RPC blocks browser origins. The browser uses `https://base-sepolia-rpc.publicnode.com` (already in the CSP). |
| Last on-chain step hangs after the tx landed | Something waits for `status === "complete"`, which lags the block. Return as soon as `transactionHash` is set. |
| UserOperation times out with no error | Prepared ops expire (`expiresAt`). Re-check `getUserOperation()` before retrying: the op may still land, and a blind resend can execute twice. |
| OTP rejected (`otp_verification_expired`, `_code_invalid`, `_destination_mismatch`, `_not_found`) | Codes are single-use and bound to one flow. Restart with `signInWithEmail`. |
| `User is already authenticated` | Stale CDP session. Clear CDP/coinbase keys in localStorage, IndexedDB and cookies, call `disconnectCdpWallet()`, then start the OTP flow (`ui/wallet-modal.ts` does this). |
| Network or CORS error on `api.cdp.coinbase.com` | Origin missing in CDP Portal → Non-custodial Wallet → Clients. |
| `policy_violation` | A CDP Portal policy blocked the operation. |

## Rules

1. Gate smart-account features with `isSmartWalletSupported(chainId)` (`smart-wallet-support.ts`).
2. Never show a UserOperation hash as a transaction hash. Both pollers (browser `wallet-cdp.ts`, server `cdp-signer.ts`) return the real `transactionHash` once it is set.
3. UserOperation statuses: `pending → signed → broadcast → complete | failed | dropped`. Treat `failed` and `dropped` as terminal. Coinbase's own `waitForUserOperation` does not stop on `dropped`.
4. Base Sepolia operations are gasless through `useCdpPaymaster: true`. A custom paymaster must be ERC-7677 and reachable on a public HTTPS URL, because CDP's bundler cannot reach `localhost`. `src/api/routes/paymaster.ts` is the proxy for that case.
5. SIWE: the embedded EOA signs, `message.address` is the smart account, and the request carries `eoaAddress` (verifier in `packages/wallet/src/verify.ts`). A new smart account may be undeployed; CDP wraps its signatures with EIP-6492. If verification ever moves on-chain, unwrap them.

## Configuration

- Root `.env`: `CDP_PROJECT_ID` (served to the browser by `/api/v1/config`), `CDP_API_KEY_ID`/`SECRET` (relay), `CDP_PAYMASTER_URL` (proxy mode only).
- CDP Portal: Embedded Wallet product active, Base Sepolia paymaster configured, every origin listed under Clients.
- Full server error list: https://docs.cdp.coinbase.com/api-reference/v2/errors
