# Thirdweb Account Abstraction (AA) Integration — Implementation Plan

> **DEPRECATED — Historical Reference Only**
>
> This document describes the Thirdweb + Google OAuth + MegaETH/Monad account-abstraction path that was explored and then replaced by **CDP email-login smart accounts on Base Sepolia**. The implementation details below are no longer current and the files/modules they reference (`wallet-thirdweb.js`, `thirdweb-auth.js`, MegaETH/Monad chain configs) have been removed from the codebase.
>
> For the active plan, see `docs/superpowers/plans/2026-06-30-cdp-email-login-base-plan.md`.

**Date:** 2026-06-28  
**Author:** Claude Code / Arbesk Agent  
**Status:** Deprecated — superseded by CDP/Base email-login  
**Design spec:** `docs/superpowers/specs/2026-06-28-thirdweb-aa-design.md` (also deprecated)

---

## Goal

Add Google OAuth login via Thirdweb In-App Wallets + ERC-4337 smart accounts with sponsored gas on MegaETH Testnet, while keeping the existing EOA wallet flow intact.

---

## Architecture Recap

```
Google OAuth
    → Thirdweb inAppWallet (embedded EOA, address X)
        → Thirdweb smartWallet (smart account, address Y)
            → EIP-1193 Adapter (wallet-thirdweb.js)
                → new Web3(adapter)
                    → wallet-core.js → wallet-publishing.js / wallet-payments.js
```

- `X` signs SIWE messages.
- `Y` is the on-chain actor (`msg.sender`).
- The adapter routes `eth_sendTransaction` to Thirdweb's `sendTransaction()` and `personal_sign` to the EOA's `signMessage()`.

---

## Step 1 — Expose `THIRDWEB_CLIENT_ID` via config endpoint

**Files:**
- `.env.example`
- `src/api/index.js`

**Changes:**
1. In `.env.example`, add:
   ```env
   THIRDWEB_CLIENT_ID=      # served to frontend
   THIRDWEB_SECRET_KEY=     # backend only, never served
   ```
2. In `src/api/index.js`, add to the `GET /api/v1/config` response:
   ```js
   thirdwebClientId: process.env.THIRDWEB_CLIENT_ID || null,
   ```

**Acceptance:**
- `curl localhost:9090/api/v1/config | jq .thirdwebClientId` returns the configured Client ID.

---

## Step 2 — Load Thirdweb SDK v5 in `studio.pug`

**File:** `frontend/src/pug/studio.pug`

**Changes:**
1. Add Thirdweb v5 to the existing importmap (consistent with `@gltf-transform`, `pako`, etc.):
   ```pug
   script(type="importmap").
     {
       "imports": {
         "thirdweb": "https://esm.sh/thirdweb@5",
         "thirdweb/wallets": "https://esm.sh/thirdweb@5/wallets",
         "thirdweb/wallets/in-app": "https://esm.sh/thirdweb@5/wallets/in-app",
         ... existing imports ...
       }
     }
   ```
2. No `integrity` attribute (per CDN policy: pin version in URL, omit SRI).

**Acceptance:**
- Open browser console in Studio and run `import('thirdweb')`; it resolves without error.

---

## Step 3 — Create `wallet-thirdweb.js` (EIP-1193 Adapter)

**New file:** `frontend/src/js/blockchain/wallet-thirdweb.js`

**Responsibilities:**
- `initThirdwebClient(clientId)` — creates a Thirdweb client singleton.
- `connectGoogleWallet(client)` — triggers Google OAuth and returns:
  ```js
  { eoaAddress, smartAccountAddress, provider }
  ```
- `disconnectThirdwebWallet()` — clears adapter state.
- `createEip1193Adapter(smartAccount, eoaAccount, chain)` — returns an object implementing:
  - `request({ method, params })` — EIP-1193 interface.
  - `on(event, handler)` / `removeListener(event, handler)` — event emitter shim.
- `isThirdwebConnected()` — returns true if a Thirdweb session is active.

**Internal routing:**
- `eth_accounts` / `eth_requestAccounts` → `[smartAccountAddress]`.
- `eth_sendTransaction` → Thirdweb `sendTransaction()` (UserOperation, sponsored).
- `personal_sign` → EOA account's `signMessage()`.
- Read calls (`eth_chainId`, `eth_call`, `eth_getBalance`, etc.) → forwarded to MegaETH RPC.

**Chain config:**
```js
import { defineChain } from "thirdweb/chains";
const megaethTestnet = defineChain({
  id: 6343,
  rpc: "https://carrot.megaeth.com/rpc",
});
```

**Acceptance:**
- Module loads without error.
- Adapter can be passed to `new Web3(provider)`.
- `eth_accounts` returns the smart account address.

---

## Step 4 — Add Google option to `wallet-modal.js`

**File:** `frontend/src/js/ui/wallet-modal.js`

**Changes:**
1. Add a "Sign in with Google" button, visually separated from injected wallets (follow existing GNOME HIG modal styling).
2. When clicked:
   1. Lazy-import `wallet-thirdweb.js`.
   2. Call `initThirdwebClient(config.thirdwebClientId)`.
   3. Call `connectGoogleWallet(client)`.
   4. Resolve the modal with:
      ```js
      { provider: eip1193Adapter, source: 'thirdweb', walletAddress: smartAccountAddress, eoaAddress }
      ```

