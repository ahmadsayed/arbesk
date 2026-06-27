# Session-Only Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the bespoke Bearer auth scheme and make SIWE-based Session auth the only supported authentication method.

**Architecture:** Simplify `src/api/authentication.js` to validate only opaque session tokens. Remove `signTxHash()` and the Bearer fallback from `frontend/src/js/services/api.js`. Update backend tests to create real sessions via `src/api/sessions.js`. Update API docs and architecture docs to reflect Session-only auth.

**Tech Stack:** Node.js + Express, vanilla JS ES modules, Jest + Supertest, SIWE (EIP-4361).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/api/authentication.js` | Express middleware: parse `Authorization: Session <token>` and set `res.locals.userAddress`. |
| `src/api/sessions.js` | Session store, creation, validation, and SIWE verification. Exports `createSession` for tests. |
| `src/api/openapi.json` | OpenAPI security scheme describing Session auth. |
| `frontend/src/js/services/api.js` | Frontend API client: session creation/caching and generation request auth. |
| `test/api.test.js` | Backend API tests using Session auth. |
| `docs/API_SPEC.md` | Public API authentication docs. |
| `docs/ARCHITECTURE.md` | System architecture auth description. |
| `AGENTS.md` | Agent onboarding auth notes. |

---

## Task 1: Simplify backend auth middleware

**Files:**
- Modify: `src/api/authentication.js`

**Why:** Remove the bespoke Bearer txHash-signature scheme. The middleware should only validate opaque session tokens.

- [ ] **Step 1: Replace the middleware body to accept only Session tokens**

```javascript
/**
 * Arbesk API Authentication Middleware
 *
 * Accepts only:
 *   Authorization: Session <token>
 *
 * The session token is created by POST /api/v1/sessions after the user
 * signs a SIWE (EIP-4361) message. The opaque token is valid for 24 hours.
 */

import { validateSession } from "./sessions.js";

export default async function authorize(request, response, next) {
  try {
    const authHeader = request.headers["authorization"];
    if (!authHeader) {
      console.log(`[AUTH] rejected — missing Authorization header`);
      return response.status(401).json({
        error: {
          code: "MISSING_AUTH",
          message: "Missing Authorization header",
        },
      });
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "session") {
      console.log(`[AUTH] rejected — invalid format or scheme`);
      return response.status(401).json({
        error: {
          code: "INVALID_AUTH_FORMAT",
          message: 'Invalid Authorization format. Expected: Session <token>',
        },
      });
    }

    const token = parts[1];
    const address = validateSession(token);

    if (!address) {
      console.log(`[AUTH] rejected — invalid or expired session token`);
      return response.status(401).json({
        error: {
          code: "INVALID_SESSION",
          message:
            "Session token is invalid or expired. Create a new session by signing again.",
        },
      });
    }

    response.locals.userAddress = address;
    response.locals.txHash = null;
    console.log(`[AUTH] session valid — address=${address}`);
    return next();
  } catch (error) {
    console.error("[AUTH] error:", error.message);
    return response.status(403).json({
      error: {
        code: "AUTH_FAILED",
        message: "Authentication failed: " + error.message,
      },
    });
  }
}
```

- [ ] **Step 2: Verify the file no longer imports `web3` or `getWeb3`**

The imports should be:

```javascript
import { validateSession } from "./sessions.js";
```

- [ ] **Step 3: Commit**

```bash
git add src/api/authentication.js
git commit -m "refactor(auth): remove Bearer scheme, accept Session only"
```

---

## Task 2: Update OpenAPI security scheme

**Files:**
- Modify: `src/api/openapi.json`

**Why:** The public API spec currently documents only the Bearer scheme.

- [ ] **Step 1: Replace the `bearerAuth` security scheme with `sessionAuth`**

Locate `components.securitySchemes.bearerAuth` and replace it with:

```json
"securitySchemes": {
  "sessionAuth": {
    "type": "apiKey",
    "in": "header",
    "name": "Authorization",
    "description": "Session authentication. Format: `Session <opaque-token>`. Obtain a token by signing a SIWE (EIP-4361) message via `POST /api/v1/sessions`. Tokens expire after 24 hours."
  }
}
```

- [ ] **Step 2: Update any operation-level `security` references from `bearerAuth` to `sessionAuth`**

Search the same file for `"bearerAuth"` and replace with `"sessionAuth"`. As of this writing only the security scheme is defined; no operation-level security objects exist. If any are added later, they must reference `sessionAuth`.

- [ ] **Step 3: Commit**

```bash
git add src/api/openapi.json
git commit -m "docs(api): replace bearerAuth with sessionAuth security scheme"
```

---

## Task 3: Remove Bearer fallback from frontend API client

**Files:**
- Modify: `frontend/src/js/services/api.js`

**Why:** The frontend should always use Session auth. Remove dead `signTxHash()` and the Bearer fallback path.

- [ ] **Step 1: Remove the `signTxHash` function and its JSDoc**

Delete lines 52-81 (the entire `signTxHash` function and JSDoc).

- [ ] **Step 2: Simplify `generateAsset()` to always use Session**

Replace this block inside `generateAsset`:

```javascript
  let authHeader;
  let usedSession = false;
  try {
    const sessionToken = await getOrCreateSession();
    authHeader = `Session ${sessionToken}`;
    usedSession = true;
  } catch {
    announceStatus("Sign authentication message in MetaMask…");
    const bearerToken = await signTxHash(txHash);
    authHeader = `Bearer ${bearerToken}`;
  }
