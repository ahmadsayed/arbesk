# CDP Email-Login Smart Accounts on Base Sepolia — Implementation Plan

**Date:** 2026-06-30  
**Author:** Claude Code / Arbesk Agent  
**Status:** Implemented  
**Design spec:** `docs/superpowers/specs/2026-06-30-cdp-email-login-base-design.md`  
**Related (deprecated):** `docs/superpowers/plans/2026-06-28-thirdweb-aa-plan.md`

> **Historical note:** This plan references separate `studio.pug` / `library.pug` templates. The current frontend uses a unified `frontend/src/pug/app.pug` SPA shell with client-side routing (`frontend/src/js/app/router.js`).

---

## Goal

Add **email-based login** via Coinbase Developer Platform (CDP) Embedded Wallets, creating an ERC-4337 smart account on **Base Sepolia** for gasless transactions. Keep the existing EOA wallet flow (MetaMask/Rabby/WalletConnect) intact on Hardhat local and Base Sepolia.

This replaces the earlier Thirdweb + Google OAuth + MegaETH/Monad experiment, which is preserved as historical reference.

---

## Architecture Recap

```
Email + OTP
    → CDP Embedded Wallet (embedded EOA, address X)
        → CDP ERC-4337 Smart Account (address Y)
            → EIP-1193 Adapter (wallet-cdp.js)
                → new Web3(adapter)
                    → wallet-core.js → wallet-publishing.js / wallet-payments.js
```

- `X` signs SIWE messages and authorizes UserOperations off-chain.
- `Y` is the on-chain actor (`msg.sender`).
- The adapter routes `eth_sendTransaction` to CDP's `sendUserOperation()` and `personal_sign` to the EOA's `signEvmMessage()`.
- Gas is sponsored by the CDP Paymaster, proxied through `/api/v1/paymaster` so the API key stays server-side.

---

## Step 1 — Expose CDP config via `/api/v1/config`

**Files:**
- `.env.example`
- `src/api/index.js`

**Changes:**
1. In `.env.example`, add:
   ```env
   CDP_PROJECT_ID=           # served to frontend
   CDP_PAYMASTER_URL=        # backend only, never served
   CDP_EMAIL_DEV_MODE=       # placeholder for future E2E mock bypass
   ```
2. In `src/api/index.js`, add to the `GET /api/v1/config` response:
   ```js
   cdpProjectId: process.env.CDP_PROJECT_ID || null,
   ```

**Acceptance:**
- `curl localhost:9090/api/v1/config | jq .cdpProjectId` returns the configured project ID.

---

## Step 2 — Load CDP SDK in `studio.pug` / `library.pug`

**Files:**
- `frontend/src/pug/studio.pug`
- `frontend/src/pug/library.pug`

**Changes:**
1. Add `@coinbase/cdp-core` to the importmap (pin exact version, no SRI per CDN policy):
   ```pug
   script(type="importmap").
     {
       "imports": {
         "@coinbase/cdp-core": "https://esm.sh/@coinbase/cdp-core@<version>",
         ... existing imports ...
       }
     }
   ```

**Acceptance:**
- Open browser console and run `import('@coinbase/cdp-core')`; it resolves without error.

---

## Step 3 — Create `wallet-cdp.js` (EIP-1193 Adapter)

**New file:** `frontend/src/js/blockchain/wallet-cdp.js`

**Responsibilities:**
- `initCdpClient(projectId)` — initializes the CDP SDK singleton.
- `requestEmailOtp(email)` — starts the email OTP flow.
- `verifyEmailOtp(flowId, otp)` — completes OTP and resolves `{ eoaAddress, smartAccountAddress }`.
- `autoConnectCdpWallet()` — silent session restore.
- `disconnectCdpWallet()` — signs out and clears state.
- `buildCdpEip1193Provider(eoaAccount, smartAccountAddress)` — returns an EIP-1193 object:
  - `eth_accounts` / `eth_requestAccounts` → `[smartAccountAddress]`
  - `eth_chainId` → `0x14a34` (Base Sepolia)
  - `personal_sign` / `eth_sign` → `signEvmMessage(eoaAccount, message)`
  - `eth_sendTransaction` → `sendUserOperation({ network: "base-sepolia", calls, paymasterUrl: "/api/v1/paymaster" })`
  - everything else → forwarded to `https://sepolia.base.org`
- `signSiweMessageWithCdp(message)` — signs SIWE with the embedded EOA.

**Acceptance:**
- Module loads without error.
- Adapter can be passed to `new Web3(provider)`.
- `eth_accounts` returns the smart account address.

---

## Step 4 — Add Email Option to `wallet-modal.js`

**File:** `frontend/src/js/ui/wallet-modal.js`

**Changes:**
1. Add an email input section above the injected wallet list, labelled "Email (gasless, Base Sepolia)".
2. Flow:
   1. User enters email and clicks **Send code**.
   2. Lazy-import `wallet-cdp.js`, call `initCdpClient(config.cdpProjectId)`, then `requestEmailOtp(email)`.
   3. Show OTP input; on verify call `verifyEmailOtp(flowId, otp)` then `autoConnectCdpWallet()`.
   4. Resolve the modal with `{ provider, source: 'cdp', walletAddress: smartAccountAddress, eoaAddress }`.

**Acceptance:**
- Email section renders in the wallet modal.
- Valid email triggers OTP send; valid OTP connects the smart account.

---

## Step 5 — Handle CDP Source in `wallet-core.js`

