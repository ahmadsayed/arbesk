# Live Scene Updates via Nostr Pub/Sub — Design (non-custodial)

- **Status:** Proposed (awaiting review)
- **Date:** 2026-09-03
- **Scope:** cross-user, published changes only
- **Transport:** Nostr — user-signed, non-custodial
- **Source of truth:** on-chain `tokenURI` / `AssetURIUpdated`
- **Signing:** per-user Nostr key (Schnorr/BIP-340), bound to wallet

## 1. Goal

When a collaborator publishes or updates a child asset that another user's open
scene references via `child_ref`, that scene updates in near-real-time (sub-second),
with **no backend in the signing path** — each user signs their own update events.

## 2. Non-goals

- **Draft (unpublished) edits** — never touch the chain.
- **External ERC-721 `child_ref`s** — only Arbesk contracts emit the canonical update
  path.
- **Comments/chat non-custodial migration** — tracked separately in GH issue #58;
  chat stays **custodial** for now and is unaffected by this design.
- **Service-key signing of update events** — forbidden here; update events are
  user-signed.
- **Backend as transport hop** — the publish/subscribe path is client↔relay, not
  client↔backend↔relay.

## 3. Background

A scene references another asset through a `child_ref` node holding
`{ collection: { chainId, contractAddress, tokenId }, assetID }` with
`resolution: "latest"`. Resolution is:

```
resolveChildRef  →  readContract(tokenURI)  →  collection manifest CID
                 →  assets[assetID]          →  asset manifest CID  →  load glTF
```

`frontend/src/js/blockchain/token-resolver.ts` caches resolution ~30s
(`RESOLUTION_CACHE_TTL_MS`) and exposes `clearResolutionCache()`.

Every published/renamed/deleted asset funnels through a chain write:
- Browser EOA: `updateAssetURI(tokenId, newTokenURI)`
  (`frontend/src/js/blockchain/wallet-publishing.ts:131`); CDP: `_relayForCdp` →
  `POST /api/v1/wallet/relay`.
- CLI/MCP: `relay(session, "updateUri", tokenId, { newUri })`
  (`packages/besk/src/relay.ts` + `catalog.ts`) → `POST /api/v1/wallet/relay`.

The contract then emits `AssetURIUpdated(tokenId, newAssetURI)`
(`blockchain/contracts/ArbeskAssetBase.sol:78`) — the chain-level truth used for
reconciliation.

Existing Nostr infra: `nostr-rs-relay` (Docker, loopback `127.0.0.1:7777`),
`src/api/nostr-relay.ts` primitives, `src/api/chat-proxy.ts` (custodial, kind 1).
The relay is a stock carrier — in the non-custodial model it stays **dumb**: it
stores/forwards signed events and applies no policy.

## 4. Design overview

```
ONE-TIME IDENTITY                     PUBLISH                            SUBSCRIBE (viewer)
  wallet signs EIP-712                  browser/CLI/MCP                    resolve owner/editor W of
  "pubkey P = address W"  ───────▶  (shared SDK module)                 each referenced token (on-chain)
        │  binding event #address:W      sign KIND_ASSET_UPDATE              │  W's binding → pubkey P
        ▼                                publish → relay(s)                  │  P's relay list (NIP-65)
  relay (kind BINDING)                        │                             ▼
                                             ▼                          subscribe kinds:[UPDATE] #token:[...]
                                     relay (dumb carrier)                     │  verify: Schnorr(P) + binding(W) + on-chain(W)
                                                                             ▼
                                                                       reload child node (dispose → re-resolve → load)
```

The **feed** detects an update (local publish or remote event); the **engine**
reacts (reload). Nostr is the fast path; re-resolving the chain is the
truth/reconciliation path.

## 5. Identity binding (the crux)

A self-signed update event is only meaningful if the subscriber can prove the
signer is the owner/editor of the token. Nostr events are Schnorr-signed; EVM
wallets sign ECDSA. So we bind the two once:

1. **Key origin.** Browser derives a deterministic Nostr key from a wallet
   signature (EIP-712 over a fixed domain-separated message) — no seed to store,
   non-custodial. (CLI/MCP key origin is an open sub-decision, §15.)
2. **Binding document.** `{ address: W, pubkey: P, walletSignature }` where
   `walletSignature` is the wallet's EIP-712 signature over `"Arbesk Nostr
   identity: <P>"`, recoverable to `W`.
3. **Publish the binding** as a Nostr event tagged `#address:<W>` (new kind,
   `KIND_BINDING`), signed by `P`. Subscribers discover it by querying
   `#address:<W>`.
4. **Per-event verification (subscriber):** (a) `walletSignature` recovers `W`;
   (b) the event's Schnorr sig verifies against `P`; (c) `W` is still owner/editor
   of the token on-chain.

## 6. Nostr event schema

- **kind:** `KIND_ASSET_UPDATE` (e.g. `20001`), dedicated — never reuse kind `1`.
- **tag:** `#token` = `"<chainId>:<contract>:<tokenId>"` (`TAG_TOKEN`).
- **content (JSON):** `{ chainId, contractAddress, tokenId, newAssetURI, assetId? }`.
- **signature:** the author's own Nostr key (Schnorr), **not** a service key.
- **model:** append-only; client dedups by event id and reloads only when the
  resolved CID changed.

## 7. Publish path (choke points + shared module)