**Acceptance:**
- Button renders in the wallet modal.
- Clicking it triggers Google OAuth and returns the expected result shape.

---

## Step 5 — Handle Thirdweb source in `wallet-core.js`

**File:** `frontend/src/js/blockchain/wallet-core.js`

**Changes:**
1. In `connectWallet()`, handle `source === 'thirdweb'`:
   ```js
   } else if (source === 'thirdweb') {
     web3Provider = provider;
     web3 = new Web3(provider);
     activeConnectionSource = 'thirdweb';
     localStorage.setItem(LAST_WALLET_KEY, 'thirdweb');
     await _finishWalletSetup(walletAddress);
   }
   ```
2. In `autoConnectWallet()`, add silent restore logic for `'thirdweb'` (check Thirdweb session state).
3. In `_finishWalletSetup()`, store `eoaAddress` alongside `walletAddress`:
   ```js
   walletState.set({ walletAddress: address, eoaAddress: result.eoaAddress || address });
   ```
4. In `disconnectWallet()`, call `disconnectThirdwebWallet()` when source is `'thirdweb'`.
5. In `authenticateUser()` / SIWE signing:
   - Use `eoaAddress` from `walletState` for `personal_sign`.
   - Set SIWE `address` field to `walletAddress` (smart account).

**Acceptance:**
- Thirdweb connection initializes Web3 with the adapter.
- Wallet state contains both `walletAddress` and `eoaAddress`.
- Disconnect clears Thirdweb state.

---

## Step 6 — Add EIP-1271 support in `siwe-verify.js`

**File:** `src/api/siwe-verify.js`

**Changes:**
1. Keep existing `ecrecover` path for EOA wallets.
2. Add fallback:
   ```
   try ecrecover(sig) → recovered address
   if recovered === siwe.address → valid
   else if siwe.address is a contract (eth_getCode != '0x'):
       call siwe.address.isValidSignature(hash, sig)
       if returns 0x1626ba7e → valid
   else → invalid
   ```
3. Use MegaETH RPC (`process.env.HARDHAT_RPC_URL` or a dedicated `MEGAETH_RPC_URL`) for the `isValidSignature` call.
4. Skip EIP-1271 on Hardhat local chain (chainId 31415822) if needed.

**Acceptance:**
- Existing SIWE tests still pass.
- `npm run test:api` passes.

---

## Step 7 — Update CSP in `src/index.js`

**File:** `src/index.js`

**Changes:**
1. Add to `connectSrc`:
   ```js
   "https://*.thirdweb.com",
   "https://*.bundler.thirdweb.com",
   ```
2. Ensure `https://esm.sh` is in `connectSrc` and `scriptSrc`.

**Acceptance:**
- Helmet CSP allows Thirdweb domains.
- No CSP violations in browser console when loading Studio.

---

## Step 8 — Update `walletState` schema

**File:** `frontend/src/js/state/wallet-state.js`

**Changes:**
1. Add `eoaAddress: null` to the initial state.

**Acceptance:**
- TypeScript typecheck passes (`npm run typecheck:frontend`).

---

## Testing Plan

| Step | Command |
|------|---------|
| After Steps 1–8 | `npm test` |
| After Step 6 | `npm run test:api` |
| After frontend changes | `npm run typecheck:frontend` |
| Manual | Open Studio, click Connect Wallet → Sign in with Google → OAuth → SIWE approve → generate/publish as UserOperation. |
| Regression | Connect MetaMask and verify existing flow unchanged. |

---

## Key Files Modified

| File | Change |
|------|--------|
| `.env.example` | + `THIRDWEB_CLIENT_ID`, `THIRDWEB_SECRET_KEY` |
| `src/api/index.js` | + `thirdwebClientId` in config response |
| `src/index.js` | + Thirdweb domains in CSP |
| `frontend/src/pug/studio.pug` | + Thirdweb importmap entries |
| `frontend/package.json` | + `thirdweb@5` devDependency for Jest resolution |
| `frontend/src/js/blockchain/wallet-thirdweb.js` | **NEW** — EIP-1193 adapter |
| `frontend/src/js/ui/wallet-modal.js` | + Google sign-in button |
| `frontend/src/js/blockchain/wallet-core.js` | + `thirdweb` source handling, `eoaAddress` |
| `frontend/src/js/state/wallet-state.js` | + `eoaAddress` field |
| `src/api/siwe-verify.js` | + EIP-1271 fallback |

**Unchanged:** `wallet-publishing.js`, `wallet-payments.js`, `wallet-network.js`, all contracts, all IPFS/manifest code.

---

## Definition of Done

- All 8 steps implemented.
- Design spec and implementation plan docs written.
- `npm test` and `npm run test:api` pass.
- `npm run typecheck:frontend` passes.
- Manual Google OAuth + sponsored transaction flow verified on MegaETH Testnet.
- Existing MetaMask regression path verified.
