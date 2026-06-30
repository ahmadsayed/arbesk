# Thirdweb Account Abstraction (AA) Integration — Design Spec

> **DEPRECATED — Historical Reference Only**
>
> This document describes the Thirdweb + Google OAuth + MegaETH/Monad account-abstraction path that was explored and then replaced by **CDP email-login smart accounts on Base Sepolia**. The architecture and files referenced below (`wallet-thirdweb.js`, `thirdweb-auth.js`, MegaETH/Monad chain configs) are no longer active in the codebase.
>
> For the current design, see `docs/superpowers/specs/2026-06-30-cdp-email-login-base-design.md`.

**Date:** 2026-06-28  
**Author:** Claude Code / Arbesk Agent  
**Status:** Deprecated — superseded by CDP/Base email-login  
**Related plan:** `docs/superpowers/plans/2026-06-28-thirdweb-aa-plan.md` (also deprecated)

---

## 1. Problem

Arbesk currently authenticates users exclusively with external EOA wallets (MetaMask, WalletConnect via EIP-6963 + WalletConnect v2). This creates two onboarding barriers:

1. **Non-crypto users cannot participate** without first installing a browser extension or mobile wallet.
2. **Gas requirements add friction** — every `recordGeneration`, `publishAsset`, or `updateAssetURI` call requires the user to hold and spend ETH for gas on MegaETH Testnet.

These barriers block the primary goal of making 4D asset publishing accessible to creators who are not already web3-native.

---

## 2. Solution

Integrate **Thirdweb In-App Wallets** and **ERC-4337 smart accounts** to offer a Google OAuth login path with **sponsored gas**.

- **Thirdweb In-App Wallet** creates an embedded EOA (signer address `X`) protected by Google OAuth.
- **Thirdweb Smart Wallet** wraps that EOA in an ERC-4337 smart account (on-chain actor address `Y`).
- **Thirdweb paymaster** sponsors gas on MegaETH Testnet, so users do not need ETH to transact.
- The existing MetaMask / WalletConnect flow remains untouched.

Both login paths converge on the same downstream wallet code via a thin **EIP-1193 adapter**.

---

## 3. Identity Model

| Address | Symbol | Role |
|---------|--------|------|
| Embedded EOA (Google signer) | `X` | Signs SIWE messages and authorizes UserOperations off-chain. |
| ERC-4337 smart account | `Y` | Appears as `msg.sender` on-chain; owns tokens and calls ArbeskAssetFree. |

- `X` is never `msg.sender` in contract calls.
- `Y` is the address stored in the Arbesk session, shown in the UI, and used for `balanceOf`, `ownerOf`, and all publishing flows.
- The mapping from `X` to `Y` is deterministic per Thirdweb smart-wallet factory.

---

## 4. Architecture

### 4.1 High-level flow

```
┌─────────────────┐     ┌─────────────────────────┐     ┌─────────────────────────┐
│  Google OAuth   │────▶│  Thirdweb inAppWallet   │────▶│  Thirdweb smartWallet   │
└─────────────────┘     │  (embedded EOA, addr X) │     │  (smart account, addr Y)│
                        └─────────────────────────┘     └───────────┬─────────────┘
                                                                    │
                                                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         EIP-1193 Adapter (wallet-thirdweb.js)                    │
│  • eth_accounts / eth_requestAccounts  → [Y]                                     │
│  • eth_sendTransaction                 → Thirdweb sendTransaction() → UserOp     │
│  • personal_sign                       → signMessage() on EOA X                  │
│  • eth_call, eth_getBalance, etc.      → forwarded to MegaETH RPC                │
└─────────────────────────────────┬───────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         Existing Arbesk wallet path                              │
│  wallet-core.js → wallet-publishing.js / wallet-payments.js (Web3.js unchanged)  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Why an EIP-1193 adapter?

Thirdweb v5 does not expose a standard EIP-1193 provider for smart accounts; it uses its own `Account` / `Wallet` abstraction. Arbesk already uses Web3.js pervasively. Rather than rewriting `wallet-core.js`, `wallet-publishing.js`, and `wallet-payments.js`, the adapter translates between Thirdweb's API and the EIP-1193 methods Web3.js expects.

This keeps the diff small and preserves existing wallet logic.

---

## 5. Authentication Flow

### 5.1 SIWE message

```text
domain wants you to sign in with your Ethereum account:
Y
...
```

- `address` field = `Y` (smart account address).
- Signature is produced by `X` via `personal_sign` on the Thirdweb EOA.

### 5.2 Backend verification

`src/api/siwe-verify.js` currently recovers the signer via `ecrecover` and compares it to the SIWE `address` field. For smart accounts this fails because the recovered signer is `X`, not `Y`.

Add an **EIP-1271 fallback**:

1. Try `ecrecover`. If recovered address equals `siwe.address`, accept (existing EOA path).
2. If not, check whether `siwe.address` is a contract (`eth_getCode != 0x`).
3. If it is a contract, call `isValidSignature(messageHash, signature)` on `siwe.address`.
4. If the return value is `0x1626ba7e`, accept.
5. Otherwise reject.

On Hardhat local chain (chainId 31415822), EIP-1271 is skipped because smart accounts are not deployed there; verification falls through to the existing EOA path.

---

## 6. Transaction Flow

1. User clicks **Generate** or **Publish** in the Studio.
2. Web3.js builds the contract call using the existing ABI path.
3. Web3.js sends `eth_sendTransaction` to the EIP-1193 adapter.
4. The adapter calls Thirdweb's `sendTransaction()` with the smart account.
5. Thirdweb constructs a UserOperation, includes paymaster data, and submits it to the Thirdweb bundler.
6. The bundler sends the UserOperation to the EntryPoint on MegaETH Testnet.
7. The EntryPoint calls the smart account, which calls `ArbeskAssetFree`.
8. `msg.sender` inside the contract is `Y`.

Gas is sponsored by Thirdweb; the user pays nothing.

---

## 7. Dual Entry Point

The wallet modal continues to show:

- Injected wallets (MetaMask, Rabby, etc.) via EIP-6963.
- WalletConnect v2.
- A new **"Sign in with Google"** button separated visually from EOA options.

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
| Target chain | MegaETH Testnet |
| Chain ID | 6343 |
| RPC | `https://carrot.megaeth.com/rpc` |
| Thirdweb SDK | v5 (vanilla JS, no React) |
| Paymaster | Thirdweb sponsored gas on MegaETH Testnet |

