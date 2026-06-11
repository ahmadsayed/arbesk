# Wallet Login Auth Flow Redesign

**Date:** 2026-06-10  
**Status:** Approved — ready for implementation plan  
**Scope:** Frontend only (backend requires no changes)

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
  └── generateAsset()
      ├── getOrCreateSession() → cache hit, no popup
      └── payWithUSDC() → approve → pay (2 popups)
          └── POST /generations with Authorization: Session <token>
```

**Result:** 2 popups at login, 2 popups at every generation.

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
  └── generateAsset()
      ├── getOrCreateSession() → cache miss → createSession()
          └── SIWE sign popup FIRST
      └── payWithUSDC() → approve → pay (2 popups)
          └── POST /generations with Authorization: Session <token>
```

**Result:** 3 popups on first generation, but ordered correctly — **auth before money**.

---

## 5. The Ordering Rule

Currently, the caller (`create-panel.js`) calls `payForGenerationWithUSDC()` **before** `generateAsset()`. This means the payment popups appear before the auth popup.

The fix is to ensure auth happens **before** payment in the caller:

```js
// In create-panel.js onGenerate()

// 1. AUTH FIRST
await getOrCreateSession(); // triggers sign if no valid cache

// 2. THEN PAYMENT
const txHash = await payForGenerationWithUSDC(nodeId, prompt, tier);

// 3. THEN API CALL
const result = await generateAsset({ prompt, nodeId, txHash, ... });
```

`generateAsset()` already calls `getOrCreateSession()` internally for self-contained auth, but by calling it explicitly beforehand, the sign popup (if needed) appears before the USDC approve/pay popups.

---

## 6. Frontend Changes

### 6.1 `frontend/src/js/blockchain/wallet.js`

After `_finishWalletSetup(address)`:

1. Set `window.walletAddress` and `window.chainId` (existing)
2. Initialize contract and check balance (existing)
3. **NEW:** Call `authenticateUser()` non-blocking

```js
async function authenticateUser() {
  try {
    const session = await getOrCreateSession();
    document.dispatchEvent(new CustomEvent('user:authenticated', {
      detail: { address: window.walletAddress, session }
    }));
  } catch (err) {
    // User rejected sign or other error
    document.dispatchEvent(new CustomEvent('user:auth-required', {
      detail: { address: window.walletAddress }
    }));
  }
}
```

### 6.2 `frontend/src/js/ui/create-panel.js`

**`onGenerate()`** — add auth before payment:

```js
async function onGenerate() {
  // ...existing validation...

  // NEW: ensure auth before payment so sign popup comes first
  try {
    await getOrCreateSession();
  } catch (err) {
    // User rejected sign — abort generation gracefully
    setGenerating(false);
    showToast("Sign in to generate assets");
    return;
  }

  const txHash = await payForGenerationWithUSDC(nodeId, prompt, tier);
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

Update the `wallet:connected` listener to check auth state, and add new listeners for `user:authenticated` and `user:auth-required`:

```js
document.addEventListener("wallet:connected", (e) => {
  // ...existing show/hide logic...
  // NEW: check if we have a cached session
  const cached = getCachedSession();
  const isAuth = cached && cached.address === e.detail?.address?.toLowerCase();
  updateWalletButtonState(e.detail?.address, isAuth);
});

document.addEventListener("user:authenticated", (e) => {
  updateWalletButtonState(e.detail?.address, true);
});

document.addEventListener("user:auth-required", (e) => {
  updateWalletButtonState(e.detail?.address, false);
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
| `frontend/src/js/blockchain/wallet.js` | Add `authenticateUser()`, call it from `_finishWalletSetup()` |
| `frontend/src/js/ui/create-panel.js` | Call `getOrCreateSession()` before `payForGenerationWithUSDC()` |
| `frontend/src/js/engine/studio-init.js` | Add `user:authenticated` / `user:auth-required` listeners, update wallet button UI |
| `frontend/src/js/ui/wallet-popover.js` | Add "Sign In" action to popover for unauthenticated state |

---

## 11. Out of Scope

- Google OAuth implementation (architecture only)
- Backend changes (none required)
- Session token format changes
- New session routes or endpoints
- Contract or blockchain changes