**File:** `frontend/src/js/blockchain/wallet-core.js`

**Changes:**
1. In `connectWallet()`, handle `source === 'cdp'`:
   ```js
   } else if (source === 'cdp') {
     web3Provider = provider;
     web3 = newWeb3(provider);
     window.web3 = web3;
     activeConnectionSource = 'cdp';
     localStorage.setItem(LAST_WALLET_KEY, 'cdp');
     await _finishWalletSetup(walletAddress, eoaAddress);
   }
   ```
2. In `autoConnectWallet()`, add silent restore for `'cdp'` via `autoConnectCdpWallet()`.
3. In `_finishWalletSetup()`, store `eoaAddress` alongside `walletAddress`.
4. In `disconnectWallet()`, call `disconnectCdpWallet()` when source is `'cdp'`.
5. Skip the low-ETH balance warning when `activeConnectionSource === 'cdp'` (gasless UserOps).

**Acceptance:**
- CDP connection initializes Web3 with the adapter.
- Wallet state contains both `walletAddress` and `eoaAddress`.
- Disconnect clears CDP state.

---

## Step 6 — SIWE with `eoaAddress` Fallback in `siwe-verify.js`

**File:** `src/api/siwe-verify.js`

**Changes:**
1. Parse the SIWE message with the `siwe` package.
2. Validate domain, version, chain ID, nonce, and issued-at freshness.
3. Verify signature via `viem`'s `verifyMessage`, which handles EOA, EIP-1271, and ERC-6492 counterfactual smart accounts.
4. If viem verification fails and `eoaAddress` is provided in the request body, recover the signer with `web3.eth.accounts.recover(message, signature)` and compare it to `eoaAddress`.
5. On success, bind the session to `siwe.address` (the smart account address).

**Acceptance:**
- Existing SIWE tests still pass.
- `npm run test:api` passes.

---

## Step 7 — Add CDP Paymaster Proxy Route

**File:** `src/api/routes/paymaster.js`

**Changes:**
1. Create `POST /api/v1/paymaster`.
2. Forward JSON-RPC body to `CDP_PAYMASTER_URL`.
3. Return upstream status/body verbatim.
4. Return 503 if `CDP_PAYMASTER_URL` is not configured.

**Acceptance:**
- UserOperations from CDP smart accounts are sponsored.
- API key never reaches the browser.

---

## Step 8 — Update CSP in `src/index.js`

**File:** `src/index.js`

**Changes:**
1. Add to `connectSrc`:
   ```js
   "https://api.cdp.coinbase.com",
   "https://*.cdp.coinbase.com",
   "https://sepolia.base.org",
   ```
2. Remove old Thirdweb/MegaETH/Monad entries.

**Acceptance:**
- No CSP violations when loading Studio or initiating email login.

---

## Step 9 — Collapse Chain Support to Hardhat + Base Sepolia

**Files:**
- `constants/chains.js`
- `frontend/src/js/blockchain/network-config.js`
- `src/config.js`
- `blockchain/hardhat.config.js`
- `blockchain/scripts/deploy.js`

**Changes:**
1. Remove MegaETH and Monad chain IDs.
2. Keep Hardhat local (`31415822`) and Base Sepolia (`84532`).
3. Update `DEPLOYMENT_BLOCKS` and `LOG_CHUNK_SIZES` to match.
4. Remove MegaETH/Monad networks from Hardhat config.

**Acceptance:**
- No magic numbers for removed chains.
- `SUPPORTED_CHAIN_IDS` only contains Hardhat and Base Sepolia.

---

## Testing Plan

| Step | Command |
|------|---------|
| After Steps 1–9 | `npm test` |
| After Step 6 | `npm run test:api` |
| After frontend changes | `npm run typecheck:frontend` |
| Manual | Open Studio → Connect Wallet → enter email → OTP → SIWE approve → generate/publish as UserOperation. |
| Regression | Connect MetaMask and verify existing EOA flow unchanged. |

---

## Key Files Modified

| File | Change |
|------|--------|
| `.env.example` | + `CDP_PROJECT_ID`, `CDP_PAYMASTER_URL`, `CDP_EMAIL_DEV_MODE`; removed Thirdweb vars |
| `src/api/index.js` | + `cdpProjectId` in config response; + `/paymaster` route |
| `src/index.js` | + CDP/Base domains in CSP |
| `src/api/routes/paymaster.js` | **NEW** — paymaster proxy |
| `frontend/src/pug/studio.pug` / `library.pug` | + `@coinbase/cdp-core` importmap |
| `frontend/package.json` | + `@coinbase/cdp-core`; removed `thirdweb` |
| `frontend/src/js/blockchain/wallet-cdp.js` | **NEW** — EIP-1193 adapter |
| `frontend/src/js/ui/wallet-modal.js` | + email OTP UI |
| `frontend/src/js/blockchain/wallet-core.js` | + `cdp` source handling, `eoaAddress` |
| `src/api/siwe-verify.js` | + `eoaAddress` fallback, viem universal verification |
| `constants/chains.js` | Collapsed to Hardhat + Base Sepolia |

**Unchanged:** Solidity contracts, IPFS/manifest code, Nostr comments, library page.

---

## Definition of Done

- All 9 steps implemented.
- Plan and design spec docs written.
- `npm test` and `npm run test:api` pass.
- `npm run typecheck:frontend` passes.
- Manual CDP email OTP + sponsored transaction flow verified on Base Sepolia.
- Existing MetaMask regression path verified.