```

with:

```javascript
  const sessionToken = await getOrCreateSession();
  let authHeader = `Session ${sessionToken}`;
```

- [ ] **Step 3: Remove the Bearer retry fallback block**

Replace the retry block:

```javascript
  // Auto-retry once with a fresh session if the backend lost our token
  // (common during development when the Node server restarts).
  if (response.status === 401 && usedSession) {
    const { code } = parseErrorBody(data);
    if (code === "INVALID_SESSION" || code === "MISSING_AUTH") {
      console.log("[SESSION] backend rejected token — creating fresh session…");
      clearSession();
      try {
        const freshToken = await createSession();
        authHeader = `Session ${freshToken.token}`;
        response = await doFetch(authHeader);
        data = await response.json().catch(() => ({}));
      } catch {
        // Session creation failed — fall back to Bearer (txHash signature)
        announceStatus("Sign authentication message in MetaMask…");
        const bearerToken = await signTxHash(txHash);
        authHeader = `Bearer ${bearerToken}`;
        response = await doFetch(authHeader);
        data = await response.json().catch(() => ({}));
      }
    }
  }
```

with:

```javascript
  // Auto-retry once with a fresh session if the backend lost our token
  // (common during development when the Node server restarts).
  if (response.status === 401) {
    const { code } = parseErrorBody(data);
    if (code === "INVALID_SESSION" || code === "MISSING_AUTH") {
      console.log("[SESSION] backend rejected token — creating fresh session…");
      clearSession();
      const freshToken = await createSession();
      authHeader = `Session ${freshToken.token}`;
      response = await doFetch(authHeader);
      data = await response.json().catch(() => ({}));
    }
  }
```

- [ ] **Step 4: Verify `signTxHash` is no longer imported or used**

Run:

```bash
grep -n "signTxHash" frontend/src/js/services/api.js
```

Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/services/api.js
git commit -m "refactor(frontend): remove Bearer fallback, use session auth only"
```

---

## Task 4: Update backend tests to use Session auth

**Files:**
- Modify: `test/api.test.js`
- Read: `src/api/sessions.js` (already exists)

**Why:** Tests currently build Bearer headers. They must create real session tokens via `createSession()` from `src/api/sessions.js`.

- [ ] **Step 1: Import `createSession` in the test file**

Add near the top of `test/api.test.js` (after existing imports):

```javascript
import { createSession } from "../src/api/sessions.js";
```

- [ ] **Step 2: Replace `makeAuthHeader` with `makeSessionHeader`**

Replace:

```javascript
  function makeAuthHeader(txHash = "0x123") {
    const message = Buffer.from(txHash).toString("base64");
    const signature = Buffer.from("0xFakeSignature").toString("base64");
    return `Bearer ${message}.${signature}`;
  }
```

with:

```javascript
  async function makeSessionHeader(address = "0x1234567890123456789012345678901234567890") {
    const token = createSession(address);
    return `Session ${token}`;
  }
```

- [ ] **Step 3: Update all call sites to `await makeSessionHeader()`**

Each `.set("Authorization", makeAuthHeader())` must become `.set("Authorization", await makeSessionHeader())`.

For example, change:

```javascript
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", makeAuthHeader())
        .send({...});
```

to:

```javascript
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", await makeSessionHeader())
        .send({...});
```

Repeat for every `POST /api/v1/generations` test.

- [ ] **Step 4: Update the replay test to use a fresh session**

The replay test at line ~266 uses `const auth = makeAuthHeader(txHash);`. Replace with:

```javascript
      const auth = await makeSessionHeader();
```

- [ ] **Step 5: Remove or replace Bearer-specific failure tests**

If any tests assert Bearer-format failures (e.g., invalid `base64message.base64signature` format), replace them with session failure tests. For example, add:

