# Session-Only Authentication Design

**Date:** 2026-06-13  
**Status:** Approved  
**Scope:** Backend + frontend authentication simplification

---

## 1. Problem Statement

The Arbesk API currently accepts two authorization schemes:

1. `Authorization: Bearer <base64("txHash:<hash>")>.<base64(signature)>` — a bespoke per-request signature scheme.
2. `Authorization: Session <opaque-token>` — a standard SIWE-based session token valid for 24 hours.

Bearer auth is non-standard, adds code complexity, and duplicates the wallet-ownership proof that SIWE already solves. The frontend already prefers Session auth; Bearer exists only as a fallback path.

### Goal

Remove the Bearer scheme entirely and make **Session + SIWE** the only supported authentication method.

---

## 2. State Model

No change to the existing session model:

| State | Meaning |
|---|---|
| `disconnected` | No wallet connected |
| `connected` + valid session | Wallet connected, `arbesk_session` in `localStorage` is valid and matches address |
| `connected` + no session | Wallet connected, user must sign SIWE to obtain a session |

Session creation flow remains:

```
POST /api/v1/sessions
Body: { message: <SIWE-message>, signature: <signature> }
Response: { token: <opaque-uuid>, expiresAt: <timestamp> }
```

Subsequent protected requests:

```
Authorization: Session <token>
```

---

## 3. Architecture

### Backend

| File | Change |
|---|---|
| `src/api/authentication.js` | Accept only `Session <token>`. Remove Bearer parsing, base64 decode, `web3.eth.accounts.recover` for txHash messages, and tx receipt validation from auth middleware. |
| `src/api/openapi.json` | Replace `bearerAuth` security scheme with `sessionAuth` describing the `Session <token>` header. |
| `src/api/rate-limiter.js` | Rewritten on `express-rate-limit`; keys every limiter by `res.locals.userAddress` (set by auth middleware) falling back to `req.ip`. |

### Frontend

| File | Change |
|---|---|
| `frontend/src/js/services/api.js` | Remove `signTxHash()`. Remove Bearer fallback inside `generateAsset()`. Remove the `usedSession` retry fallback to Bearer. Keep session creation, caching, and auto-retry on `INVALID_SESSION`. |
| `frontend/src/js/ui/create-panel.js` | Calls `getOrCreateSession()` before `generateAsset()` to ensure the SIWE sign popup appears before any provider payment/key prompt. |
| `frontend/src/js/blockchain/wallet.js` | `authenticateUser()` now lives in `frontend/src/js/blockchain/wallet-core.js` and is re-exported through `wallet.js`; it eagerly creates a session after wallet connection. |

### Tests

| File | Change |
|---|---|
| `test/api.test.js` | Replace `makeAuthHeader()` Bearer helper with a session helper. Update all `POST /api/v1/generations` tests to send `Authorization: Session <valid-token>`. Remove Bearer-specific failure tests; add session invalid/expired tests if missing. |

### Docs

| File | Change |
|---|---|
| `docs/API_SPEC.md` | Update Authentication section to describe Session-only auth. Update error table (401 now means missing/invalid session). |
| `docs/ARCHITECTURE.md` | Replace Bearer references with Session/SIWE. |
| `AGENTS.md` | Update auth description if it mentions Bearer. |

---

## 4. Data Flow

### Protected request (e.g., generation)

```
User clicks Generate
  └── create-panel.js
      ├── getOrCreateSession() → cache hit or SIWE sign popup
      └── generateAsset({ prompt, nodeId, txHash: null })
          └── POST /api/v1/generations
              Header: Authorization: Session <token>
              Body: { prompt, nodeId, ... }
                  └── backend authenticate middleware
                      ├── parse Session header
                      ├── validate token against in-memory store
                      ├── set res.locals.userAddress
                      └── next()
                  └── generate-node.js
                      ├── rate limit by res.locals.userAddress
                      └── generate, return raw asset bytes

> **Implemented as:** The current generation flow is free/mock tier and does not use `payForGenerationWithUSDC()`. The browser uploads the source asset and manifest to IPFS directly; `generate-node.js` returns raw asset bytes and performs no server-side IPFS writes.
```

### Session creation

```
User connects wallet / clicks Generate
  └── getOrCreateSession()
      ├── cache miss → createSession()
      │   ├── build SIWE message
      │   ├── personal.sign → MetaMask popup
      │   └── POST /api/v1/sessions
      │       └── backend verifySiwe()
      │           ├── parse SIWE fields
      │           ├── validate domain, version, chain ID, timestamp, nonce
      │           ├── recover address from signature
      │           └── issue opaque token (24h TTL)
      └── cache token in localStorage
```

---

## 5. Error Handling

| Scenario | Behavior |
|---|---|
| Missing `Authorization` header | 401 `MISSING_AUTH` |
| Non-Session scheme | 401 `UNKNOWN_AUTH_SCHEME` |
| Invalid/expired session token | 401 `INVALID_SESSION` |
| User rejects SIWE sign | Frontend aborts action, shows "Sign in to generate assets" toast |
| Server restart (sessions lost) | Backend returns 401; frontend auto-retries `createSession()` once |
| Wallet switched | `getOrCreateSession()` detects address mismatch, creates new session |

---

## 6. Security Considerations

- Private keys never leave the wallet.
- Session tokens are opaque UUIDs, not JWTs, so there is no client-side parseable payload.
- Tokens are bound to a wallet address and validated server-side.
- Replay protection for generation remains in `generate-node.js` via the `usedTxHashes` Set.
- Tx receipt and payment-event validation remain in `generate-node.js`; removing them from auth middleware does not weaken security.

---

## 7. Out of Scope

- Changing session token format.
- Adding refresh tokens.
- Moving session store out of in-memory Map.
- Cookie-based sessions.
- New session routes or endpoints.

---

## 8. Files to Modify

| File | Change Type |
|---|---|
| `src/api/authentication.js` | Remove Bearer handling |
| `src/api/openapi.json` | Update security scheme |
| `frontend/src/js/services/api.js` | Remove `signTxHash` and Bearer fallback |
| `test/api.test.js` | Use Session auth helper |
| `docs/API_SPEC.md` | Document Session-only auth |
| `docs/ARCHITECTURE.md` | Update auth architecture |
| `AGENTS.md` | Update auth description |
