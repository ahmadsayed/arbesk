# `@arbesk/wallet` — Wallet / Identity / Chain SDK

Environment-agnostic wallet, identity, and chain SDK for Arbesk: the `Signer`
port, SIWE build/verify, Merkle editor proofs, typed contract writes, and the
session store. One TypeScript codebase (`packages/wallet/`) consumed by the
browser, the Node backend, and tests — compiled by `tsc` to `dist/` (ESM +
`.d.ts`). This is the **bottom** of the SDK stack: `@arbesk/authz` and the
backend/frontend both build on it.

## Public API (`src/index.ts`)

| Export | Purpose |
|--------|---------|
| `createWalletFacade({ signer })` | Client-facing identity facade: `sign`, `getSiwe`, `getMerkleProof`. |
| `buildSiweProof({ signer, … })` | Standalone SIWE build+sign for callers holding a raw `Signer` (e.g. `services/api.ts`). |
| `buildUserIdentity({ address, email?, source })` | Build the `UserIdentity` for a connected wallet. |
| `createAssetContract({ signer, address, abi })` | Typed contract writes — `publish`, `updateUri`, `updateEditors`, `burn`, generic `call`. |
| `createEoaSigner(web3, address)` | Reference EOA `Signer` adapter (wraps an injected Web3.js/EIP-1193 instance). |
| `buildSiweMessage` / `generateNonce` / `parseSiweMessage` / `verifySiwe` / `_resetSiweNonceStoreForTesting` | SIWE (EIP-4361) build + verify in one module. |
| `verifyAuthProof(proof, ctx)` | Proof-verification dispatcher (`siwe` \| `oidc`) — the single session-creation entry point. |
| `createMemorySessionStore(opts?)` | In-memory `SessionStore` (24h TTL, hourly cleanup). |
| `makeLeaf` / `computeRoot` / `getProof` / `verifyEditorProof` / `MAX_EDITORS_PER_TOKEN` / `ZERO_HASH` | Merkle editor-tree primitives. |

## Key concepts

- **`Signer` port** (`src/types.ts`) — the on-chain signing/sending seam:
  `getAddress()` (on-chain owner), `getSignerAddress()` (key that signs),
  `getChainId()`, `signMessage()` (EIP-191), `sendTransaction()` →
  `SendResult { hash, wait() }`. The two concrete kinds are **EOA** and **CDP**
  smart account (`source: "eoa" | "cdp"`); for an EOA both addresses are the
  same, for CDP they differ (owner = smart account, signer = embedded EOA).
- **Identity vs signer are separate.** `UserIdentity` is the "who"
  (`buildUserIdentity`); `Signer` is the "how-on-chain". This lets an OAuth
  login have identity without a signer.
- **SIWE is a single shared contract** (`src/siwe.ts`): `buildSiweMessage`
  (browser) and `parseSiweMessage`/`verifySiwe` (backend) live in one module so
  the emitted message round-trips through verification by construction.
  `verifySiwe` does domain binding, version/chain checks, issued-at freshness
  (5 min), nonce replay protection (10 min), then signature verification
  (EOA/EIP-1271/ERC-6492 via the injected `SignatureVerifier`), with a CDP
  EOA-signature fallback.
- **Merkle editor tree** (`src/merkle.ts`): leaf encoding
  `keccak256(abi.encodePacked(address, role(uint8), tokenId(uint256), setVersion(uint256)))`
  — byte-identical to `ArbeskAssetBase._requireEditor` and to asset-core's
  `HashPort` path. Roles: `1` = Viewer, `2` = Editor. `MAX_EDITORS_PER_TOKEN = 5000`.
- **Contract client** (`src/contract.ts`): ABI-encodes calldata with `viem`
  (the SDK owns encoding) and delegates broadcast+wait to the injected
  `Signer`, so it is wallet-kind-independent. `tokenId` is `uint256` on-chain —
  always coerce to `bigint`.
- **Seams** (host injects, package never imports): `SignatureVerifier` (backend
  wires `viem`/`web3` recovery) and `SessionStore` (backend in-memory, browser
  localStorage-backed).

## Structure

```
src/
  facade.ts        createWalletFacade, buildSiweProof, buildUserIdentity
  types.ts         Signer, SendResult, MinedReceipt, UserIdentity, AuthProof,
                   AuthMechanism, SessionStore, SignatureVerifier
  siwe.ts          SIWE build + verify (browser + backend halves)
  verify.ts        verifyAuthProof dispatcher (siwe | oidc; oidc is a seam)
  merkle.ts        editor-tree leaf/root/proof/verify primitives
  session.ts       createMemorySessionStore
  contract.ts      createAssetContract (viem-encoded writes)
  adapters/eoa.ts  createEoaSigner (wraps injected web3)
```

## Boundary rules

- **No browser globals.** `createEoaSigner` receives `web3` by injection;
  `siwe.ts` reads `window.location.origin` only behind a `typeof window` guard.
- **CDP signer lives outside the package** — `frontend/src/js/blockchain/wallet-cdp.ts`
  implements the same `Signer` port using `@coinbase/cdp-core`, because it needs
  the CDP SDK and the browser environment.
- No imports from `frontend/`, `src/api/`, or `constants/`; no
  `window`/`document`/`Web3`/`navigator`/`localStorage` references — eslint
  enforces this (`eslint.config.js`).
- Erasable TypeScript only (Node type-stripping): no enums/namespaces, `import
  type` for type-only imports, relative imports carry `.ts`.

## Build & test

```bash
npm run build:packages      # tsc → dist/ (ESM + .d.ts), all three packages
npm run typecheck           # after build (resolves @arbesk/* via workspace)
npm test                    # jest maps @arbesk/wallet/*.js → source via moduleNameMapper
```

Consumers import by bare specifier: `import { createWalletFacade } from
"@arbesk/wallet"`, subpaths as `@arbesk/wallet/merkle.js` (used by
`@arbesk/authz`). Frontend/backend adapters that used to hold this logic
(`wallet-core.ts`, `wallet-cdp.ts`, `src/api/siwe-verify.ts`,
`src/api/sessions.ts`, `src/api/proof-verify.ts`) now consume this package.
