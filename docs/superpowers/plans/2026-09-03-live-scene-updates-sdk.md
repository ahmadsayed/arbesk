# Live Scene Updates — Plan A: `@arbesk/nostr` SDK

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an environment-agnostic `@arbesk/nostr` SDK package that binds a wallet to a Nostr key (non-custodial), signs and publishes `KIND_ASSET_UPDATE` events, and verifies them end-to-end (binding + Schnorr signature + on-chain authorization).

**Architecture:** A new workspace package consumed by bare specifier. It is pure crypto + injected ports (`WalletSignPort`, `RelayPort`, `ChainReadPort`) — no network/DOM/chain imports, mirroring the existing `@arbesk/*` boundary rules. This is the single shared implementation that the browser, `besk` CLI, and MCP will all call (the dedup answer).

**Tech Stack:** TypeScript (erasable syntax only, Node type-stripping), `nostr-tools` v2 (Schnorr sign/verify), `viem` (keccak256 + EIP-191 address recovery), `@swc/jest` + `@jest/globals` for tests.

**Spec:** `docs/superpowers/specs/2026-09-03-live-scene-updates-design.md`

## Global Constraints

- Node ≥ 22.18; TypeScript `erasableSyntaxOnly` (no enums/namespaces/parameter properties); `import type` for type-only imports; relative imports carry `.ts`.
- SDK boundary: no imports from `frontend/`, `src/api/`, or `constants/`; no browser globals (`window`/`document`/`navigator`/`localStorage`/`Web3`/`BABYLON`).
- Bare-specifier consumption with `.js` subpaths; exports map `"."` → `dist/index.js`, `"./*"` → `dist/*`.
- Kinds (from spec §14.9): `KIND_ASSET_UPDATE = 20001`, `KIND_BINDING = 10050`; tags `#token` and `#address`.
- Non-custodial: the Nostr secret key is **derived** from a wallet EIP-191 signature, never stored by or issued from the backend.
- Workspace packages are compiled by `tsc`; `npm run build:packages` must list `@arbesk/nostr`.

---

## File Structure

```
packages/nostr/
  package.json           # workspace package, deps: nostr-tools, viem
  tsconfig.json          # typecheck config (noEmit)
  tsconfig.build.json    # emit dist/ + .d.ts
  AGENTS.md              # package guide (boundary rules, API)
  src/
    types.ts             # ports: WalletSignPort, RelayPort, ChainReadPort, Binding, payloads
    kinds.ts             # KIND_* + TAG_* + IDENTITY_MESSAGE constants
    identity.ts          # deriveSecretKey, derivePubkey, buildBinding, verifyBinding
    events.ts            # tokenTag, signAssetUpdate, verifyEventSignature
    publish.ts           # publishAssetUpdate
    verify.ts            # verifyAssetUpdate
    facade.ts            # createNostrFacade
    index.ts             # public exports
  test/
    identity.test.ts
    events.test.ts
    verify.test.ts
```

---

### Task 1: Scaffold the `@arbesk/nostr` package

**Files:**
- Create: `packages/nostr/package.json`
- Create: `packages/nostr/tsconfig.json`
- Create: `packages/nostr/tsconfig.build.json`
- Create: `packages/nostr/AGENTS.md`
- Modify: `package.json` (add to `build:packages`)
- Modify: `jest.config.js` (add moduleNameMapper entries)
- Modify: `eslint.config.js` (add a `arbesk/nostr` boundary block)

**Interfaces:**
- Produces: a workspace package resolved as `@arbesk/nostr` (bare) and `@arbesk/nostr/*.js` (subpaths → `.ts` source in jest).

- [ ] **Step 1: Write `packages/nostr/package.json`**

```json
{
  "name": "@arbesk/nostr",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Environment-agnostic Arbesk Nostr SDK: wallet↔Nostr identity binding, asset-update event signing/publishing/verification. One TypeScript codebase consumed by the browser, the CLI, and tests.",
  "sideEffects": false,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./*": "./dist/*"
  },
  "files": ["dist"],
  "scripts": {
    "build": "npm run clean && tsc -p tsconfig.build.json",
    "clean": "node -e \"fs.rmSync('dist', { recursive: true, force: true })\"",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "nostr-tools": "^2.23.5",
    "viem": "^2.52.2"
  },
  "license": "ISC"
}
```