```javascript
    it("rejects invalid session token with 401", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", "Session invalid-token")
        .send({
          prompt: "A modern minimalist workbench",
          nodeId: "node_test",
          txHash: "0x123",
        });

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe("INVALID_SESSION");
    });

    it("rejects non-Session auth scheme with 401", async () => {
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", "Bearer something")
        .send({
          prompt: "A modern minimalist workbench",
          nodeId: "node_test",
          txHash: "0x123",
        });

      expect(res.status).toBe(401);
    });
```

- [ ] **Step 6: Run backend tests**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api.test.js --runInBand
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add test/api.test.js
git commit -m "test(api): use Session auth helper, remove Bearer tests"
```

---

## Task 5: Update API specification docs

**Files:**
- Modify: `docs/API_SPEC.md`

**Why:** The spec still describes the old Bearer flow.

- [ ] **Step 1: Rewrite the Authentication section**

Replace lines 20-38 with:

```markdown
## Authentication

`POST /api/v1/generations` requires a valid session token obtained through the SIWE (EIP-4361) sign-in flow:

```text
Authorization: Session <opaque-token>
```

### Creating a session

1. Build a SIWE message (EIP-4361) containing the wallet address, domain, chain ID, nonce, and issued-at timestamp.
2. Sign the message with the wallet (e.g., `personal.sign`).
3. POST the message and signature to `/api/v1/sessions`:

```json
POST /api/v1/sessions
{
  "message": "example.com wants you to sign in...",
  "signature": "0x..."
}
```

The backend verifies the SIWE signature and returns an opaque session token valid for 24 hours:

```json
{
  "token": "<uuid>",
  "expiresAt": 1780001000000
}
```

4. Include the token in subsequent protected requests:

```text
Authorization: Session <uuid>
```

Session tokens are stored in browser `localStorage` under the key `arbesk_session` and are cleared on wallet disconnect.

Parametric edits, manifest saves, manifest chain reads, ABI reads, and token manifest reads do not currently require session auth.
```

- [ ] **Step 2: Update the `/generations` error table**

Change:

```markdown
| 401 | Missing or malformed Bearer auth |
```

to:

```markdown
| 401 | Missing, malformed, or invalid Session auth |
```

- [ ] **Step 3: Commit**

```bash
git add docs/API_SPEC.md
git commit -m "docs(api): document Session-only authentication"
```

---

## Task 6: Update architecture docs

**Files:**
- Modify: `docs/ARCHITECTURE.md`

**Why:** Architecture diagram and auth description reference Bearer.

- [ ] **Step 1: Find and replace Bearer references**

Search:

```bash
grep -n "Bearer" docs/ARCHITECTURE.md
```

Replace each occurrence with the Session/SIWE equivalent. For example, the diagram at line 55 should read:

```text
├─ Session (SIWE) auth
```

And the description at line 95 should read:

```text
| `src/api/authentication.js` | Session token validation, sets `res.locals.userAddress` |
```

And the flow at line 276 should describe SIWE sign-in followed by `Authorization: Session <token>`.

- [ ] **Step 2: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs(architecture): replace Bearer with Session/SIWE auth"
```

---

## Task 7: Update AGENTS.md auth notes

**Files:**
- Modify: `AGENTS.md`

**Why:** Agent onboarding mentions Bearer.

- [ ] **Step 1: Find Bearer references**

```bash
grep -n "Bearer" AGENTS.md
```

- [ ] **Step 2: Replace with Session/SIWE descriptions**

Update the Session-Based Authentication section (around line 326) to state that only Session tokens are accepted. Remove any mention of Bearer as a fallback.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs(agents): document Session-only auth for agents"
```

---

## Task 8: Run full test suite and verify

- [ ] **Step 1: Run backend tests**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api.test.js --runInBand --silent
```

Expected: all tests pass.

- [ ] **Step 2: Run deployment integrity tests**

```bash
npm run test:frontend
```

Expected: pass (this change does not touch contracts).

- [ ] **Step 3: Optional — lint the changed files**

```bash
npx eslint src/api/authentication.js frontend/src/js/services/api.js test/api.test.js
```

Fix any lint errors if the project uses ESLint.

- [ ] **Step 4: Commit final verification log**

No file changes needed; just confirm the suite passes. If it passes, the implementation is complete.

---

## Self-Review Checklist

- [ ] `src/api/authentication.js` no longer accepts Bearer.
- [ ] `frontend/src/js/services/api.js` no longer contains `signTxHash` or Bearer fallback.
- [ ] `test/api.test.js` creates real sessions and all generation tests pass.
- [ ] OpenAPI, API_SPEC, ARCHITECTURE, and AGENTS docs describe Session-only auth.
- [ ] Full backend test suite passes.
