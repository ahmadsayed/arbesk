# CDP Email-Login Smart Accounts on Base Sepolia — Design Spec

**Date:** 2026-06-30  
**Author:** Claude Code / Arbesk Agent  
**Status:** Implemented  
**Related plan:** `docs/superpowers/plans/2026-06-30-cdp-email-login-base-plan.md`  
**Related (deprecated):** `docs/superpowers/specs/2026-06-28-thirdweb-aa-design.md`

---

## 1. Problem

Arbesk authenticates users with external EOA wallets (MetaMask, Rabby, WalletConnect). This creates onboarding friction for non-crypto users who do not have a wallet installed. The project previously explored Thirdweb + Google OAuth on MegaETH/Monad, but that path was not carried forward.

We need a simpler, email-based login path that still gives users an on-chain identity and gasless transactions, restricted to the supported public testnet (Base Sepolia).

---

## 2. Solution

Integrate **Coinbase Developer Platform (CDP) Embedded Wallets** with **ERC-4337 smart accounts** on **Base Sepolia**.

- **CDP Embedded Wallet** creates an embedded EOA (signer address `X`) protected by email OTP.
- **CDP Smart Account** wraps that EOA in an ERC-4337 smart account (on-chain actor address `Y`).
- **CDP Paymaster** sponsors gas on Base Sepolia, so users do not need ETH to transact.
- The existing EOA/MetaMask/WalletConnect flow remains untouched.

Both login paths converge on the same downstream wallet code via a thin **EIP-1193 adapter**.

---

## 3. Identity Model

| Address | Symbol | Role |
|---------|--------|------|
| Embedded EOA (email signer) | `X` | Signs SIWE messages and authorizes UserOperations off-chain. |
| ERC-4337 smart account | `Y` | Appears as `msg.sender` on-chain; owns tokens and calls `ArbeskAssetFree`. |

- `X` is never `msg.sender` in contract calls.
- `Y` is the address stored in the Arbesk session, shown in the UI, and used for `balanceOf`, `ownerOf`, and all publishing flows.
- The mapping from `X` to `Y` is managed by the CDP SDK.

---

## 4. Architecture

### 4.1 High-level flow

```
┌─────────────────┐     ┌─────────────────────────┐     ┌─────────────────────────┐
│  Email + OTP    │────▶│  CDP Embedded Wallet    │────▶│  CDP ERC-4337 Smart     │
│                 │     │  (embedded EOA, addr X) │     │  Account (addr Y)       │
└─────────────────┘     └─────────────────────────┘     └───────────┬─────────────┘
                                                                    │
                                                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         EIP-1193 Adapter (wallet-cdp.js)                         │
│  • eth_accounts / eth_requestAccounts  → [Y]                                     │
│  • eth_sendTransaction                 → sendUserOperation → UserOp              │
│  • personal_sign                       → signEvmMessage(eoaAccount, message)     │
│  • eth_call, eth_getBalance, etc.      → forwarded to Base Sepolia RPC           │
└─────────────────────────────────┬───────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         Existing Arbesk wallet path                              │
│  wallet-core.js → wallet-publishing.js / wallet-payments.js (Web3.js unchanged)  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Why an EIP-1193 adapter?

CDP Embedded Wallets expose a custom SDK, not a standard EIP-1193 provider. Arbesk already uses Web3.js pervasively. Rather than rewriting `wallet-core.js`, `wallet-publishing.js`, and `wallet-payments.js`, the adapter translates between CDP's API and the EIP-1193 methods Web3.js expects.

This keeps the diff small and preserves existing wallet logic.

---

## 5. Authentication Flow

### 5.1 SIWE message

```text
example.com wants you to sign in with your Ethereum account:
Y
...
```

- `address` field = `Y` (smart account address).
- Signature is produced by `X` via `personal_sign` on the embedded EOA.

### 5.2 Backend verification

`src/api/siwe-verify.js` uses `viem`'s `verifyMessage`, which handles three cases:

1. **EOA signatures** — `ecrecover` matches `siwe.address`.
2. **EIP-1271 contract signatures** — for deployed smart accounts.
3. **ERC-6492 counterfactual signatures** — for smart accounts that have not been deployed yet.

If viem verification fails and the request body includes `eoaAddress`, the backend falls back to recovering the signer with `web3.eth.accounts.recover(message, signature)` and comparing it to `eoaAddress`. This covers CDP smart accounts whose `isValidSignature` implementation may restrict off-chain verification.

---

## 6. Transaction Flow

1. User clicks **Generate** or **Publish** in the Studio.
2. Web3.js builds the contract call using the existing ABI path.
3. Web3.js sends `eth_sendTransaction` to the EIP-1193 adapter.
4. The adapter calls CDP's `sendUserOperation()` with `network: "base-sepolia"`.
5. CDP constructs a UserOperation, includes paymaster data via `/api/v1/paymaster`, and submits it to the bundler.
6. The bundler sends the UserOperation to the EntryPoint on Base Sepolia.
7. The EntryPoint calls the smart account, which calls `ArbeskAssetFree`.
8. `msg.sender` inside the contract is `Y`.

Gas is sponsored by CDP; the user pays nothing.

---

## 7. Dual Entry Point

The wallet modal continues to show:

- Injected wallets (MetaMask, Rabby, etc.) via EIP-6963.
- WalletConnect v2.
- A new **Email (gasless, Base Sepolia)** section separated visually from EOA options.

Regardless of entry point, after connection the rest of the app sees the same `walletState` shape:

```js
{
  walletAddress: "0xY...", // smart account or EOA
  eoaAddress: "0xX...",     // null for pure EOA wallets
  // ...existing fields
}
```

---

## 8. Chain & SDK Selection

| Item | Value |
|------|-------|
| Target chain | Base Sepolia Testnet |
| Chain ID | 84532 |
| RPC | `https://sepolia.base.org` |
| SDK | `@coinbase/cdp-core` |
| Paymaster | CDP Paymaster on Base Sepolia |

