# web3.js → viem Full Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove web3.js entirely — the CDN global (web3@1.10.0, `frontend/src/pug/includes/head.pug:83`) and the npm package (web3@^4.15, root `package.json`) — so the whole repo talks to EVM chains through viem, matching the SDK packages.

**Architecture:** Backend: replace `src/config.ts`'s `makeWeb3`/`getWeb3` with a cached viem `createPublicClient` factory (`getPublicClient(chainId)`); every read becomes `readContract`/`getLogs`/`getBlockNumber`; `accounts.recover` becomes viem `recoverMessageAddress`. SDK: `createEoaSigner(web3, address)` becomes `createEoaSigner(provider, address)` — an EIP-1193 provider wrapped in viem `createWalletClient`/`createPublicClient`. Frontend: a new `viem-clients.ts` module provides per-chain cached read clients and a wallet client over the injected provider; `getActiveContract()` returns a viem `getContract` instance (call sites go from `c.methods.x(a).call()` to `c.read.x([a])`); the send path switches from web3 `method.encodeABI()` to viem `encodeFunctionData` (with full-signature `functionName` for overloads), keeping the `Signer` port as the broadcast seam; `error-decoder.ts` is replaced by viem `decodeErrorResult`. The CDN script tag is deleted and `"viem"` is added to the importmap (esm.sh pin, same style as the existing `viem/utils` entry).

**Tech Stack:** viem ^2.52.2 (already a dependency), TypeScript (Node type-stripping backend, swc per-file emit frontend), Jest (ESM), Playwright E2E.

**Spec:** none separate — this plan is self-contained, built from a full inventory of web3 touchpoints taken 2026-08-29 (the "web3.js → viem Migration Inventory" report; key facts are copied into each task).

## Global Constraints

- Erasable TypeScript only (`packages/*`, `src/`, `frontend/src/js/`): no enums/namespaces/parameter properties; type-only imports MUST use `import type`; relative imports carry explicit `.ts` extensions.
- `packages/*` boundary: no imports from `frontend/`, `src/api/`, `constants/`; no browser globals (`window`/`document`/`Web3`/`navigator`/`localStorage`) — eslint enforces.
- Frontend import specifiers match the on-disk file (`.ts` for TS modules); SDK imports use bare specifier + `.js` subpaths.
- Out-of-the-box first: use viem's built-ins (`readContract`, `getLogs`, `getContract`, `decodeErrorResult`, `encodeFunctionData`, `recoverMessageAddress`) — do not hand-roll ABI codecs or log decoders.
- Jest runs as: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest <file>`.
- uint256 args/returns are `bigint` under viem (web3 accepted strings): coerce with `BigInt(tokenId)` at call sites; normalize bigint returns to `String(...)`/`Number(...)` where the surrounding code expects them.
- viem `getPublicClient`/`getLogs` `fromBlock`/`toBlock` are bigint; `DEPLOYMENT_BLOCKS`/`LOG_CHUNK_SIZES` from `constants/chains.js` stay the source of block numbers (no magic numbers).
- Commit style: conventional commits, e.g. `refactor(api): ...`, `refactor(wallet): ...`.
- Do NOT remove `web3-utils` yet — `test/frontend/asset-core-hash-port.test.js` uses it as the byte-parity oracle against the viem HashPort. It becomes a devDependency in Task 13.
- After every task: run the task's covering tests. Behavior must stay identical at every step — this is a migration, not a redesign.

## Canonical shapes (every task references these)

```ts
// Backend read client (src/config.ts) — replaces makeWeb3/getWeb3/web3
import { createPublicClient, http } from "viem";
import type { PublicClient } from "viem";

const publicClients = new Map<number, PublicClient>();
export function getPublicClient(chainId?: number): PublicClient {
  const id = chainId ?? DEFAULT_CHAIN_ID;
  let c = publicClients.get(id);
  if (!c) {
    c = createPublicClient({ transport: http(getRpcUrl(id)) });
    publicClients.set(id, c);
  }
  return c;
}

// Contract read — replaces new web3.eth.Contract(abi, addr).methods.x(a).call()
await getPublicClient(chainId).readContract({
  address: contractAddress as `0x${string}`,
  abi, functionName: "tokenURI", args: [BigInt(tokenId)],
});

// Event logs — replaces web3.eth.getPastLogs / contract.getPastEvents
await getPublicClient(chainId).getLogs({
  address: contractAddress as `0x${string}`,
  events: [TransferAbiItem, EditorSetChangedAbiItem],   // decoded: log.args
  fromBlock: BigInt(deployBlock), toBlock: latest,       // bigints
});

// Frontend read client + contract (frontend/src/js/blockchain/viem-clients.ts)
import { createPublicClient, createWalletClient, custom, http, getContract } from "viem";
export function getReadClient(chainId?: number)  // cached per chain, http(rpcUrl)
export function getWalletClient(provider: any)   // custom(provider), for user txs

// Frontend contract — getActiveContract() returns this; call sites:
//   BEFORE: await c.methods.tokenURI(tokenId).call()
//   AFTER:  await c.read.tokenURI([BigInt(tokenId)])

// Send path (wallet-send.ts) — replaces method.encodeABI() + method.estimateGas()
import { encodeFunctionData } from "viem";
const data = encodeFunctionData({ abi, functionName, args });  // functionName may be a full
// signature for overloads, e.g. "publishAsset(string,uint256,bytes32,string)". If viem
// rejects an overloaded name at runtime, disambiguate by narrowing the ABI:
//   const narrow = abi.filter(i => i.type === "function" && i.name === "publishAsset"
//     && i.inputs.length === 4);

// Gas (wallet-gas.ts) — replaces tx.estimateGas({ from })
const est = await getReadClient(chainId).estimateGas({ account: from, to, data, value });
// keep the existing 20% pad and SMART_ACCOUNT_GAS_LIMIT behavior unchanged

// Error decode (error-decoder.ts) — replaces window.Web3.utils.keccak256 + abi.decodeParameters
import { decodeErrorResult } from "viem";
try {
  const decoded = decodeErrorResult({ abi, data: revertData });
  // decoded.errorName / decoded.args — covers Error(string) and custom errors
} catch { /* fall through to existing generic formatting */ }

