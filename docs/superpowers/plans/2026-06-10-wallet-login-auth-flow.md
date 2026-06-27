# Wallet Login Auth Flow Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move SIWE signing from first-generation-time to wallet-connect-time, and reorder auth before payment in the generation flow.

**Architecture:** Add an `authenticateUser()` helper to `wallet.js` that eagerly creates a session after wallet connection. Export `getOrCreateSession` from `api.js` so callers can ensure auth before payment. Update the wallet button UI to reflect auth state.

**Tech Stack:** Vanilla JavaScript (ES modules), Pug, SCSS

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/js/services/api.js` | API client; owns session creation (`createSession`, `getOrCreateSession`) |
| `frontend/src/js/blockchain/wallet-core.js` | Wallet connection; NEW: `authenticateUser()` eager session creation (re-exported via `wallet.js`) |
| `frontend/src/js/ui/create-panel.js` | Generation UI; NEW: call auth before generation |
| `frontend/src/js/engine/studio-init.js` | Studio bootstrap; NEW: auth-aware wallet button UI |
| `frontend/src/pug/studio.pug` | Wallet popover template; NEW: "Sign In" button |
| `frontend/src/js/ui/wallet-popover.js` | Popover logic; NEW: handle "Sign In" action |
| `frontend/src/scss/components/_wallet-popover.scss` | Popover styles; NEW: "Sign In" button style |

---

## Task 1: Export `getOrCreateSession` from `api.js`

**Files:**
- Modify: `frontend/src/js/services/api.js:200`

**Why:** `wallet.js` and `create-panel.js` need to call `getOrCreateSession()` directly.

- [ ] **Step 1: Add `export` keyword to `getOrCreateSession`**

Change line 200 from:
```js
async function getOrCreateSession() {
```
to:
```js
export async function getOrCreateSession() {
```

- [ ] **Step 2: Verify no other changes needed in `api.js`**

`generateAsset()` already calls `getOrCreateSession()` internally. The export just makes it available to external callers.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/js/services/api.js
git commit -m "feat(auth): export getOrCreateSession for eager auth"
```

---

## Task 2: Add `authenticateUser()` to `wallet-core.js`

**Files:**
- Modify: `frontend/src/js/blockchain/wallet-core.js`

**Why:** After wallet connection, immediately try to create a session so the user only sees the sign popup once at login.

**Circular dependency note:** `api.js` already imports `{ web3 }` from `wallet.js` (which re-exports from `wallet-core.js`). To avoid a circular import, `wallet-core.js` uses a dynamic import inside `authenticateUser()`.

- [ ] **Step 1: Add `authenticateUser()` after `_attachProviderListeners()`**

Insert the following function after `_attachProviderListeners()`:

```js
import { emit, EVENTS } from "../events/bus.js";
import { walletState } from "../state/wallet-state.js";

/**
 * Eagerly authenticate the user after wallet connection.
 * Tries to create/reuse a session token. If the user rejects the sign,
 * dispatches user:auth-required so the UI can show a "Sign In" prompt.
 *
 * Uses dynamic import to avoid circular dependency with api.js
 */
async function authenticateUser() {
  try {
    const { getOrCreateSession } = await import("../services/api.js");
    const session = await getOrCreateSession();
    emit(
      EVENTS.USER_AUTHENTICATED,
      { address: walletState.get().walletAddress, session }
    );
  } catch (err) {
    console.warn("[AUTH] Session creation failed or rejected:", err.message);
    emit(
      EVENTS.USER_AUTH_REQUIRED,
      { address: walletState.get().walletAddress }
    );
  }
}
```

- [ ] **Step 2: Call `authenticateUser()` from `_finishWalletSetup()`**

After `_attachProviderListeners();`, add:

```js
  // Eagerly authenticate (non-blocking)
  authenticateUser();
```

The end of `_finishWalletSetup()` should look like:

```js
  emit(EVENTS.WALLET_CONNECTED, { address, chainId });

  // Setup listeners (only once per provider)
  _attachProviderListeners();

  // Eagerly authenticate (non-blocking)
  authenticateUser();
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/js/blockchain/wallet.js
git commit -m "feat(auth): eager session creation after wallet connect"
```

---

## Task 3: Reorder auth before generation in `create-panel.js`

**Files:**
- Modify: `frontend/src/js/ui/create-panel.js`

**Why:** If the user skipped sign at login, the sign popup must appear BEFORE the generation request on first generate. The current flow is free/mock tier and does not use USDC payment popups.

- [ ] **Step 1: Add `getOrCreateSession` import**

Change the import block at lines 8-14 from:

```js
import { generateAsset, ApiError } from "../services/api.js";
```

to:

```js
import { generateAsset, ApiError, getOrCreateSession } from "../services/api.js";
```

- [ ] **Step 2: Add auth check before generation in `onGenerate()`**

Inside `onGenerate()`, after the existing wallet check and before `setGenerating(true)`, add:

```js
  // Ensure authenticated before generation so sign popup comes first
  try {
    await getOrCreateSession();
  } catch (err) {
    showToast({ type: "warning", title: "Sign In Required", message: "Sign in to generate assets." });
    return;
  }
```

The beginning of `onGenerate()` should look like:

```js
async function onGenerate() {
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  if (!walletState.get().walletAddress) {
    alert("Please connect your wallet first.");
    return;
  }

  // Ensure authenticated before generation so sign popup comes first
  try {
    await getOrCreateSession();
  } catch (err) {
    showToast({ type: "warning", title: "Sign In Required", message: "Sign in to generate assets." });
    return;
  }

  addChatMessage("user", prompt);
  promptInput.value = "";
  promptInput.style.height = "auto";

  setGenerating(true);

  // ...rest of function calls generateAsset({ prompt, nodeId, txHash: null, ... })
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/js/ui/create-panel.js
git commit -m "feat(auth): auth before generation in generation flow"
```

> **Note:** The current generation flow is free/mock tier and does not call `payForGenerationWithUSDC()`. If a paid-tier flow is restored, auth must still precede payment.

---

## Task 4: Update wallet button UI in `studio-init.js`

**Files:**
- Modify: `frontend/src/js/engine/studio-init.js:32`, `64-103`

**Why:** The wallet button must reflect auth state — show a "Sign In" indicator when connected but not authenticated.

- [ ] **Step 1: Add imports for the event bus and `getCachedSession`**

Add to the imports in `studio-init.js`:

```js
import { on, EVENTS } from "../events/bus.js";
import { getCachedSession } from "/js/services/api.js";
```

`getCachedSession` is already exported from `api.js`.

- [ ] **Step 2: Add `updateWalletButtonState` helper**

Before the event listeners, add:

```js
function updateWalletButtonState(address, isAuthenticated) {
  const d = document.getElementById("disconnectWalletBtn");
  if (!d) return;

  const text = d.querySelector("span") || d;
  if (!address) {
    if (text) text.textContent = "Disconnect";
    return;
  }

  const truncated = `${address.slice(0, 6)}…${address.slice(-4)}`;
  if (text) {
    text.textContent = isAuthenticated ? truncated : `${truncated} • Sign In`;
  }

  // Toggle visual indicator class
  if (isAuthenticated) {
    d.classList.remove("auth-required");
  } else {
    d.classList.add("auth-required");
  }
}
```

- [ ] **Step 3: Update `wallet:connected` listener**

Replace the existing listener with:

```js
on(EVENTS.WALLET_CONNECTED, (e) => {
  const c = document.getElementById("connectWalletBtn");
  const d = document.getElementById("disconnectWalletBtn");
  const netSel = document.getElementById("headerbarNetworkSelect");
  if (c) {
    c.classList.add("hidden");
    c.classList.remove("disconnected");
  }
  if (d) d.classList.remove("hidden");

  const address = e?.address || "";
  const cached = getCachedSession();
  const isAuth = cached && cached.address === address.toLowerCase();
  updateWalletButtonState(address, isAuth);

  // Green dot + sync network selector to current chain
  if (netSel) {
    netSel.classList.add("connected");
    const chainId = e?.chainId;
    const keyMap = {
      [CHAIN_IDS.HARDHAT_LOCAL]: "hardhat",
      [CHAIN_IDS.MEGAETH_TESTNET]: "megaethTestnet",
    };
    const key = keyMap[chainId];
    if (key) netSel.value = key;
  }
});
```

- [ ] **Step 4: Add `user:authenticated` and `user:auth-required` listeners**

After the `wallet:disconnected` listener, add:

```js
on(EVENTS.USER_AUTHENTICATED, (e) => {
  updateWalletButtonState(e?.address, true);
});

on(EVENTS.USER_AUTH_REQUIRED, (e) => {
  updateWalletButtonState(e?.address, false);
});
```

- [ ] **Step 5: Update `wallet:disconnected` listener**

Replace the existing listener with:

```js
on(EVENTS.WALLET_DISCONNECTED, () => {
  const c = document.getElementById("connectWalletBtn");
  const d = document.getElementById("disconnectWalletBtn");
  const netSel = document.getElementById("headerbarNetworkSelect");
  if (c) {
    c.classList.remove("hidden");
    c.classList.add("disconnected");
  }
  if (d) {
    d.classList.add("hidden");
    d.classList.remove("auth-required");
  }
  updateWalletButtonState(null, false);
  // Gray dot when disconnected
  if (netSel) netSel.classList.remove("connected");
});
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/js/engine/studio-init.js
git commit -m "feat(auth): auth-aware wallet button UI"
```

---

## Task 5: Add "Sign In" action to wallet popover

**Files:**
- Modify: `frontend/src/pug/studio.pug`
- Modify: `frontend/src/js/ui/wallet-popover.js`
- Modify: `frontend/src/scss/components/_wallet-popover.scss`

**Why:** If the user is connected but unauthenticated, the popover should offer a "Sign In" action.

- [ ] **Step 1: Add "Sign In" button to Pug template**

Add the Sign In button inside `.wallet-popover-actions` in `studio.pug`:

```pug
        .wallet-popover-actions
          button#walletPopoverSignIn.wallet-popover-signin.btn.btn-primary.btn-sm.hidden(type="button") Sign In
          button#walletPopoverDisconnect.wallet-popover-disconnect.btn.btn-danger.btn-sm(type="button") Disconnect Wallet
```

- [ ] **Step 2: Add Sign In handler to `wallet-popover.js`**

Update `getElements()` to include the new button:

```js
function getElements() {
  return {
    popover: document.getElementById("walletPopover"),
    address: document.getElementById("walletPopoverAddress"),
    copyBtn: document.getElementById("walletPopoverCopy"),
    explorerLink: document.getElementById("walletPopoverExplorer"),
    signInBtn: document.getElementById("walletPopoverSignIn"),
    disconnectBtn: document.getElementById("walletPopoverDisconnect"),
    walletBtn: document.getElementById("disconnectWalletBtn"),
  };
}
```

Update `updateContent()` to show/hide the Sign In button based on auth state. The live code reads address and chain from `walletState` and uses `truncateAddress`:

```js
import { truncateAddress } from "../utils/format.js";
import { walletState } from "../state/wallet-state.js";
import { getCachedSession } from "../services/api.js";

function updateContent() {
  const els = getElements();
  const { walletAddress, chainId: rawChainId } = walletState.get();
  const address = walletAddress || "";
  const chainId = Number(rawChainId || 0);

  // Address with truncation
  if (els.address) {
    els.address.textContent = truncateAddress(address) || "—";
    els.address.title = address;
  }

  // Copy button state reset
  if (els.copyBtn) {
    els.copyBtn.textContent = "Copy";
    els.copyBtn.classList.remove("copied");
  }

  // Explorer link
  if (els.explorerLink) {
    const url = getAddressExplorerUrl(chainId, address);
    if (url) {
      els.explorerLink.href = url;
      els.explorerLink.classList.remove("hidden");
    } else {
      els.explorerLink.classList.add("hidden");
    }
  }

  // Sign In button visibility
  if (els.signInBtn) {
    const cached = getCachedSession();
    const isAuth = cached && cached.address === address.toLowerCase();
    if (address && !isAuth) {
      els.signInBtn.classList.remove("hidden");
    } else {
      els.signInBtn.classList.add("hidden");
    }
  }
}
```

Add the `onSignIn` handler and wire it in `initWalletPopover()`:

```js
async function onSignIn() {
  closePopover();
  try {
    const { getOrCreateSession } = await import("../services/api.js");
    await getOrCreateSession();
  } catch (err) {
    // User rejected — state remains auth-required
  }
}
```

In `initWalletPopover()`, add:

```js
  if (els.signInBtn) {
    els.signInBtn.addEventListener("click", onSignIn);
  }
```

- [ ] **Step 3: Add CSS for Sign In button**

In `frontend/src/scss/components/_wallet-popover.scss`, add after `.wallet-popover-disconnect`:

```scss
.wallet-popover-signin {
  width: 100%;
  margin-bottom: var(--size-2);
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pug/studio.pug
git add frontend/src/js/ui/wallet-popover.js
git add frontend/src/scss/components/_wallet-popover.scss
git commit -m "feat(auth): add Sign In action to wallet popover"
```

---

## Task 6: Build and manual verification

**Files:**
- Build output: `frontend/dist/`

- [ ] **Step 1: Build frontend**

```bash
cd frontend && npm run build
```

Expected: Build completes without errors.

- [ ] **Step 2: Start backend and infrastructure**

```bash
npm start &
docker-compose up -d
```

- [ ] **Step 3: Manual test — Happy path**

1. Open studio in browser
2. Click "Connect Wallet" → MetaMask account selection popup
3. Approve account → immediately see SIWE sign popup
4. Sign the message → wallet button shows truncated address (no "Sign In")
5. Enter prompt, click Generate → no additional popups (current free/mock tier)
6. Generation succeeds

> **Note:** If a paid USDC tier is restored, step 5 will include the USDC approve + pay popups after the SIWE sign.

- [ ] **Step 4: Manual test — Fallback path**

1. Disconnect wallet
2. Reconnect wallet → reject the SIWE sign popup
3. Wallet button shows "Sign In" indicator
4. Click wallet button → popover shows "Sign In" button
5. Enter prompt, click Generate → sign popup appears FIRST
6. Generation succeeds

- [ ] **Step 5: Manual test — Session reuse**

1. With active session, refresh page
2. Wallet auto-reconnects
3. `authenticateUser()` runs, finds cached session
4. Wallet button shows authenticated state immediately
5. Generate works with no additional popups

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(auth): wallet login auth flow redesign"
```

---

## Self-Review Checklist

### Spec Coverage

| Spec Requirement | Task |
|---|---|
| Add `authenticateUser()` to `wallet-core.js`, call from `_finishWalletSetup()` (re-exported via `wallet.js`) | Task 2 |
| Export `getOrCreateSession` from `api.js` | Task 1 |
| Call `getOrCreateSession()` before `generateAsset()` in `create-panel.js` | Task 3 |
| Update wallet button UI with auth state | Task 4 |
| Add "Sign In" action to wallet popover | Task 5 |
| No backend changes | — |

### Placeholder Scan

- [x] No "TBD", "TODO", or "implement later"
- [x] Every step has actual code
- [x] Every step has exact file paths and line numbers
- [x] No vague descriptions without code

### Type/Signature Consistency

- [x] `getOrCreateSession` exported as `async function` — matches usage in `wallet.js` and `create-panel.js`
- [x] `authenticateUser()` uses dynamic import to avoid circular dependency
- [x] `getCachedSession` exported — used by `studio-init.js` and `wallet-popover.js`
