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