- [ ] **Step 2: Write `packages/nostr/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "noEmit": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write `packages/nostr/tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "rewriteRelativeImportExtensions": true,
    "sourceMap": false,
    "declarationMap": false
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Write `packages/nostr/AGENTS.md`**

```markdown
# @arbesk/nostr — Nostr identity + asset-update events

Environment-agnostic Nostr SDK. Consumed by the browser, `besk` CLI, and tests.
Compiled by tsc to dist/ (ESM + .d.ts). No browser/backend imports; host
capabilities arrive via injected ports.

## Public API (src/index.ts)
- createNostrFacade(config) — composition root.
- identity.ts: buildBinding, verifyBinding, deriveSecretKey, derivePubkey.
- events.ts: signAssetUpdate, verifyEventSignature, tokenTag.
- publish.ts: publishAssetUpdate.
- verify.ts: verifyAssetUpdate.

## Boundary rules
- No imports from frontend/, src/api/, constants/. No browser globals.
- Erasable TS only; import type for type-only imports; .ts extensions.

## Build & test
npm run build --workspace @arbesk/nostr
npm test -- packages/nostr
```

- [ ] **Step 5: Register in `package.json` `build:packages`**

Modify the `build:packages` script so it appends the new workspace (order: after `@arbesk/asset-core`, before `@arbesk/wallet` — nostr depends on neither, order only needs to precede consumers):

```json
"build:packages": "npm run build --workspace @arbesk/asset-core && npm run build --workspace @arbesk/nostr && npm run build --workspace @arbesk/wallet && npm run build --workspace @arbesk/authz && npm run build --workspace @arbesk/ai-asset-gen"
```

- [ ] **Step 6: Add jest `moduleNameMapper` entries**

In `jest.config.js`, inside `moduleNameMapper`, add (alongside the other `@arbesk/*` entries):

```js
"^@arbesk/nostr$": "<rootDir>/packages/nostr/src/index.ts",
"^@arbesk/nostr/(.+)\\.js$": "<rootDir>/packages/nostr/src/$1.ts",
```

- [ ] **Step 7: Add an eslint boundary block**

In `eslint.config.js`, add a block after `arbesk/asset-core` (same shape, `files: ["packages/nostr/src/**/*.ts"]`) with `no-restricted-imports` patterns for `**/frontend/**`, `**/src/api/**`, `**/constants/**` and `no-restricted-globals` for `window`, `document`, `navigator`, `localStorage`, `Web3`, `BABYLON`.

- [ ] **Step 8: Verify build**

Run: `npm run build --workspace @arbesk/nostr`
Expected: dist/ generated (empty package for now — but tsc passes with no src files; add a `src/index.ts` stub if tsc errors on empty include). If tsc errors on an empty `include`, create `packages/nostr/src/index.ts` with `export {};` first, then rebuild.

- [ ] **Step 9: Commit**

```bash
git add packages/nostr package.json jest.config.js eslint.config.js
git commit -m "chore(nostr): scaffold @arbesk/nostr package"
```

---

### Task 2: Ports and constants (`types.ts`, `kinds.ts`)

**Files:**
- Create: `packages/nostr/src/types.ts`
- Create: `packages/nostr/src/kinds.ts`

**Interfaces:**
- Produces:
  - `WalletSignPort.signMessage(message: string): Promise<string>` — EIP-191 personal_sign, hex signature.
  - `RelayPort.publish(event: NostrEvent): Promise<void>`.
  - `ChainReadPort.isTokenAuthor(chainId: number, tokenId: string, address: string): Promise<boolean>`.
  - `Binding { address: string; pubkey: string; signature: string }`.
  - `AssetUpdatePayload { chainId: number; tokenId: string; newAssetURI: string; assetId?: string }`.
  - `NostrConfig { signer; chain; relay }`.
  - Constants `KIND_ASSET_UPDATE = 20001`, `KIND_BINDING = 10050`, `TAG_TOKEN = "token"`, `TAG_ADDRESS = "address"`, `IDENTITY_MESSAGE = "arbesk-nostr-identity-v1"`.