// Signature recovery (src/api/identity.ts) — replaces web3.eth.accounts.recover
import { recoverMessageAddress } from "viem";
const addr = await recoverMessageAddress({ message, signature });
```

---

## Part A — Backend + SDK + E2E helpers

### Task 1: `src/config.ts` viem public-client factory

**Files:**
- Modify: `src/config.ts` (delete `makeWeb3`/`getWeb3`/`web3` export; extend the existing viem client at `src/config.ts:12` into the canonical factory)
- Test: `test/config-web3-keepalive.test.js` → rename to `test/config-public-client.test.js` (git mv) and rewrite

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `getPublicClient(chainId?: number): PublicClient` from `src/config.ts` (canonical shape above). Tasks 2-4 import it. The `web3` and `getWeb3` exports are DELETED — Tasks 2-4 remove their consumers in the same part; expect intermediate broken imports if run out of order.

- [ ] **Step 1: Rewrite the test (failing)**

`git mv test/config-web3-keepalive.test.js test/config-public-client.test.js`, then replace its content:

```js
/**
 * src/config.ts chain clients: one cached viem PublicClient per chain id,
 * built on the configured RPC URL. (Replaces the old web3 keep-alive test —
 * viem's http transport uses undici fetch, which keeps connections alive by
 * default; the behavior this suite now pins is per-chain caching.)
 */
import { jest } from "@jest/globals";

const { getPublicClient } = await import("../src/config.ts");

describe("getPublicClient", () => {
  test("returns a cached instance per chain id", () => {
    const a = getPublicClient(31337);
    expect(getPublicClient(31337)).toBe(a);
  });

  test("different chain ids get different clients", () => {
    expect(getPublicClient(31337)).not.toBe(getPublicClient(84532));
  });

  test("omitting chainId uses the default chain", () => {
    expect(getPublicClient()).toBe(
      getPublicClient(Number(process.env.DEFAULT_CHAIN_ID || 84532)),
    );
  });
});
```

Run: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/config-public-client.test.js`
Expected: FAIL — `getPublicClient` is not exported.

- [ ] **Step 2: Implement**