---

## 9. Security Considerations

- `CDP_PAYMASTER_URL` is **never** exposed to the browser. Only `CDP_PROJECT_ID` is served via the public `/api/v1/config` endpoint.
- CSP `connect-src` is expanded to allow `*.cdp.coinbase.com` and `sepolia.base.org`.
- The embedded EOA `X` is used only for signing; `msg.sender` is always `Y`.
- The paymaster proxy returns 503 if `CDP_PAYMASTER_URL` is not configured, preventing accidental exposure of a broken flow.

---

## 10. Non-Goals

This integration explicitly does **not** change:

- Solidity contracts (`ArbeskAssetFree`, `ArbeskAsset`, base contracts).
- IPFS storage layer or manifest schema.
- Existing EOA/MetaMask/WalletConnect flow.
- Session TTL or session binding rules.

---

## 11. Files Affected

| File | Change |
|------|--------|
| `.env.example` | Add `CDP_PROJECT_ID`, `CDP_PAYMASTER_URL`, `CDP_EMAIL_DEV_MODE`. |
| `src/api/index.js` | Expose `cdpProjectId` in `/api/v1/config`; mount `/paymaster`. |
| `src/index.js` | Add CDP/Base domains to CSP. |
| `src/api/routes/paymaster.js` | **NEW** — paymaster proxy. |
| `frontend/src/pug/studio.pug` / `library.pug` | Add `@coinbase/cdp-core` importmap. |
| `frontend/package.json` | Add `@coinbase/cdp-core`; remove `thirdweb`. |
| `frontend/src/js/blockchain/wallet-cdp.js` | **NEW** EIP-1193 adapter. |
| `frontend/src/js/ui/wallet-modal.js` | Add email OTP UI. |
| `frontend/src/js/blockchain/wallet-core.js` | Handle `source === 'cdp'`, store `eoaAddress`. |
| `src/api/siwe-verify.js` | Add `eoaAddress` fallback, viem universal verification. |

**Unchanged:** `wallet-publishing.js`, `wallet-payments.js`, all contracts, all IPFS/manifest code.

---

## 12. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| CDP esm.sh bundle is large | Lazy-load `wallet-cdp.js` only when the email section is used. |
| Smart account not yet deployed | CDP deploys it automatically on the first `eth_sendTransaction`; no extra step. |
| Auto-connect race on reload | Store `'cdp'` in `LAST_WALLET_KEY`; silent restore checks `getCurrentUser()`. |
| `msg.sender` leaks to EOA | Verified false — EntryPoint → SmartAccount → Contract preserves `msg.sender = Y`. |
| CDP SDK version drift | Pin exact version in importmap; update intentionally after testing. |