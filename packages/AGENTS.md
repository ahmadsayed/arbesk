# `packages/` — Arbesk SDKs

This directory holds Arbesk's shared, environment-agnostic SDKs, published as
npm **workspaces** (`"workspaces": ["packages/*"]`) under the `@arbesk/*` scope.
Each is one TypeScript codebase compiled by `tsc` to `dist/` (ESM + `.d.ts`),
consumed by bare specifier in the browser, the Node backend, and tests.

The root `AGENTS.md` treats these as **black boxes**. Work inside a package
should follow that package's own guide, not the root one:

| Package | Path | Purpose | Guide |
|---------|------|---------|-------|
| `@arbesk/wallet` | `packages/wallet/` | Wallet/identity/chain: `Signer` port, SIWE, Merkle proofs, contract writes, session store. **Bottom of the stack.** | `packages/wallet/AGENTS.md` |
| `@arbesk/authz` | `packages/authz/` | Asset access policy (ownership + Merkle editor proof), on top of `@arbesk/wallet`. | `packages/authz/AGENTS.md` |
| `@arbesk/asset-core` | `packages/asset-core/` | Asset engine: manifests, glTF/3MF compose/decompose, domain state, editor lists. | `packages/asset-core/AGENTS.md` + `docs/ASSET_CORE_SDK.md` |
| `@arbesk/ai-asset-gen` | `packages/ai-asset-gen/` | 3D-model generation (mock + Tripo3D), capability-gated facade. Backend-only. | `packages/ai-asset-gen/AGENTS.md` |

## Dependency order

```
@arbesk/wallet  ──(depends on)──▶  @arbesk/authz
@arbesk/asset-core                 (independent)
@arbesk/ai-asset-gen               (independent, backend-only)
```

Only `@arbesk/authz` depends on another in-repo package (it imports
`@arbesk/wallet/merkle.js`); `@arbesk/wallet` and `@arbesk/asset-core` are
independent of each other and of the frontend/backend trees.

> **Intentional duplication — Merkle primitives.** Because `@arbesk/asset-core`
> cannot import `@arbesk/wallet` (they are independent), `asset-core` keeps a
> byte-identical copy of the Merkle leaf/root/proof/verify primitives in
> `domain/editors.ts` (`wallet/merkle.ts` is canonical and matches the
> contract). Do NOT deduplicate one side into the other — that breaks the
> dependency order. Keep them in lockstep; `test/merkle-parity.test.js` pins
> byte-parity for all four primitives.

## Shared conventions (all packages)

- **Boundary**: no imports from `frontend/`, `src/api/`, or `constants/`; no
  browser globals (`window`/`document`/`Web3`/`navigator`/`localStorage`); no
  `@babylonjs/*`. eslint enforces this. New capability the package needs from
  the outside → add a port to its `src/types.ts`, never an import.
- **Erasable TypeScript only** (Node type-stripping): no enums/namespaces,
  `import type` for type-only imports, relative imports carry `.ts`.
- **Consumption**: bare specifier + `.js`-suffixed subpaths, e.g.
  `import { createArbeskCore } from "@arbesk/asset-core"` and
  `import { verifyEditorProof } from "@arbesk/wallet/merkle.js"`.
- **Facade pattern**: each package exposes a composition root
  (`createArbeskCore`, `createWalletFacade`, `createAuthz`) that takes injected
  ports, so it stays environment-agnostic.

## Build & test

```bash
npm run build:packages   # tsc → dist/ (ESM + .d.ts) for all four, in dependency order
npm run typecheck        # after build (resolves @arbesk/* via workspace symlinks)
npm test                 # jest maps @arbesk/*.js → each package's .ts source (no build step)
```

`build:packages` is wired as `prestart`/`pretypecheck`/`pretypecheck:frontend`/
`prebuild:frontend`, so it runs automatically where needed. Individual packages
also expose `npm run build --workspace @arbesk/<name>` and
`npm run typecheck --workspace @arbesk/<name>`.