The publish notification is a client-side call to a **shared SDK module**
`publishAssetUpdate(signer, { chainId, tokenId, newAssetURI })`, invoked from
exactly two thin choke points (both already own the chain write):

- **Browser:** after `updateAssetURI` succeeds in `wallet-publishing.ts` (covers
  EOA-direct and CDP, since both funnel through that function).
- **CLI/MCP:** after `relay(session, "updateUri", …)` succeeds in
  `packages/besk/src/relay.ts` (MCP inherits via the CLI↔MCP parity rule — one
  implementation).

Both call the **same** module, so the Nostr logic is implemented once. No backend
endpoint (`POST /live/publish`) exists in this design.

## 8. Subscribe + verify path

Frontend `services/live-updates.ts` + `engine/child-reload.ts`:

1. After scene load, collect the referenced `(chainId, tokenId)` set from
   `child_ref` nodes.
2. For each token: read owner/editor `W` on-chain; fetch `W`'s binding (`#address:W`);
   read `P`'s relay list (NIP-65 kind `10002`).
3. Subscribe (WebSocket) to `kinds:[KIND_ASSET_UPDATE], #token:[...]` on those
   relays.
4. On event: verify Schnorr sig against `P`, binding recovers `W`, `W` still
   owner/editor on-chain; then emit `EVENTS.ASSET_URI_UPDATED`.
5. `child-reload.ts`: `invalidateResolution(...)` → `disposeNodeSubtree(node_id)`
   (`engine/cleanup.ts:109`) → re-run `loadTokenChildNode`
   (`engine/scene-loader.ts:183`). Delete → error placeholder (already handled).

Guard: reload only when the resolved manifest CID differs from the currently
loaded one.

## 9. Relay topology

- **Shared federated relays + NIP-65 outbox.** Users publish to and read from
  relay(s) declared in their relay list (`kind 10002`).
- The existing loopback relay must become client-reachable for update traffic
  (bind to a reachable interface, or point clients at hosted/public relays). The
  custodial chat proxy may keep using the private relay.
- **Per-user dedicated relay** is a supported deployment (a user's own relay is
  just another entry in their relay list) — provisioning is easy because relays
  are dumb carriers; discovery is handled by NIP-65, not by the client hard-coding
  a relay.

## 10. SDK placement (the dedup answer)

Nostr signing/verification is environment-agnostic (crypto + a relay port), so it
belongs in a package — **new `@arbesk/nostr`** (or a `@arbesk/wallet` extension):

- `createNostrIdentity(walletSigner)` — derive key + build binding.
- `publishAssetUpdate(signer, payload)` — sign + publish via a `relayConnect` port.
- `verifyAssetUpdate(event, expectedOwner, chainReadPort)` — binding + Schnorr +
  on-chain check.

Consumed by browser, `besk` CLI, and MCP — **one implementation, zero duplication**.
The backend keeps only `nostr-relay.ts` (shared primitives) for the *custodial*
chat path; the non-custodial update path does not go through it.

## 11. Reconciliation & failure handling

- **Optimistic race:** the event may arrive before the chain tx confirms; the
  subscriber re-resolves and no-ops on unchanged CID.
- **Missed events / offline / relay restart:** on WS reconnect, on
  `visibilitychange`→visible, and on scene (re)open, re-resolve the subscribed
  tokens and reload any that changed — the chain-truth backstop.
- **Stale binding:** a rotated or revoked key is caught by check (c) in §5
  (on-chain owner/editor must still match).
- **Dedup:** event-id dedup + the CID-change guard.

## 12. Scaling

Relays are dumb carriers, so delivery scales horizontally: publish is O(1) per
publisher; relays fan out to subscribers with tag-filtered `REQ`s; more relays are
added via NIP-65 **without changing any client**. The identity lookups (§5) are
cached client-side. Bottleneck is relay capacity — shardable/per-user, not a
backend trust point.

## 13. Testing

- **SDK unit:** key derivation, binding build/verify, event sign/verify
  (Schnorr), tamper rejection.
- **Frontend jest:** `live-updates.ts` (mock relay: subscribe, verify, dedup,
  reconnect); `token-resolver.invalidateResolution`; `child-reload.ts` (dispose +
  reload only for matching node).
- **E2E (required):** two contexts — context A publishes a child; context B with
  the parent scene open reloads it within the window; rename/delete variant.
- **Identity:** binding round-trip (wallet signature recovers address; spoofed
  binding rejected).

## 14. Decisions (resolved)

1. **Non-custodial** user-signed update events; chain as reconciliation truth.
2. **Key origin:** wallet-signed binding (browser); CLI/MCP key origin open (§15).
3. **Relay topology:** shared federated + NIP-65 outbox.
4. **Dedicated `KIND_ASSET_UPDATE` + `#token` tag**; append-only events.
5. **Two choke points** (`wallet-publishing.ts` + `besk/relay.ts`) → one shared
   SDK module.
6. **Chat/comments stay custodial** — migrated later under GH issue #58.

## 15. Open sub-decisions (non-blocking)

- Exact `KIND_ASSET_UPDATE` / `KIND_BINDING` numbers.
- **CLI/MCP key origin:** locally-held Nostr key in `besk` config (recommended,
  non-custodial) vs. derived during login.
- **Binding discovery:** relay query `#address:<W>` (recommended) vs. a backend/IPFS
  directory.
- Relay hosting: extend the existing Docker relay vs. point at hosted/public relays.

## 16. Related

- GH issue #58 — non-custodial migration of chat/comments (separate, deferred).