- [ ] **Step 1: Write `packages/nostr/src/types.ts`**

```ts
import type { NostrEvent } from "nostr-tools";

/** Signs an EIP-191 personal_sign message, returning the hex signature. */
export interface WalletSignPort {
  signMessage(message: string): Promise<string>;
}

/** Publishes a signed Nostr event to a relay. */
export interface RelayPort {
  publish(event: NostrEvent): Promise<void>;
}

/** Answers "is `address` the owner or an editor of `tokenId` on `chainId`?". */
export interface ChainReadPort {
  isTokenAuthor(chainId: number, tokenId: string, address: string): Promise<boolean>;
}

/** A wallet↔Nostr identity binding. */
export interface Binding {
  address: string;
  pubkey: string;
  signature: string;
}

/** Payload carried by a KIND_ASSET_UPDATE event. */
export interface AssetUpdatePayload {
  chainId: number;
  tokenId: string;
  newAssetURI: string;
  assetId?: string;
}

export interface NostrConfig {
  signer: WalletSignPort;
  chain: ChainReadPort;
  relay: RelayPort;
}
```

- [ ] **Step 2: Write `packages/nostr/src/kinds.ts`**

```ts
/** Nostr kind for asset-update notifications (never reuse kind 1 = chat). */
export const KIND_ASSET_UPDATE = 20001;
/** Nostr kind for the wallet↔Nostr identity binding. */
export const KIND_BINDING = 10050;
/** Tag name for the token-scoped key "<chainId>:<contract>:<tokenId>". */
export const TAG_TOKEN = "token";
/** Tag name for the binding's wallet address. */
export const TAG_ADDRESS = "address";
/** Fixed message the wallet signs to derive the Nostr key and prove ownership. */
export const IDENTITY_MESSAGE = "arbesk-nostr-identity-v1";
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace @arbesk/nostr`
Expected: PASS (no output).

- [ ] **Step 4: Commit**

```bash
git add packages/nostr/src/types.ts packages/nostr/src/kinds.ts
git commit -m "feat(nostr): add ports and kind constants"
```

---

### Task 3: Identity build (`deriveSecretKey`, `derivePubkey`, `buildBinding`)

**Files:**
- Create: `packages/nostr/src/identity.ts`
- Test: `packages/nostr/test/identity.test.ts`

**Interfaces:**
- Consumes: `WalletSignPort`, `Binding`, `IDENTITY_MESSAGE` (Task 2).
- Produces: `deriveSecretKey(signature: string): string`, `derivePubkey(signature: string): string`, `buildBinding(signer: WalletSignPort): Promise<Binding>`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/nostr/test/identity.test.ts
import { describe, it, expect } from "@jest/globals";
import { generatePrivateKey, privateKeyToAccount } from "viem";
import { getPublicKey } from "nostr-tools";
import { keccak256 } from "viem";
import { buildBinding, deriveSecretKey, derivePubkey } from "@arbesk/nostr/identity.js";
import { IDENTITY_MESSAGE } from "@arbesk/nostr/kinds.js";

