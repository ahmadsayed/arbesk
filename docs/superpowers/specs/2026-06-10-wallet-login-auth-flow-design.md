# Wallet Login Auth Flow Redesign

**Date:** 2026-06-10  
**Status:** Approved — ready for implementation plan  
**Scope:** Frontend only (backend requires no changes)

> **Implemented as:** Wallet lifecycle and eager SIWE auth live in `frontend/src/js/blockchain/wallet-core.js` (re-exported through `frontend/src/js/blockchain/wallet.js`). State is kept in `frontend/src/js/state/wallet-state.js`, not on `window.*` globals. Auth events are emitted via the event bus (`EVENTS.USER_AUTHENTICATED` / `EVENTS.USER_AUTH_REQUIRED`) rather than `document.dispatchEvent`. The current generation flow uses the free/mock tier and does not require a USDC payment popup; `create-panel.js` calls `getOrCreateSession()` before `generateAsset({ txHash: null })`.

---

## 1. Problem Statement

Today, a new user connecting MetaMask experiences:

1. **Connect Wallet** → 1 popup (account selection)
2. **First Generate** → 2 transaction popups (USDC approve + pay) + 1 signing popup (SIWE) = **3 popups**

The signing popup feels like a surprise because it appears *after* the user has already approved two transactions. It also means the first generation requires **4 total popups** (1 connect + 3 generate).

### Goal

Move the SIWE signing into the wallet connection flow so that:

- **Happy path:** Connect + Sign at login → only 2 transaction popups for every generation
- **Fallback path:** If user skips sign at login, the sign popup appears **before** (not after) the transaction popups on first generation

---

## 2. State Model

Separate **wallet state** from **auth state**:

| Wallet State | Auth State | Meaning |
|---|---|---|
| `disconnected` | — | No wallet connected |
| `connected` | `unauthenticated` | Wallet connected, user has not signed SIWE |
| `connected` | `authenticated` | Wallet connected, valid session token cached in `localStorage` |

### Events

| Event | Fires When |
|---|---|
| `wallet:connected` | Wallet address is available after `eth_requestAccounts` |
| `user:authenticated` | Valid session token is obtained and cached |
| `user:auth-required` | A protected action is attempted while in `unauthenticated` state |

---

## 3. Happy Path Flow

```
User clicks "Connect Wallet"
  └── showWalletModal() → user selects MetaMask
      └── eth_requestAccounts → account selected
          └── _finishWalletSetup(address)
              ├── dispatch wallet:connected
              └── NEW: authenticateUser()
                  └── getOrCreateSession()
                      └── createSession() → SIWE sign popup
                          └── session cached in localStorage ("arbesk_session")
                              └── dispatch user:authenticated

Later: user clicks Generate
  └── onGenerate()
      ├── getOrCreateSession() → cache hit, no popup
      └── generateAsset({ prompt, nodeId, txHash: null })
          └── POST /generations with Authorization: Session <token>
```

**Result:** 1 popup at login (wallet account selection) + 1 SIWE sign popup; no on-chain payment popups in the current free/mock generation flow.

---

## 4. Fallback Path (User Rejected Sign at Login)

```
User clicks "Connect Wallet"
  └── ...same as happy path...
      └── authenticateUser() → user rejects sign
          └── catch rejection
              └── dispatch user:auth-required
                  └── UI shows "Sign In" indicator in topbar

Later: user clicks Generate
  └── onGenerate()
      ├── getOrCreateSession() → cache miss → createSession()
          └── SIWE sign popup FIRST
      └── generateAsset({ prompt, nodeId, txHash: null })
          └── POST /generations with Authorization: Session <token>
```

**Result:** 2 popups on first generation, ordered correctly — **auth before generation**. The current free/mock flow does not add a USDC approve/pay step.

---

## 5. The Ordering Rule

Currently, the caller (`create-panel.js`) may call `generateAsset()` before ensuring a valid session exists. This means the SIWE sign popup can appear after other prompts.

The fix is to ensure auth happens **before** generation in the caller:

```js
// In create-panel.js onGenerate()

// 1. AUTH FIRST
await getOrCreateSession(); // triggers sign if no valid cache

// 2. THEN GENERATION
const result = await generateAsset({ prompt, nodeId, txHash: null, ... });
```

`generateAsset()` already calls `getOrCreateSession()` internally for self-contained auth, but by calling it explicitly beforehand, the sign popup (if needed) appears before any provider or generation request.

> **Implemented as:** The production generation flow is free/mock tier and does not use `payForGenerationWithUSDC()`. `create-panel.js` calls `getOrCreateSession()` and then `generateAsset({ txHash: null })`.

---

## 6. Frontend Changes

### 6.1 `frontend/src/js/blockchain/wallet-core.js`

After `_finishWalletSetup(address)`:

1. Store `walletAddress` and `chainId` in `walletState` (existing)
2. Initialize contract and check balance (existing)
3. **NEW:** Call `authenticateUser()` non-blocking

