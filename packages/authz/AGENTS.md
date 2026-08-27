# `@arbesk/authz` — Asset Access Policy SDK

Environment-agnostic authorization SDK: decides whether an address may access
an Arbesk asset — either as the **owner** or via a valid **Merkle editor
proof**. One TypeScript codebase (`packages/authz/`) consumed by the Node
backend (and reusable by any host); compiled by `tsc` to `dist/` (ESM +
`.d.ts`). Built on `@arbesk/wallet`'s Merkle primitives.

## Public API (`src/index.ts`)

| Export | Purpose |
|--------|---------|
| `createAuthz(config)` | Compose the access checker from an injected `ChainReadPort` + session validator. |
| `Authz` (type) | The returned facade. |
| `ChainReadPort` / `AssetAccessOptions` / `AssetAccessResult` / `ResolvedContract` / `AuthzConfig` | Port + config types. |

`Authz` facade (`src/facade.ts`):

- `checkAssetAccess(tokenId, chainId, address, opts?) → AssetAccessResult` —
  owner check first; on failure, verify a Merkle editor proof if supplied.
- `authorizeAssetAccess(token, tokenId, chainId, opts?)` — validates the session
  token to an address, then `checkAssetAccess` (returns `null` on bad session).
- `getTokenUri(tokenId, chainId, opts?)` — read `tokenURI` through the port.

`AssetAccessResult`: `{ allowed, assetId, chainId, isOwner, role }`.

## How access is decided (`src/facade.ts`)

1. **Resolve the contract** via the host-injected `resolveContract(chainId,
   contractAddressOverride?)` → `{ chainId, contractAddress, chain: ChainReadPort }`.
2. **Build the canonical asset tag** — `assetId = \`${chainId || defaultChainId}:${contractAddress}:${tokenId}\``
   (token IDs are `uint256`, coerced with `BigInt`).
3. **Owner check** — `chain.ownerOf(tokenId)`; a match returns
   `{ allowed: true, isOwner: true, role: 2 }`.
4. **Merkle editor proof** — when `opts.proof` + `opts.requiredRole` are
   supplied: read `editorRoot` + `editorSetVersion` from the port, build the
   leaf with `@arbesk/wallet`'s `makeLeaf`, and `verifyEditorProof`. Success →
   `{ allowed: true, isOwner: false, role: requiredRole }`.
5. Otherwise → `{ allowed: false, role: 0 }`. Proof-verification failures are
   logged (`[AUTHZ]`) and treated as deny, never thrown.

## Ports (`src/types.ts`)

- `ChainReadPort` — the only on-chain surface: `ownerOf`, `editorRoot`,
  `editorSetVersion`, `tokenURI` (all read-only).
- `AuthzConfig` — `validateSession(token) → address | null`, `defaultChainId`,
  `resolveContract(chainId, contractAddressOverride?)`.

The package knows nothing about `web3`/`viem` contract wiring — the host
implements `ChainReadPort` and `resolveContract`. In this repo the backend does
that in `src/api/asset-core-adapters.ts` / the authorization route (moved from
`src/api/authorization.ts`).

## Boundary rules

- Depends only on `@arbesk/wallet` (imports `@arbesk/wallet/merkle.js`).
- No imports from `frontend/`, `src/api/`, or `constants/`; no browser globals —
  eslint enforces this (`eslint.config.js`).
- Erasable TypeScript only: no enums/namespaces, `import type` for type-only
  imports, relative imports carry `.ts`.

## Build & test

```bash
npm run build:packages   # tsc → dist/ (ESM + .d.ts)
npm run typecheck        # after build
npm test                 # jest maps @arbesk/authz/*.js → source
```

Roles follow the wallet SDK's Merkle convention: `1` = Viewer, `2` = Editor;
owners are treated as role `2`. New proof kinds or policies belong here, not in
the routes that call it.