Thirdweb chain config:

```js
import { defineChain } from "thirdweb/chains";
const megaethTestnet = defineChain({
  id: 6343,
  rpc: "https://carrot.megaeth.com/rpc",
});
```

---

## 9. Security Considerations

- `THIRDWEB_SECRET_KEY` is **never** exposed to the browser. Only `THIRDWEB_CLIENT_ID` is served via the public `/api/v1/config` endpoint.
- CSP `connect-src` is expanded to allow `*.thirdweb.com` and `*.bundler.thirdweb.com`.
- EIP-1271 verification runs only on MegaETH Testnet; local Hardhat dev remains on the EOA path.
- The embedded EOA `X` is used only for signing; `msg.sender` is always `Y`.

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
| `.env.example` | Add `THIRDWEB_CLIENT_ID`, `THIRDWEB_SECRET_KEY`. |
| `src/api/index.js` | Expose `thirdwebClientId` in `/api/v1/config`. |
| `src/index.js` | Add Thirdweb domains to CSP. |
| `frontend/src/pug/studio.pug` | Add Thirdweb v5 importmap entries. |
| `frontend/package.json` | Add `thirdweb@5` devDependency for Jest resolution. |
| `frontend/src/js/blockchain/wallet-thirdweb.js` | **New** EIP-1193 adapter. |
| `frontend/src/js/ui/wallet-modal.js` | Add Google sign-in button. |
| `frontend/src/js/blockchain/wallet-core.js` | Handle `source === 'thirdweb'`, store `eoaAddress`. |
| `frontend/src/js/state/wallet-state.js` | Add `eoaAddress` field. |
| `src/api/siwe-verify.js` | Add EIP-1271 fallback. |

**Unchanged:** `wallet-publishing.js`, `wallet-payments.js`, `wallet-network.js`, all contracts, all IPFS/manifest code.

---

## 12. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Thirdweb esm.sh bundle is large | Lazy-load `wallet-thirdweb.js` only when the Google button is clicked. |
| EIP-1271 call fails on Hardhat | Skip EIP-1271 on chainId 31415822; apply only on MegaETH. |
| Smart account not yet deployed | Thirdweb deploys it automatically on the first `eth_sendTransaction`; no extra step. |
| Auto-connect race on reload | Store `'thirdweb'` in `LAST_WALLET_KEY`; silent restore checks Thirdweb session state. |
| `msg.sender` leaks to EOA | Verified false — EntryPoint → SmartAccount → Contract preserves `msg.sender = Y`. |

---

## 13. Acceptance Criteria

- [ ] `curl localhost:9090/api/v1/config | jq .thirdwebClientId` returns the configured Client ID.
- [ ] Studio shows a "Sign in with Google" button in the wallet modal.
- [ ] Clicking it triggers Google OAuth and connects a smart account address.
- [ ] SIWE message is signed by the embedded EOA but its `address` field is the smart account.
- [ ] Backend SIWE verification succeeds via EIP-1271 on MegaETH Testnet.
- [ ] `recordGeneration` / `publishAsset` transactions are sent as sponsored UserOperations.
- [ ] Existing MetaMask flow continues to work unchanged.
- [ ] `npm test` and `npm run test:api` pass after implementation.