In `src/config.ts`:
- Delete `import Web3 from "web3"`, `Web3Ctor`, `makeWeb3`, the `web3Instances` map, `getWeb3`, and the shared `export const web3 = makeWeb3(API_URL)`.
- Keep the keep-alive agents ONLY if something else uses them (grep `httpsAgent|httpAgent` in src/ first; viem's http transport uses global fetch, which is keep-alive by default on Node — delete the agents if unused).
- Add the canonical `getPublicClient` from the Global Constraints shape. If a viem client already exists in this file (the SIWE/ERC-6492 path), merge it into this factory — one client cache, not two. Keep `getRpcUrl` and `DEFAULT_CHAIN_ID` semantics exactly as they are.

- [ ] **Step 3: Verify**

Run: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/config-public-client.test.js`
Expected: PASS (3 tests). (Suites that still import `getWeb3` will fail until Tasks 2-4 — that is expected mid-part; do not "fix" them here.)

- [ ] **Step 4: Commit**

```bash
git add src/config.ts test/config-public-client.test.js test/config-web3-keepalive.test.js
git commit -m "refactor(api): viem public-client factory replaces the web3 instance cache"
```

---

### Task 2: Backend authz + identity reads → viem

**Files:**
- Modify: `src/api/identity.ts:28` (`accounts.recover`)
- Modify: `src/api/authorization.ts:13,62-69` (ChainReadPort over `.methods.X().call()`)
- Test: `test/api/authorization.test.js` (mock-shape rewrite)
- Test: `test/api.test.js` (only the web3-mock parts this task's files consume — `accounts.recover`; leave indexer/GC parts for Tasks 3-4)

**Interfaces:**
- Consumes: `getPublicClient` from Task 1.
- Produces: `checkAssetAccess`/`getTokenUri` keep their signatures; the internal `ChainReadPort` (`{ ownerOf, editorRoot, editorSetVersion, tokenURI }`) now returns viem-typed values (bigint where web3 returned strings — stringify at the port boundary).

- [ ] **Step 1: Rewrite the mocks (failing)**

In `test/api/authorization.test.js`, replace the `getWeb3` mock with a `getPublicClient` mock:

```js
jest.unstable_mockModule("../src/config.ts", () => ({
  getPublicClient: jest.fn(() => ({
    readContract: jest.fn(async ({ functionName }) => {
      if (functionName === "ownerOf") return OWNER;
      if (functionName === "editorRoot") return ROOT;
      if (functionName === "editorSetVersion") return 1n;
      if (functionName === "tokenURI") return "bafy...";
      throw new Error("unexpected readContract: " + functionName);
    }),
  })),
  // keep any other config.ts exports the module under test uses
}));
```

(Read the existing file first and preserve its test cases verbatim — only the mock shape changes. Values that were strings under web3 become bigint under viem; update expectations accordingly.)

In `test/api.test.js`, find the `jest.unstable_mockModule("web3", ...)` block and remove ONLY the `accounts.recover` branch; add a `recoverMessageAddress` mock via `jest.unstable_mockModule("viem", ...)` ONLY if identity.ts is imported by the app under test — check first; if the SIWE path in api.test.js goes through the injected `SignatureVerifier` seam instead, no viem mock is needed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api/authorization.test.js`
Expected: FAIL — `getPublicClient` mock exists but module still calls `getWeb3`.

- [ ] **Step 3: Implement**

`src/api/identity.ts`: replace

```ts
return web3.eth.accounts.recover(message, signature);
```

with

```ts
return recoverMessageAddress({ message, signature: signature as `0x${string}` });
```

(`import { recoverMessageAddress } from "viem"` — the file already imports from viem; extend that import.)

`src/api/authorization.ts`: replace the `getWeb3`/`new w3.eth.Contract(...)` block with `readContract` calls behind the same ChainReadPort object shape:

```ts
const client = getPublicClient(cid);
const addr = contractAddr as `0x${string}`;
const chainRead: ChainReadPort = {
  ownerOf: async (tokenId) => String(await client.readContract({ address: addr, abi: MINIMAL_COLLAB_ABI, functionName: "ownerOf", args: [BigInt(tokenId)] })),
  editorRoot: async (tokenId) => String(await client.readContract({ address: addr, abi: MINIMAL_COLLAB_ABI, functionName: "editorRoot", args: [BigInt(tokenId)] })),
  editorSetVersion: async (tokenId) => Number(await client.readContract({ address: addr, abi: MINIMAL_COLLAB_ABI, functionName: "editorSetVersion", args: [BigInt(tokenId)] })),
  tokenURI: async (tokenId) => String(await client.readContract({ address: addr, abi: MINIMAL_COLLAB_ABI, functionName: "tokenURI", args: [BigInt(tokenId)] })),
};
```

(Adapt to the file's real ChainReadPort definition — preserve its exact exported behavior and error semantics.)

- [ ] **Step 4: Verify**

Run: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api/authorization.test.js test/api.test.js`
Expected: PASS for authorization; api.test.js may have residual failures only in sections owned by Tasks 3-4 — confirm the failures are those, not yours.

- [ ] **Step 5: Commit**

```bash
git add src/api/identity.ts src/api/authorization.ts test/api/authorization.test.js test/api.test.js
git commit -m "refactor(api): authz + identity reads via viem readContract/recoverMessageAddress"
```

---

### Task 3: token-indexer → viem getLogs

**Files:**
- Modify: `src/api/token-indexer.ts`
- Test: `test/token-indexer.test.js`, `test/token-indexer-shared.test.js` (mock-shape rewrite)

**Interfaces:**
- Consumes: `getPublicClient` from Task 1.
- Produces: unchanged indexer public API and indexer behavior (same events indexed, same token IDs surfaced). Internally: decoded logs via viem `getLogs({ events })` — the manual topic slicing (`log.topics[3]`, `topics[2].slice(-40)`) is deleted in favor of `log.args.tokenId` / `log.args.to` / `log.args.version`.

- [ ] **Step 1: Rewrite the mocks (failing)**

In both test files, replace the `getWeb3` mock:

```js
jest.unstable_mockModule("../src/config.ts", () => ({
  getPublicClient: jest.fn(() => ({
    getBlockNumber: jest.fn(async () => 12345n),
    getLogs: jest.fn(async () => []),
    readContract: jest.fn(async () => "bafyeditors"),
  })),
  getContractAddress: jest.fn(() => "0x5FbDB2315678afecb367f032d93F642f64180aa3"),
  NETWORK_CONFIGS: { 31337: { contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3", rpcUrl: "http://127.0.0.1:8545" } },
}));
```

Then update each test that feeds logs: build fake decoded log objects instead of raw topics:

```js
// BEFORE: { topics: [T0, fromTopic, toTopic, tokenIdTopic], blockNumber: ... }
// AFTER:  { eventName: "Transfer", args: { from: ZERO, to: OWNER, tokenId: 7n }, blockNumber: 100n }
```

Preserve every test's scenario and assertions — only the fixture shape changes.

- [ ] **Step 2: Run to verify fail**

Run: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/token-indexer.test.js test/token-indexer-shared.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/api/token-indexer.ts`:
- Delete the `this.web3`/`this.contract` fields; store `this.client = getPublicClient(chainId)` and keep `contractAddress`.
- `getPastLogs({ topics: [[TRANSFER_TOPIC0, EDITOR_SET_CHANGED_TOPIC0]], ... })` →

```ts
const logs = await this.client.getLogs({
  address: this.contractAddress as `0x${string}`,
  events: INDEXER_EVENTS,   // the Transfer + EditorSetChanged ABI items, extracted from INDEXER_ABI
  fromBlock: BigInt(from), toBlock: BigInt(to),
});
```

- Replace the manual topic decoding with `log.args` (`String(log.args.tokenId)`; editor-set events carry the version in args). Keep `DEPLOYMENT_BLOCKS`/`LOG_CHUNK_SIZES` chunking exactly as-is (coerce to bigint at the getLogs call).
- `this.web3.eth.getBlockNumber()` → `await this.client.getBlockNumber()` (bigint; `Number(...)` where the code wants a number).
- `editorListURI` `.call()` → `readContract`.
- Delete `web3.utils.toBigInt` uses — values are already bigint.

- [ ] **Step 4: Verify**

Run: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/token-indexer.test.js test/token-indexer-shared.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/token-indexer.ts test/token-indexer.test.js test/token-indexer-shared.test.js
git commit -m "refactor(api): token indexer on viem getLogs with decoded event args"
```

---

### Task 4: ipfs-gc → viem

**Files:**
- Modify: `src/api/ipfs-gc.ts`
- Test: `test/api.test.js` (remove the remaining `web3` mock — Contract/getPastEvents/getBlockNumber/abi.decodeParameters branches), `test/manifest-archive-integration.test.js` (config mock stub update)

**Interfaces:**
- Consumes: `getPublicClient` from Task 1.
- Produces: unchanged GC behavior; the helper that took a web3 `Contract` now takes `{ client, address, abi }` (or the read port from Task 2's shape — match what the file's internals need).

- [ ] **Step 1: Update the tests (failing)**

In `test/api.test.js`, delete the entire `jest.unstable_mockModule("web3", ...)` block and replace with a `../src/config.ts` mock exposing `getPublicClient` whose `readContract`/`getLogs`/`getBlockNumber` return the fixtures the existing tests feed through the old web3 mock (read the current mock — each `methods.X().call` and `getPastEvents` fixture maps 1:1 to `readContract({functionName})` / `getLogs`).

In `test/manifest-archive-integration.test.js`, replace `getWeb3: () => ({}), web3: {}` with `getPublicClient: () => ({})`.

- [ ] **Step 2: Run to verify fail**

Run: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api.test.js`
Expected: FAIL (module still imports web3 factory).

- [ ] **Step 3: Implement**

In `src/api/ipfs-gc.ts`:
- Delete `import { web3, getWeb3 }`, `import type { Contract } from "web3"`, `import type { EventLog } from "web3-eth-contract"`.
- `new w3.eth.Contract(abi, address)` reads → `getPublicClient(chainId).readContract(...)`.
- `contract.getPastEvents("Transfer", { filter: { from: ZERO_ADDRESS }, fromBlock, toBlock })` → `client.getLogs({ address, event: transferAbiItem, args: { from: zeroAddress }, fromBlock: BigInt(fromBlock), toBlock: BigInt(toBlock) })`; `event.returnValues.tokenId` → `log.args.tokenId`.
- `getBlockNumber` → bigint → `Number(...)`.
- Local types replacing `Contract`/`EventLog`: define `type ContractRef = { address: \`0x${string}\`; abi: Abi }` and use viem's `Log` typing loosely (`any` is acceptable where the old code was untyped — don't over-type).

- [ ] **Step 4: Verify**

Run: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api.test.js test/manifest-archive-integration.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/ipfs-gc.ts test/api.test.js test/manifest-archive-integration.test.js
git commit -m "refactor(api): ipfs-gc on viem readContract/getLogs"
```

---

### Task 5: `createEoaSigner` → EIP-1193 + viem

**Files:**
- Modify: `packages/wallet/src/adapters/eoa.ts`
- Modify: `packages/wallet/AGENTS.md` (the `createEoaSigner(web3, address)` row)
- Test: find the existing eoa-signer test if any (`Grep createEoaSigner test/`) — otherwise create `test/wallet-eoa-signer.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (Task 8 relies on this): `createEoaSigner(provider: Eip1193Provider, address: string): Signer` — SAME `Signer` port as before (`getAddress/getSignerAddress/getChainId/signMessage/sendTransaction` → `{ hash, wait() }`), but the first arg is now a raw EIP-1193 provider (the thing wallet-core already holds as `web3Provider`), NOT a web3 instance.

- [ ] **Step 1: Write the failing test**

Create `test/wallet-eoa-signer.test.js`:

```js
/**
 * createEoaSigner: EIP-1193 provider in, Signer port out. personal_sign must
 * carry exactly [message, address] (no web3-style empty password param), and
 * sendTransaction resolves the hash at broadcast with wait() polling the
 * receipt.
 */
import { jest } from "@jest/globals";
import { createEoaSigner } from "@arbesk/wallet/adapters/eoa.js";

function fakeProvider(handler) {
  const calls = [];
  return { calls, request: jest.fn(async ({ method, params }) => { calls.push({ method, params }); return handler(method, params); }) };
}

describe("createEoaSigner (EIP-1193)", () => {
  test("signMessage issues personal_sign with [message, address] only", async () => {
    const p = fakeProvider(() => "0xsig");
    const s = createEoaSigner(p, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    await s.signMessage("hello");
    const call = p.calls.find((c) => c.method === "personal_sign");
    expect(call.params).toHaveLength(2);
  });

  test("sendTransaction returns hash and wait() resolves a mined receipt", async () => {
    const p = fakeProvider((method) => {
      if (method === "eth_sendTransaction") return "0xhash";
      if (method === "eth_getTransactionReceipt") return { transactionHash: "0xhash", status: "0x1", blockNumber: "0x7" };
      if (method === "eth_chainId") return "0x7a69";
      if (method === "eth_blockNumber") return "0x7";
      throw new Error("unexpected " + method);
    });
    const s = createEoaSigner(p, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    const res = await s.sendTransaction({ to: "0x0000000000000000000000000000000000000001", data: "0x" });
    expect(res.hash).toBe("0xhash");
    const receipt = await res.wait();
    expect(receipt.transactionHash).toBe("0xhash");
    expect(receipt.status).toBe(true);
  });
});
```

Run it — Expected: FAIL (current signature expects a web3 instance).

- [ ] **Step 2: Implement**

Rewrite `packages/wallet/src/adapters/eoa.ts`:

```ts
/**
 * Reference EOA Signer adapter: wraps a raw EIP-1193 provider (injected wallet
 * or WalletConnect) with viem wallet/public clients. personal_sign carries
 * exactly [message, address] — the web3 empty-password quirk is gone.
 */
import { createPublicClient, createWalletClient, custom } from "viem";
import type { Signer, SendResult, MinedReceipt } from "../types.ts";

/** Minimal EIP-1193 shape (the package may not reference window.ethereum types). */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export function createEoaSigner(provider: Eip1193Provider, address: string): Signer {
  const transport = custom(provider as any);
  const wallet = createWalletClient({ transport });
  const reader = createPublicClient({ transport });
  const account = address as `0x${string}`;
  return {
    source: "eoa",
    getAddress: () => address,
    getSignerAddress: () => address,
    getChainId: () => reader.getChainId(),
    signMessage: (message: string) =>
      wallet.signMessage({ account, message }) as Promise<string>,
    async sendTransaction({ to, value, data, gas }): Promise<SendResult> {
      const hash = await wallet.sendTransaction({
        account, to: to as `0x${string}`,
        value: value === undefined ? undefined : BigInt(value),
        data: data as `0x${string}` | undefined,
        gas: gas === undefined ? undefined : BigInt(gas),
      });
      return {
        hash,
        wait: async (): Promise<MinedReceipt> => {
          const r = await reader.waitForTransactionReceipt({ hash, pollingInterval: 250 });
          return {
            transactionHash: r.transactionHash,
            status: r.status === "success" ? true : r.status === "reverted" ? false : null,
            blockNumber: Number(r.blockNumber),
          };
        },
      };
    },
  };
}
```

Preserve the existing gas-omission behavior (gas left undefined → the wallet estimates at send — same as the old web3 path). Check `../types.ts` for the exact `sendTransaction` param shape and `MinedReceipt` fields and match them.

- [ ] **Step 3: Verify + typecheck**

Run: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/wallet-eoa-signer.test.js`
Run: `npm run build:packages && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 4: Update packages/wallet/AGENTS.md** — the `createEoaSigner` row now reads "wraps an injected EIP-1193 provider"; the Boundary-rules bullet about web3 injection is deleted.

- [ ] **Step 5: Commit**

```bash
git add packages/wallet/src/adapters/eoa.ts packages/wallet/AGENTS.md test/wallet-eoa-signer.test.js
git commit -m "refactor(wallet): EOA signer wraps a raw EIP-1193 provider via viem"
```

---

### Task 6: E2E helpers + drop the npm web3 dependency

**Files:**
- Modify: `e2e/helpers/manifest.mjs` (tokenURI read)
- Modify: `e2e/specs/07-collection-assets.spec.js:322-327` (in-page `window.Web3.utils.soliditySha3`)
- Modify: `e2e/fixtures/hardhat-provider.mjs:63-64` (delete the personal_sign empty-password workaround)
- Modify: `package.json` (remove `"web3"`; move `"web3-utils"` to devDependencies — it stays as the hash-parity oracle)
- Test: the E2E run itself (Step 4)

**Interfaces:**
- Consumes: Tasks 1-5 (backend must be web3-free so nothing in the stack under test pulls web3).
- Produces: no runtime importer of `web3` remains anywhere (`Grep 'from "web3"'` → only docs/plans).

- [ ] **Step 1: manifest.mjs**

Replace `import Web3 from "web3"` + `new Web3(HARDHAT_RPC)` + `new web3.eth.Contract(TOKEN_URI_ABI, addr).methods.tokenURI(id).call()` with:

```js
import { createPublicClient, http } from "viem";

const client = createPublicClient({ transport: http(HARDHAT_RPC) });
// ...
const uri = await client.readContract({
  address: contractAddress, abi: TOKEN_URI_ABI,
  functionName: "tokenURI", args: [BigInt(tokenId)],
});
```

- [ ] **Step 2: 07-collection-assets spec**

The `page.evaluate(() => window.Web3.utils.soliditySha3(...))` call computes an expected hash in-page. Compute it in Node instead with the same inputs:

```js
import { encodePacked, keccak256 } from "viem/utils";
const expected = keccak256(encodePacked(["address", "string"], [addr.toLowerCase(), name]));
```

(Read the spec's actual usage first — match the arg types it hashes.) Then delete the page.evaluate block.

- [ ] **Step 3: hardhat-provider.mjs + package.json**

Delete the `params.slice(0, 2)` personal_sign workaround and its comment (web3.js no longer exists in the app). In `package.json`: remove `"web3": "^4.15.0"`; move `"web3-utils"` into `devDependencies` with the same version. Run `npm install` to refresh the lockfile.

- [ ] **Step 4: Verify**

```bash
IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest --silent 2>&1 | tail -5   # full suite green (frontend tasks haven't landed yet — frontend suites still pass because the CDN tag is still present and frontend code is untouched)
npm run test:e2e -- --project=chromium
```

Expected: jest green; E2E green.

- [ ] **Step 5: Commit**

```bash
git add e2e/helpers/manifest.mjs e2e/specs/07-collection-assets.spec.js e2e/fixtures/hardhat-provider.mjs package.json package-lock.json
git commit -m "refactor(e2e): helpers on viem; drop the npm web3 dependency"
```

---

## Part B — Frontend

### Task 7: `viem-clients.ts` + importmap + send/gas path

**Files:**
- Create: `frontend/src/js/blockchain/viem-clients.ts`
- Modify: `frontend/src/pug/includes/head.pug` (importmap only — the CDN script tag stays until Task 13)
- Modify: `frontend/src/js/blockchain/wallet-send.ts`, `frontend/src/js/blockchain/wallet-gas.ts`
- Test: `test/frontend/wallet-send.test.js`, `test/frontend/wallet-gas.test.js`

**Interfaces:**
- Consumes: Task 5's `Signer` semantics (unchanged port).
- Produces (Tasks 8-12 rely on these):
  - `getReadClient(chainId?: number): PublicClient` — cached per chain, `http(NETWORKS[id].rpcUrl)`; default = active network from wallet-core state (read how wallet-core tracks the active chain id and use that source).
  - `getWalletClient(provider): WalletClient` — `custom(provider)`.
  - `sendContractCall({ to, abi, functionName, args, value?, chainId? }): Promise<SendResult>` in wallet-send.ts — encodes with viem `encodeFunctionData`, estimates via wallet-gas `resolveGas({ to, data, value, chainId })`, broadcasts through `getSigner()`.
  - `resolveGas({ to, data, value, chainId? }): Promise<bigint | undefined>` in wallet-gas.ts — `getReadClient(chainId).estimateGas({ account: from, to, data, value })` + existing 20% pad; CDP smart accounts keep `SMART_ACCOUNT_GAS_LIMIT = 2_000_000` behavior unchanged.

- [ ] **Step 1: Rewrite the two test files (failing)**

`test/frontend/wallet-send.test.js`: the current mock is a web3 method object `{ encodeABI }`. New shape — mock the signer and viem-clients:

```js
jest.unstable_mockModule("../frontend/src/js/blockchain/viem-clients.ts", () => ({
  getReadClient: jest.fn(() => ({ estimateGas: jest.fn(async () => 100000n) })),
  getWalletClient: jest.fn(),
}));
// signer mock: sendTransaction → { hash: "0xh", wait: async () => ({ transactionHash: "0xh", status: true }) }
```

Assert: `sendContractCall({ to, abi, functionName: "burn(uint256,bytes32[])", args: [7n, []] })` calls `signer.sendTransaction` with `to`, encoded `data` starting with the correct 4-byte selector (compute the expected selector in the test with viem `encodeFunctionData` — that's the oracle), and the padded gas.

`test/frontend/wallet-gas.test.js`: mock `{ estimateGas }` on the read client instead of `tx.estimateGas`; keep every existing scenario (pad math, CDP cap, failure fallback) — only the seam changes.

- [ ] **Step 2: Run to verify fail**

Run: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/wallet-send.test.js test/frontend/wallet-gas.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `frontend/src/js/blockchain/viem-clients.ts`:

```ts
/**
 * viem clients for the browser. Reads go through per-chain cached public
 * clients (HTTP RPC); user transactions go through a wallet client wrapping
 * the injected EIP-1193 provider. This module replaces the web3 instances
 * wallet-core used to own.
 */
import { createPublicClient, createWalletClient, custom, http } from "viem";
import type { PublicClient, WalletClient } from "viem";
import { NETWORKS } from "./wallet-core.ts";   // check the real export name/location of the network map

const readClients = new Map<number, PublicClient>();

/** Cached read client for a chain (default: the active network). */
export function getReadClient(chainId?: number): PublicClient {
  const id = chainId ?? activeChainId();   // implement activeChainId() from wallet-core's state
  let c = readClients.get(id);
  if (!c) {
    c = createPublicClient({ transport: http(NETWORKS[id].rpcUrl) });
    readClients.set(id, c);
  }
  return c;
}

/** Wallet client over the injected provider (signing + sending). */
export function getWalletClient(provider: any): WalletClient {
  return createWalletClient({ transport: custom(provider) });
}
```

head.pug importmap: add `"viem": "https://esm.sh/viem@2.52.2",` above the existing `"viem/utils"` line (esm.sh subpath pins require the package root entry when importing `"viem"` bare).

Rewrite `wallet-send.ts` per the canonical shape: `sendContractCall({ to, abi, functionName, args, value, chainId })` → `encodeFunctionData` → `resolveGas` → `getSigner().sendTransaction(...)`. Keep the old exported `sendContractMethod` name ONLY if other modules still import it — grep first and update all importers in this task (wallet-publishing and wallet-payments are Tasks 9; leave them compiling against a TEMPORARY compatibility wrapper if needed — prefer instead: change the signature now and let Tasks 9 fix their call sites immediately after; note the broken intermediate state in your report).

Rewrite `wallet-gas.ts` per the canonical shape, preserving the pad and the CDP `SMART_ACCOUNT_GAS_LIMIT` rule.

- [ ] **Step 4: Verify**

Run: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/wallet-send.test.js test/frontend/wallet-gas.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/blockchain/viem-clients.ts frontend/src/js/blockchain/wallet-send.ts frontend/src/js/blockchain/wallet-gas.ts frontend/src/pug/includes/head.pug test/frontend/wallet-send.test.js test/frontend/wallet-gas.test.js
git commit -m "feat(frontend): viem client module + encodeFunctionData send path"
```

---

### Task 8: wallet-core connection lifecycle without web3

**Files:**
- Modify: `frontend/src/js/blockchain/wallet-core.ts` (the biggest single-file change: delete `newWeb3`, the `web3` instance, receipt-polling knob; `contract` becomes a viem contract)
- Modify: `frontend/src/js/blockchain/wallet.ts` (barrel: drop `web3`/`walletWeb3` exports, add `getReadClient` re-export)
- Test: `test/frontend/wallet-exports.test.js:100-108` (assert the NEW export surface)

**Interfaces:**
- Consumes: Task 7's `viem-clients.ts`, Task 5's `createEoaSigner(provider, address)`.
- Produces (Tasks 9-12 rely on these): `getActiveContract()` returns a viem `getContract` instance (`contract.read.x([...])`); `web3Provider` (raw EIP-1193) export stays; `web3`/`walletWeb3` exports are DELETED.

- [ ] **Step 1: Rewrite wallet-exports test (failing)**

Replace the assertions that `wallet.js` exports `web3` and `contract` with assertions for the new surface: `getActiveContract`, `getReadClient` (re-exported), `web3Provider`, `getSigner`, plus everything else the file already asserted that is NOT web3. Run to verify FAIL.

- [ ] **Step 2: Implement wallet-core.ts**

- Delete `newWeb3()`, the `web3` module-level instance, `transactionPollingInterval` setup, and the web3 v1 polling comment.
- `createEoaSigner(web3, address)` → `createEoaSigner(web3Provider, address)`.
- Contract creation:

```ts
import { getContract } from "viem";
import { getReadClient } from "./viem-clients.ts";
// ...
contract = getContract({
  address: contractAddress as `0x${string}`,
  abi: abiData.abi,
  client: getReadClient(chainId),
});
```

- `web3.eth.getChainId()` → `getReadClient(chainId).getChainId()` (returns number — the token-resolver BigInt dance disappears).
- `web3.eth.getCode(addr)` (wrong-network guard) → `getReadClient(chainId).getCode({ address: addr })`.
- `web3.eth.getBalance` + `web3.utils.fromWei(b, "ether")` → `getReadClient().getBalance({ address })` + viem `formatEther`.
- `web3.eth.requestAccounts()` → `web3Provider.request({ method: "eth_requestAccounts" })`.
- Every `window.web3 = web3` assignment: delete (nothing may depend on it after Task 11; grep to confirm and note remaining consumers as task ordering risks).
- Keep `web3Provider`, account state, event listeners (`accountsChanged`/`chainChanged`), and the wallet modal flows byte-identical in behavior.

- [ ] **Step 3: wallet.ts barrel** — remove `web3`/`walletWeb3` re-exports; re-export `getReadClient` from viem-clients.

- [ ] **Step 4: Verify**

Run: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/wallet-exports.test.js test/frontend/api.test.js --silent 2>&1 | tail -5`
Expected: wallet-exports PASS. `test/frontend/api.test.js` mocks `wallet.js` with `web3.eth.getChainId` — update that mock in this task to the new surface (`getReadClient: () => ({ getChainId: async () => 31337 })`) so it passes too. Other frontend suites that mock the old contract shape stay red until Tasks 9-12 — expected; list them in your report.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/blockchain/wallet-core.ts frontend/src/js/blockchain/wallet.ts test/frontend/wallet-exports.test.js test/frontend/api.test.js
git commit -m "refactor(frontend): wallet-core connection lifecycle without web3"
```

---

### Task 9: wallet-publishing + wallet-payments

**Files:**
- Modify: `frontend/src/js/blockchain/wallet-publishing.ts`
- Modify: `frontend/src/js/blockchain/wallet-payments.ts`
- Test: `test/frontend/wallet-payments.test.js` (mock-shape rewrite)

**Interfaces:**
- Consumes: Task 7's `sendContractCall({ to, abi, functionName, args, value, chainId })` and `getReadClient`; Task 8's `getActiveContract()`.
- Produces: unchanged publishing/payment behavior. Overloaded writes use full-signature `functionName` strings: `"publishAsset(string,uint256,bytes32,string)"`, `"updateAssetURI(uint256,string,bytes32[])"`, `"updateEditors(uint256,bytes32,string,uint8,bytes32[])"`, `"burn(uint256,bytes32[])"`.

- [ ] **Step 1: Rewrite the payments test mock (failing)**

Replace `{ methods: { recordGeneration: () => ({ estimateGas, encodeABI }) } }` and the `web3.utils.{utf8ToHex,padRight}` mock with the new seams: mock `sendContractCall` (jest.fn) and `getReadClient` (`{ readContract: jest.fn(...) }`), or run the real modules against a mocked signer + read client — prefer the latter (tests real encoding). Preserve all scenarios (free-tier detection via `recordGeneration` presence sniff, USDC approve flow, tier cost reads).

- [ ] **Step 2: Implement**

wallet-publishing.ts:
- `c.methods["publishAsset(string,uint256,bytes32,string)"](uri, tokenId, root, listUri)` + sendContractMethod → `sendContractCall({ to: contractAddress, abi, functionName: "publishAsset(string,uint256,bytes32,string)", args: [uri, BigInt(tokenId), root, listUri] })`. Same for the other three ops.
- `tokenURI` reads (e.g. line ~256) → `getActiveContract().read.tokenURI([BigInt(tokenId)])` or `getReadClient().readContract(...)`.

wallet-payments.ts:
- `web3.utils.utf8ToHex(nodeId)` + `padRight(..., 64)` → viem `pad(stringToHex(nodeId), { size: 32 })` (`import { pad, stringToHex } from "viem"`).
- USDC `balanceOf`/`allowance`/`tierCosts`/`usdcToken` reads → `getReadClient(chainId).readContract(...)`.
- `approve`/`payForGenerationWithUSDC`/`recordGeneration` sends → `sendContractCall`.
- `w3.eth.getChainId()` → `getReadClient().getChainId()`.
- The `typeof c.methods.recordGeneration === "function"` free-tier sniff → check the ABI array instead: `abi.some(i => i.type === "function" && i.name === "recordGeneration")` (the ABI is available from the contract descriptor — expose what you need from wallet-core; keep the isFreeTierContract() decision path intact).
- Delete `_getWeb3()` and the `window.web3` fallback.

- [ ] **Step 3: Verify**

Run: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/wallet-payments.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/js/blockchain/wallet-publishing.ts frontend/src/js/blockchain/wallet-payments.ts test/frontend/wallet-payments.test.js
git commit -m "refactor(frontend): publishing + payments on the viem send path"
```

---

### Task 10: token-resolver + error-decoder + wallet-cdp read client

**Files:**
- Modify: `frontend/src/js/blockchain/token-resolver.ts`
- Modify: `frontend/src/js/blockchain/error-decoder.ts`
- Modify: `frontend/src/js/blockchain/wallet-cdp.ts:449-458` (`createCdpReadWeb3`)
- Test: existing coverage — find it first (`Grep -l "token-resolver|error-decoder|createCdpReadWeb3" test/`) and update mock shapes

**Interfaces:**
- Consumes: Task 7's `getReadClient`.
- Produces: token resolution + revert decoding behave identically; `createCdpReadWeb3()` is replaced by a `createCdpReadClient()` returning a viem PublicClient (update its callers — grep for it).

- [ ] **Step 1: Update covering tests (failing)** — mock `getReadClient` (`{ readContract: ... }`) instead of web3 contract instances. Run to verify FAIL.

- [ ] **Step 2: Implement**

token-resolver.ts:
- Cross-chain reads: delete `new window.Web3(new window.Web3.providers.HttpProvider(rpcUrl))`; use `createPublicClient({ transport: http(rpcUrl) })` (cache per rpcUrl in a module Map) + `readContract({ abi: minERC721ABI, functionName: "tokenURI", args: [BigInt(tokenId)] })`.
- Same-chain path: `getActiveContract().read.tokenURI([BigInt(tokenId)])`.
- Delete the web3 v1/v4 getChainId comment + BigInt workaround (viem returns number).

error-decoder.ts — replace the hand-rolled selector/decode logic with viem:

```ts
import { decodeErrorResult } from "viem";
// inside the revert-data handler:
try {
  const d = decodeErrorResult({ abi, data: revertData as `0x${string}` });
  if (d.errorName === "Error") return String(d.args?.[0] ?? "Transaction reverted");
  return `${formatErrorName(d.errorName)}${d.args?.length ? ": " + d.args.join(", ") : ""}`;
} catch { /* unknown selector — fall through to the existing generic formatting */ }
```

Keep the module's exported function names and its provider-error extraction (`error.data` shapes) unchanged — only the decode core changes. Preserve the existing humanization (`formatErrorName`) and fallback messages.

wallet-cdp.ts: `createCdpReadWeb3()` → `export function createCdpReadClient() { return createPublicClient({ transport: http(BASE_SEPOLIA_RPC_URL) }); }`; update callers' `.methods.X().call()` to `readContract`/`client.read.X`.

- [ ] **Step 3: Verify** — run the covering suites found in Step 1. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/js/blockchain/token-resolver.ts frontend/src/js/blockchain/error-decoder.ts frontend/src/js/blockchain/wallet-cdp.ts test/
git commit -m "refactor(frontend): token resolver, error decoder, CDP reads on viem"
```

---

### Task 11: services / ui / engine call-site batch

**Files (one batch, one subagent):**
- Modify: `frontend/src/js/services/asset-delete.ts` (tokenURI reads ~:58,:184,:249)
- Modify: `frontend/src/js/services/library-ops.ts` (ownerOf+tokenURI ~:76-77)
- Modify: `frontend/src/js/services/team.ts` (ownerOf ~:53)
- Modify: `frontend/src/js/services/token.ts` (tokenURI/ownerOf :19,:35)
- Modify: `frontend/src/js/services/asset-save/editor-publish.ts` (editorRoot :23)
- Modify: `frontend/src/js/services/api.ts:345` (`wallet.web3.eth.getChainId()`)
- Modify: `frontend/src/js/ui/library-controller.ts` (tokenURI/ownerOf :70,:108)
- Modify: `frontend/src/js/ui/library-details.ts` (ownerOf :112)
- Modify: `frontend/src/js/ui/asset-library.ts` (getPastEvents :175, getBlockNumber :230, listTokens :284-285, tokenURI :312,:468)
- Modify: `frontend/src/js/engine/scene-graph.ts:803-807`, `frontend/src/js/engine/version-history-deps.ts:21-23` (tokenURI)
- Test: `test/frontend/asset-delete.test.js`, `test/frontend/team.test.js`, `test/frontend/token.test.js`, `test/frontend/editor-publish.test.js`, `test/frontend/asset-library.test.js`, `test/frontend/library-details.test.js`, `test/library-init-integration.test.js`

**Interfaces:**
- Consumes: Task 8's `getActiveContract()` (viem contract) and Task 7's `getReadClient`.
- Produces: every remaining runtime `.methods.X().call()` / `getPastEvents` call site converted. No `window.web3` references remain outside tests.

- [ ] **Step 1: Rewrite the test mocks (failing)**

Mechanical pattern per test file — old:

```js
const _mockContract = { methods: { tokenURI: jest.fn(() => ({ call: jest.fn(async () => "bafy...") })) } };
```

new:

```js
const _mockContract = { read: { tokenURI: jest.fn(async (args) => "bafy...") } };
```

For `asset-library.test.js`'s `getPastEvents` mock: mock `getReadClient` with `getLogs` returning decoded `{ args: { tokenId: 3n, to: OWNER }, blockNumber: 100n, logIndex: 0n }` fixtures instead.

Run all listed suites — Expected: FAIL.

- [ ] **Step 2: Convert the call sites**

Universal pattern: `await c.methods.x(a, b).call()` → `await c.read.x([BigInt(a), b])` (only uint256 params need `BigInt(...)`; addresses/strings pass as-is; stringify/number-ify bigint results to match what the surrounding code expects — e.g. token IDs stay strings: `String(await ...)`).

Special cases:
- `asset-library.ts` `getPastEvents("Transfer", { filter: { from: ZERO_ADDRESS }, fromBlock, toBlock })` chunked walk → `getReadClient(chainId).getLogs({ address: contractAddress, event: TransferAbiItem, args: { from: zeroAddress }, fromBlock: BigInt(from), toBlock: BigInt(to) })`; keep the `LOG_CHUNK_SIZES` chunking and `returnValues.tokenId/to` → `log.args.tokenId/to`; keep `blockNumber`/`logIndex` ordering (both bigint → Number()).
- The `listTokens` feature sniff (`typeof c.methods.listTokens === "function"`) → ABI check: `contractAbi.some(i => i.name === "listTokens")`.
- `services/api.ts:345` → `getReadClient().getChainId()` (import from the wallet barrel).
- `engine/scene-graph.ts` + `version-history-deps.ts`: tokenURI reads → `getActiveContract().read.tokenURI([BigInt(tokenId)])`, result `String(...)`.

- [ ] **Step 3: Verify**

Run: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/asset-delete.test.js test/frontend/team.test.js test/frontend/token.test.js test/frontend/editor-publish.test.js test/frontend/asset-library.test.js test/frontend/library-details.test.js test/library-init-integration.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/js/services/ frontend/src/js/ui/ frontend/src/js/engine/ test/frontend/ test/library-init-integration.test.js
git commit -m "refactor(frontend): convert remaining contract read call sites to viem"
```

---

### Task 12: remaining frontend test batch

**Files:**
- Test: `test/frontend/library-ops.test.js`, `test/frontend/domain-collection.test.js` (fake `window.Web3.utils.soliditySha3`), `test/frontend/build.test.js:171-177` (CDN pin assertion), `test/api.test.js` (final sweep — no web3 mock remnants)

**Interfaces:**
- Consumes: Tasks 7-11.
- Produces: no test installs `window.Web3`; the build test asserts web3 is ABSENT from the built HTML.

- [ ] **Step 1: library-ops + domain-collection**

Both install a fake `window.Web3.utils.soliditySha3` and delegate the HashPort to it. Delete the fake; use the real viem-backed browser HashPort instead:

```js
const { createBrowserHashPort } = await import("../frontend/src/js/blockchain/asset-core-adapter.ts");
// initRuntime({ ...stubs, hash: createBrowserHashPort() })  — same pattern as test/merkle-parity.test.js
```

(This tests MORE than before: the real production hashing path, not a fake.)

- [ ] **Step 2: build.test.js**

Invert the web3 assertions: assert the built `studio.html` does NOT contain `web3@` or `web3.min.js`, and that the importmap contains `"viem": "https://esm.sh/viem@2.52.2"`. (This test goes red here and green in Task 13 when the tag is removed — coordinate: make the assertion now, let it fail, fix in Task 13; OR fold this file into Task 13. Choose folding if simpler — note it in your report.)

- [ ] **Step 3: api.test.js final sweep** — delete any leftover web3 mock branches (`getTransactionReceipt`, `abi.decodeParameters`, `utils.*`) that no module consumes anymore.

- [ ] **Step 4: Verify** — the affected suites.

- [ ] **Step 5: Commit**

```bash
git add test/frontend/library-ops.test.js test/frontend/domain-collection.test.js test/frontend/build.test.js test/api.test.js
git commit -m "test: drop window.Web3 fakes; assert web3-free build output"
```

---

### Task 13: removal sweep + full verification

**Files:**
- Modify: `frontend/src/pug/includes/head.pug:83` (delete the CDN script tag)
- Modify: `frontend/src/js/types/globals.d.ts` and `frontend/src/types/globals.d.ts` (remove `Web3`/`window.web3` declarations)
- Modify: `eslint.config.js:155` (remove the `web3` global)
- Modify: `AGENTS.md` (CDN-globals convention line: remove `Web3, window.web3`; the wallet-stack description if it mentions web3)
- Modify: `packages/wallet/AGENTS.md` if any web3 mention remains (SignatureVerifier seam comment)
- Modify: `frontend/src/js/state/wallet-state.ts:9-10` (comment + type: "viem contract instance")

**Interfaces:**
- Consumes: all previous tasks.
- Produces: zero web3 references outside docs/ and the web3-utils test oracle.

- [ ] **Step 1: The sweep**

Delete the script tag, globals, eslint entry; update AGENTS.md + wallet-state.ts comment. Grep sweep:

```
Grep: window\.Web3|window\.web3|new Web3|from "web3"|require\("web3"\)|Web3\.utils
```

Expected remaining hits: `docs/` (historical), `test/frontend/asset-core-hash-port.test.js` (web3-utils oracle — comment mentions), `.agents/skills/` reference docs. NOTHING else. Any hit in `src/`, `frontend/src/`, `packages/`, `e2e/`, `test/` (other than the oracle) is a leftover — fix it in this task.

- [ ] **Step 2: Rebuild + typecheck + lint**

```bash
npm run build:frontend
npm run typecheck && npm run typecheck:frontend
npm run lint
```

(Lint: the pre-existing `.agents/skills/brainstorming/scripts/*` errors are unrelated — confirm your changes add no NEW errors by comparing against 30 baseline errors.)

- [ ] **Step 3: Full jest**

```bash
IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest --silent 2>&1 | tail -5
```

Expected: all suites pass (155+).

- [ ] **Step 4: E2E** (mandatory — this touches wallet/session auth, save/publish, contracts/ABI):

```bash
./scripts/start-dev.sh --setup-only   # if the stack is down
npm run test:e2e -- --project=chromium
```

Expected: all chromium specs pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pug/includes/head.pug frontend/src/js/types/globals.d.ts frontend/src/types/globals.d.ts eslint.config.js AGENTS.md packages/wallet/AGENTS.md frontend/src/js/state/wallet-state.ts
git commit -m "chore: remove the web3 CDN script and global declarations"
```

---

## Self-Review Notes

- **Inventory coverage:** every web3 touchpoint from the 2026-08-29 inventory maps to a task: config factory (T1), identity/authorization (T2), indexer (T3), ipfs-gc (T4), eoa signer (T5), e2e helpers + npm dep (T6), clients + send/gas (T7), wallet-core (T8), publishing/payments (T9), resolver/decoder/cdp (T10), services/ui/engine batch (T11), test sweep (T12), removal (T13). The `test/frontend/api.test.js` personal.sign mock moves to the signer seam in T8. `test/token-indexer-shared.test.js` in T3.
- **Ordering:** Part A (T1-6) is backend/SDK only and leaves the frontend working (CDN tag untouched until T13). Within Part B, T7→T8→T9→T10→T11→T12→T13 is the dependency order; intermediate states have known-red suites, each listed in its task.
- **Type consistency:** `getPublicClient` (backend, src/config.ts) vs `getReadClient` (frontend, viem-clients.ts) are deliberately different names in different environments; `sendContractCall({ to, abi, functionName, args, value?, chainId? })` is used identically in T7 (definition) and T9 (consumption); `createEoaSigner(provider, address)` matches between T5 (definition) and T8 (consumption).
- **Known risks recorded for the executor:** (a) viem overloaded `functionName` full-signature support — fallback narrowing snippet is in Global Constraints; (b) keep-alive behavior under viem http transport is undici's default — the T1 test pins caching instead of agent internals; (c) E2E hardhat-provider personal_sign workaround must only be removed after T5 lands (T6 is after T5); (d) `getContract` with only a public client exposes `.read` — any write-through-contract remnant must go through `sendContractCall` instead (T9).