```js
import { emit, EVENTS } from "../events/bus.js";
import { walletState } from "../state/wallet-state.js";

async function authenticateUser() {
  try {
    const { getOrCreateSession } = await import("../services/api.js");
    const session = await getOrCreateSession();
    emit(EVENTS.USER_AUTHENTICATED, {
      address: walletState.get().walletAddress,
      session,
    });
  } catch (err) {
    // User rejected sign or other error
    emit(EVENTS.USER_AUTH_REQUIRED, {
      address: walletState.get().walletAddress,
    });
  }
}
```

> **Note:** `wallet.js` is now a re-export barrel; add or import `authenticateUser` via `frontend/src/js/blockchain/wallet-core.js`.

### 6.2 `frontend/src/js/ui/create-panel.js`

**`onGenerate()`** — add auth before generation:

```js
async function onGenerate() {
  // ...existing validation...

  // NEW: ensure auth before generation so sign popup comes first
  try {
    await getOrCreateSession();
  } catch (err) {
    // User rejected sign — abort generation gracefully
    setGenerating(false);
    showToast({ type: "warning", title: "Sign In Required", message: "Sign in to generate assets." });
    return;
  }

  const result = await generateAsset({ prompt, nodeId, txHash: null, ... });
  // ...rest of generation flow
}
```

### 6.3 `frontend/src/js/services/api.js`

**`getOrCreateSession()`** — logic stays the same, but must be exported:
- Check `localStorage` cache (with 60s grace period)
- If valid and matching current wallet → return cached session
- If missing, expired, or wallet mismatch → call `createSession()`

Add `export` keyword so `wallet.js` and `create-panel.js` can import it directly.

### 6.4 `frontend/src/js/engine/studio-init.js` (wallet button UI)

| State | UI |
|---|---|
| Disconnected | "Connect Wallet" button |
| Connected + Authenticated | Truncated wallet address (e.g., `0xabc…1234`) |
| Connected + Unauthenticated | Truncated wallet address + "Sign In" badge/indicator |

Update the `wallet:connected` listener to check auth state, and add new listeners for `user:authenticated` and `user:auth-required`. The current code uses the event bus rather than `document.addEventListener`:

```js
import { on, EVENTS } from "../events/bus.js";
import { getCachedSession } from "/js/services/api.js";

on(EVENTS.WALLET_CONNECTED, (e) => {
  // ...existing show/hide logic...
  // NEW: check if we have a cached session
  const cached = getCachedSession();
  const isAuth = cached && cached.address === e?.address?.toLowerCase();
  updateWalletButtonState(e?.address, isAuth);
});

on(EVENTS.USER_AUTHENTICATED, (e) => {
  updateWalletButtonState(e?.address, true);
});

on(EVENTS.USER_AUTH_REQUIRED, (e) => {
  updateWalletButtonState(e?.address, false);
});
```

---

## 7. Backend Changes

**None.**

The existing endpoints already support this:
- `POST /api/v1/sessions` — creates session from SIWE message + signature
- `DELETE /api/v1/sessions` — invalidates session (logout)
- Auth middleware — accepts `Authorization: Session <token>`
- `generateAsset()` in `api.js` already uses session auth

---

## 8. Future Google Login

The `authenticateUser()` function becomes a provider dispatcher:

```js
async function authenticateUser(provider = 'web3') {
  if (provider === 'web3') {
    return getOrCreateSession(); // SIWE flow
  }
  if (provider === 'google') {
    return loginWithGoogle();    // Future OAuth → server session token
  }
}
```

- Session token format stays identical (opaque UUID from backend)
- Backend is auth-provider-agnostic
- UI can show "Login with MetaMask" and "Login with Google" in the same modal

---

## 9. Error Handling

| Scenario | Behavior |
|---|---|
| User rejects sign at login | Stay in `connected + unauthenticated`, show "Sign In" badge |
| User rejects sign at generation | `generateAsset()` aborts gracefully, toast: "Sign in to generate assets" |
| Session expires (24h TTL) | Next `getOrCreateSession()` auto-creates a new one inline |
| Wallet disconnect | Clear `localStorage` session cache, reset to `disconnected` |
| Server restart (session lost) | Backend returns 401, frontend auto-retries `createSession()` once |
| Wallet switched in MetaMask | `getOrCreateSession()` detects mismatch, creates new session for new address |

---

## 10. Files to Modify

| File | Change |
|---|---|
| `frontend/src/js/blockchain/wallet-core.js` | Add `authenticateUser()`, call it from `_finishWalletSetup()`; `wallet.js` re-exports it |
| `frontend/src/js/ui/create-panel.js` | Call `getOrCreateSession()` before `generateAsset()` |
| `frontend/src/js/engine/studio-init.js` | Add `EVENTS.USER_AUTHENTICATED` / `EVENTS.USER_AUTH_REQUIRED` listeners, update wallet button UI |
| `frontend/src/js/ui/wallet-popover.js` | Add "Sign In" action to popover for unauthenticated state |

---

## 11. Out of Scope

- Google OAuth implementation (architecture only)
- Backend changes (none required)
- Session token format changes
- New session routes or endpoints
- Contract or blockchain changes