describe("identity build", () => {
  it("derives the secret key as keccak256 of the signature", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const sig = await account.signMessage({ message: IDENTITY_MESSAGE });
    expect(deriveSecretKey(sig)).toBe(keccak256(sig));
    expect(derivePubkey(sig)).toBe(getPublicKey(deriveSecretKey(sig)));
  });

  it("builds a binding whose address matches the signer", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const signer = { signMessage: (m: string) => account.signMessage({ message: m }) };
    const binding = await buildBinding(signer);
    expect(binding.address.toLowerCase()).toBe(account.address.toLowerCase());
    expect(binding.pubkey).toBe(getPublicKey(deriveSecretKey(binding.signature)));
    expect(binding.signature).toMatch(/^0x/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/nostr/test/identity.test.ts`
Expected: FAIL — `Cannot find module '@arbesk/nostr/identity.js'`.

- [ ] **Step 3: Write `packages/nostr/src/identity.ts`**

```ts
import { keccak256, recoverMessageAddress } from "viem";
import { getPublicKey } from "nostr-tools";
import type { Binding, WalletSignPort } from "./types.ts";
import { IDENTITY_MESSAGE } from "./kinds.ts";

/** The Nostr secret key is the keccak256 of the wallet's binding signature. */
export function deriveSecretKey(signature: string): string {
  return keccak256(signature as `0x${string}`);
}

/** The Nostr pubkey derived from the wallet's binding signature. */
export function derivePubkey(signature: string): string {
  return getPublicKey(deriveSecretKey(signature));
}

/** Signs the fixed identity message and returns the wallet↔Nostr binding. */
export async function buildBinding(signer: WalletSignPort): Promise<Binding> {
  const signature = await signer.signMessage(IDENTITY_MESSAGE);
  const address = await recoverMessageAddress({
    message: IDENTITY_MESSAGE,
    signature: signature as `0x${string}`,
  });
  return { address, pubkey: derivePubkey(signature), signature };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/nostr/test/identity.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/nostr/src/identity.ts packages/nostr/test/identity.test.ts
git commit -m "feat(nostr): identity key derivation and binding build"
```

---

### Task 4: Identity verify (`verifyBinding`)

**Files:**
- Modify: `packages/nostr/src/identity.ts`
- Modify: `packages/nostr/test/identity.test.ts`

**Interfaces:**
- Produces: `verifyBinding(binding: Binding): boolean` — true iff the signature recovers to `binding.address` and the derived pubkey matches `binding.pubkey`.

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/nostr/test/identity.test.ts
import { verifyBinding } from "@arbesk/nostr/identity.js";

describe("identity verify", () => {
  it("accepts a valid binding", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const binding = await buildBinding({ signMessage: (m) => account.signMessage({ message: m }) });
    await expect(verifyBinding(binding)).resolves.toBe(true);
  });

  it("rejects a binding with a mismatched address", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const other = privateKeyToAccount(generatePrivateKey());
    const binding = await buildBinding({ signMessage: (m) => account.signMessage({ message: m }) });
    await expect(verifyBinding({ ...binding, address: other.address })).resolves.toBe(false);
  });

  it("rejects a binding with a forged pubkey", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const binding = await buildBinding({ signMessage: (m) => account.signMessage({ message: m }) });
    await expect(verifyBinding({ ...binding, pubkey: "00".repeat(32) })).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/nostr/test/identity.test.ts`
Expected: FAIL — `verifyBinding is not a function`.

- [ ] **Step 3: Implement `verifyBinding`**

Add to `packages/nostr/src/identity.ts`:

```ts
/** Verifies a binding's self-consistency and wallet signature. */
export async function verifyBinding(binding: Binding): Promise<boolean> {
  if (
    !binding ||
    typeof binding.address !== "string" ||
    typeof binding.pubkey !== "string" ||
    typeof binding.signature !== "string"
  ) return false;
  let recovered: string;
  try {
    recovered = await recoverMessageAddress({
      message: IDENTITY_MESSAGE,
      signature: binding.signature as `0x${string}`,
    });
  } catch {
    return false;
  }
  return (
    recovered.toLowerCase() === binding.address.toLowerCase() &&
    derivePubkey(binding.signature) === binding.pubkey
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/nostr/test/identity.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/nostr/src/identity.ts packages/nostr/test/identity.test.ts
git commit -m "feat(nostr): binding verification"
```

---

### Task 5: Event signing and signature verification (`events.ts`)

**Files:**
- Create: `packages/nostr/src/events.ts`
- Test: `packages/nostr/test/events.test.ts`

**Interfaces:**
- Consumes: `Binding`, `AssetUpdatePayload`, `KIND_ASSET_UPDATE`, `TAG_TOKEN`, `deriveSecretKey` (Tasks 2–3).
- Produces: `tokenTag(chainId: number, contractAddress: string, tokenId: string): string`, `signAssetUpdate(binding: Binding, payload: AssetUpdatePayload, contractAddress: string): NostrEvent`, `verifyEventSignature(event: NostrEvent): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/nostr/test/events.test.ts
import { describe, it, expect } from "@jest/globals";
import { generatePrivateKey, privateKeyToAccount } from "viem";
import { buildBinding } from "@arbesk/nostr/identity.js";
import { signAssetUpdate, verifyEventSignature, tokenTag } from "@arbesk/nostr/events.js";
import { KIND_ASSET_UPDATE, TAG_TOKEN } from "@arbesk/nostr/kinds.js";

const CONTRACT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

describe("events", () => {
  it("signs an update event with the binding key and verifies", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const binding = await buildBinding({ signMessage: (m) => account.signMessage({ message: m }) });
    const payload = { chainId: 31415822, tokenId: "42", newAssetURI: "bafyexample" };
    const event = signAssetUpdate(binding, payload, CONTRACT);
    expect(event.kind).toBe(KIND_ASSET_UPDATE);
    expect(event.pubkey).toBe(binding.pubkey);
    expect(event.tags).toContainEqual([TAG_TOKEN, tokenTag(payload.chainId, CONTRACT, payload.tokenId)]);
    expect(JSON.parse(event.content)).toMatchObject({ chainId: payload.chainId, tokenId: "42", newAssetURI: "bafyexample" });
    expect(verifyEventSignature(event)).toBe(true);
  });

  it("rejects a tampered event", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const binding = await buildBinding({ signMessage: (m) => account.signMessage({ message: m }) });
    const event = signAssetUpdate(binding, { chainId: 1, tokenId: "1", newAssetURI: "a" }, CONTRACT);
    expect(verifyEventSignature({ ...event, content: "forged" })).toBe(false);
  });

  it("builds a lowercase token tag", () => {
    expect(tokenTag(84532, CONTRACT, "7")).toBe(`84532:${CONTRACT.toLowerCase()}:7`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/nostr/test/events.test.ts`
Expected: FAIL — `Cannot find module '@arbesk/nostr/events.js'`.

- [ ] **Step 3: Write `packages/nostr/src/events.ts`**

```ts
import { finalizeEvent, verifyEvent } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";
import type { AssetUpdatePayload, Binding } from "./types.ts";
import { KIND_ASSET_UPDATE, TAG_TOKEN } from "./kinds.ts";
import { deriveSecretKey } from "./identity.ts";

/** Canonical token-scoped tag "<chainId>:<contract>:<tokenId>". */
export function tokenTag(chainId: number, contractAddress: string, tokenId: string): string {
  return `${chainId}:${contractAddress.toLowerCase()}:${tokenId}`;
}

/** Signs a KIND_ASSET_UPDATE event with the key derived from the binding. */
export function signAssetUpdate(
  binding: Binding,
  payload: AssetUpdatePayload,
  contractAddress: string
): NostrEvent {
  const content = JSON.stringify({
    chainId: payload.chainId,
    contractAddress,
    tokenId: payload.tokenId,
    newAssetURI: payload.newAssetURI,
    assetId: payload.assetId ?? null,
  });
  return finalizeEvent(
    {
      kind: KIND_ASSET_UPDATE,
      created_at: Math.floor(Date.now() / 1000),
      content,
      tags: [[TAG_TOKEN, tokenTag(payload.chainId, contractAddress, payload.tokenId)]],
    },
    deriveSecretKey(binding.signature)
  );
}

/** Verifies an event's Schnorr signature. */
export function verifyEventSignature(event: NostrEvent): boolean {
  try {
    return verifyEvent(event);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/nostr/test/events.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/nostr/src/events.ts packages/nostr/test/events.test.ts
git commit -m "feat(nostr): asset-update event signing and verification"
```

---

### Task 6: Publish and end-to-end verify (`publish.ts`, `verify.ts`)

**Files:**
- Create: `packages/nostr/src/publish.ts`
- Create: `packages/nostr/src/verify.ts`
- Test: `packages/nostr/test/verify.test.ts`

**Interfaces:**
- Consumes: `RelayPort`, `ChainReadPort`, `signAssetUpdate`, `verifyEventSignature`, `verifyBinding` (Tasks 2–5).
- Produces: `publishAssetUpdate(binding, payload, contractAddress, relay): Promise<NostrEvent>`, `verifyAssetUpdate(event, binding, payload, chain): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/nostr/test/verify.test.ts
import { describe, it, expect } from "@jest/globals";
import { generatePrivateKey, privateKeyToAccount } from "viem";
import type { NostrEvent } from "nostr-tools";
import { buildBinding } from "@arbesk/nostr/identity.js";
import { signAssetUpdate } from "@arbesk/nostr/events.js";
import { publishAssetUpdate } from "@arbesk/nostr/publish.js";
import { verifyAssetUpdate } from "@arbesk/nostr/verify.js";

const CONTRACT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

describe("publish + verify", () => {
  it("publishes the signed event through the relay", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const binding = await buildBinding({ signMessage: (m) => account.signMessage({ message: m }) });
    let captured: NostrEvent | null = null;
    const relay = { publish: async (e: NostrEvent) => { captured = e; } };
    const payload = { chainId: 31415822, tokenId: "9", newAssetURI: "bafy" };
    const out = await publishAssetUpdate(binding, payload, CONTRACT, relay);
    expect(captured).toBe(out);
    expect(captured!.kind).toBe(20001);
  });

  it("accepts a valid update from the token author", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const binding = await buildBinding({ signMessage: (m) => account.signMessage({ message: m }) });
    const payload = { chainId: 31415822, tokenId: "9", newAssetURI: "bafy" };
    const event = signAssetUpdate(binding, payload, CONTRACT);
    const chain = { isTokenAuthor: async () => true };
    await expect(verifyAssetUpdate(event, binding, payload, chain)).resolves.toBe(true);
  });

  it("rejects when the signer is not the token author", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const binding = await buildBinding({ signMessage: (m) => account.signMessage({ message: m }) });
    const payload = { chainId: 31415822, tokenId: "9", newAssetURI: "bafy" };
    const event = signAssetUpdate(binding, payload, CONTRACT);
    const chain = { isTokenAuthor: async () => false };
    await expect(verifyAssetUpdate(event, binding, payload, chain)).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/nostr/test/verify.test.ts`
Expected: FAIL — `Cannot find module '@arbesk/nostr/publish.js'`.

- [ ] **Step 3: Write `packages/nostr/src/publish.ts`**

```ts
import type { NostrEvent } from "nostr-tools";
import type { AssetUpdatePayload, Binding, RelayPort } from "./types.ts";
import { signAssetUpdate } from "./events.ts";

/** Signs and publishes an asset-update event to the relay. */
export async function publishAssetUpdate(
  binding: Binding,
  payload: AssetUpdatePayload,
  contractAddress: string,
  relay: RelayPort
): Promise<NostrEvent> {
  const event = signAssetUpdate(binding, payload, contractAddress);
  await relay.publish(event);
  return event;
}
```

- [ ] **Step 4: Write `packages/nostr/src/verify.ts`**

```ts
import type { NostrEvent } from "nostr-tools";
import type { AssetUpdatePayload, Binding, ChainReadPort } from "./types.ts";
import { verifyEventSignature } from "./events.ts";
import { verifyBinding } from "./identity.ts";

/** Verifies an update event end-to-end: sig → binding → on-chain authorization. */
export async function verifyAssetUpdate(
  event: NostrEvent,
  binding: Binding,
  payload: AssetUpdatePayload,
  chain: ChainReadPort
): Promise<boolean> {
  if (!verifyEventSignature(event)) return false;
  if (event.pubkey !== binding.pubkey) return false;
  if (!(await verifyBinding(binding))) return false;
  return chain.isTokenAuthor(payload.chainId, payload.tokenId, binding.address);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- packages/nostr/test/verify.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/nostr/src/publish.ts packages/nostr/src/verify.ts packages/nostr/test/verify.test.ts
git commit -m "feat(nostr): publish and end-to-end update verification"
```

---

### Task 7: Facade and public exports (`facade.ts`, `index.ts`)

**Files:**
- Create: `packages/nostr/src/facade.ts`
- Modify: `packages/nostr/src/index.ts`
- Test: `packages/nostr/test/facade.test.ts`

**Interfaces:**
- Produces: `createNostrFacade(config: NostrConfig): NostrFacade` with `createIdentity()`, `signAssetUpdate()`, `publishAssetUpdate()`, `verifyAssetUpdate()`, `verifyBinding()`. Re-export everything from `index.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/nostr/test/facade.test.ts
import { describe, it, expect } from "@jest/globals";
import { generatePrivateKey, privateKeyToAccount } from "viem";
import { createNostrFacade } from "@arbesk/nostr";

describe("facade", () => {
  it("round-trips identity and verification", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const facade = createNostrFacade({
      signer: { signMessage: (m) => account.signMessage({ message: m }) },
      relay: { publish: async () => {} },
      chain: { isTokenAuthor: async () => true },
    });
    const binding = await facade.createIdentity();
    await expect(facade.verifyBinding(binding)).resolves.toBe(true);
    const event = facade.signAssetUpdate(binding, { chainId: 1, tokenId: "1", newAssetURI: "a" }, "0x" + "11".repeat(20));
    await expect(facade.verifyAssetUpdate(event, binding, { chainId: 1, tokenId: "1", newAssetURI: "a" })).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/nostr/test/facade.test.ts`
Expected: FAIL — `Cannot find module '@arbesk/nostr'` (no index exports).

- [ ] **Step 3: Write `packages/nostr/src/facade.ts`**

```ts
import type { AssetUpdatePayload, Binding, NostrConfig } from "./types.ts";
import { buildBinding, verifyBinding } from "./identity.ts";
import { signAssetUpdate } from "./events.ts";
import { publishAssetUpdate } from "./publish.ts";
import { verifyAssetUpdate } from "./verify.ts";
import type { NostrEvent } from "nostr-tools";

export interface NostrFacade {
  createIdentity(): Promise<Binding>;
  verifyBinding(binding: Binding): Promise<boolean>;
  signAssetUpdate(binding: Binding, payload: AssetUpdatePayload, contractAddress: string): NostrEvent;
  publishAssetUpdate(binding: Binding, payload: AssetUpdatePayload, contractAddress: string): Promise<NostrEvent>;
  verifyAssetUpdate(event: NostrEvent, binding: Binding, payload: AssetUpdatePayload): Promise<boolean>;
}

export function createNostrFacade(config: NostrConfig): NostrFacade {
  return {
    createIdentity: () => buildBinding(config.signer),
    verifyBinding,
    signAssetUpdate: (b, p, a) => signAssetUpdate(b, p, a),
    publishAssetUpdate: (b, p, a) => publishAssetUpdate(b, p, a, config.relay),
    verifyAssetUpdate: (e, b, p) => verifyAssetUpdate(e, b, p, config.chain),
  };
}
```

- [ ] **Step 4: Write `packages/nostr/src/index.ts`**

```ts
export { createNostrFacade } from "./facade.ts";
export type { NostrFacade } from "./facade.ts";
export { buildBinding, verifyBinding, deriveSecretKey, derivePubkey } from "./identity.ts";
export { signAssetUpdate, verifyEventSignature, tokenTag } from "./events.ts";
export { publishAssetUpdate } from "./publish.ts";
export { verifyAssetUpdate } from "./verify.ts";
export { KIND_ASSET_UPDATE, KIND_BINDING, TAG_TOKEN, TAG_ADDRESS, IDENTITY_MESSAGE } from "./kinds.ts";
export type { WalletSignPort, RelayPort, ChainReadPort, Binding, AssetUpdatePayload, NostrConfig } from "./types.ts";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- packages/nostr/test/facade.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Run the full package test + build + typecheck**

Run:
```bash
npm test -- packages/nostr
npm run build --workspace @arbesk/nostr
npm run typecheck --workspace @arbesk/nostr
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/nostr/src/facade.ts packages/nostr/src/index.ts packages/nostr/test/facade.test.ts
git commit -m "feat(nostr): facade and public exports"
```