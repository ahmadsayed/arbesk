# Live Scene Updates via Nostr Pub/Sub — Design

- **Status:** Proposed (awaiting review)
- **Date:** 2026-09-03
- **Scope:** cross-user, published changes only
- **Transport:** Nostr (existing private relay + backend WS proxy)
- **Source of truth:** on-chain `tokenURI` / `AssetURIUpdated`

## 1. Goal

When a collaborator publishes or updates a child asset that another user's open
scene references via `child_ref`, that open scene updates in near-real-time
(sub-second) without a manual reload.

## 2. Non-goals

- **Draft (unpublished) edits.** Drafts never touch the chain, so they are out of
  scope by definition of "published only".
- **External ERC-721 `child_ref`s.** Only Arbesk contracts (`ArbeskAssetFree` /
  `ArbeskAsset`) emit the canonical update path. External refs keep the existing
  ~30s resolution cache + focus/visibility refresh.
- **Comments/chat real-time.** Already shipped on kind `1` (`#asset` scoped); this
  spec adds a *new* kind and does not touch kind `1`.
- **Browser→relay P2P.** The relay is loopback-only, so all traffic flows through
  the backend proxy (see §3).

## 3. Background — how a reference updates today

A scene references another asset through a `child_ref` node that holds
`{ collection: { chainId, contractAddress, tokenId }, assetID }` with
`resolution: "latest"` — never a static CID. Resolution is:

```
resolveChildRef  →  readContract(tokenURI)  →  collection manifest CID
                 →  assets[assetID]          →  asset manifest CID  →  load glTF
```

`frontend/src/js/blockchain/token-resolver.ts` caches resolution for ~30s
(`RESOLUTION_CACHE_TTL_MS`) and exposes `clearResolutionCache()`.

When an asset is published/renamed/deleted, the browser writes IPFS content and
then calls `updateAssetURI(tokenId, newTokenURI)`
(`frontend/src/js/blockchain/wallet-publishing.ts:131`). That one function is the
**single choke point** for every update type (publish, editor-publish via
`republishCollection`, rename/delete via `updateCollectionManifest`). The contract
then emits `AssetURIUpdated(uint256 indexed tokenId, string newAssetURI)`
(`blockchain/contracts/ArbeskAssetBase.sol:78`) — the chain-level truth.

### Existing Nostr infrastructure (already running)

- `nostr-rs-relay` in Docker, bound to `127.0.0.1:7777`, **loopback-only, no
  peering** (`docker-compose.yml:48`).
- `src/api/nostr-relay.ts` — shared primitives: `createRelay`, `createPool`,
  `safeClose`, `KIND_CHAT`, `TAG_ASSET`.
- `src/api/chat-proxy.ts` — WS bridge: session-gated, service-key signed, per-asset
  `REQ` on kind `1`, heartbeats, rate limiting.
- `frontend/src/js/services/comment-thread.ts` — browser WS client: connect,
  dedup by event id, archive/backlog, reconnect/backoff, emit on the bus.

Because the relay is loopback-only, a browser can never reach it directly; every
byte goes through the backend WS proxy. **Consequence:** "Nostr" here means *thin
backend proxy + relay*, not browser→relay P2P.

## 4. Design overview

```
PUBLISHER                                          SUBSCRIBER (viewer of a parent scene)
  publish/rename/delete                                open scene → collect referenced (chainId, tokenId)
        │                                                     │
        ▼                                                     ▼
  updateAssetURI(tokenId, newCid)  (on-chain)        WS /api/v1/live/ws?token=...  + subscribe msg
        │  emit EVENTS.ASSET_URI_CHANGED                   │
        ▼                                                     ▼
  live-updates feed  ──POST /api/v1/live/publish──▶  backend subscribe proxy
        │  (session-gated)                                     │  relay.subscribe(kinds:[KIND_ASSET_UPDATE], #token:[...])
        ▼                                                     ▼
  backend verifies owner/editor, signs, relay.publish()   forward {type:event} to browser
                                                              │
                                                              ▼
                                                        live-updates feed → EVENTS.ASSET_URI_UPDATED
                                                              │
                                                              ▼
                                                        child-reload: invalidate cache → dispose subtree → re-resolve → reload glTF
```

One flow handles both local and remote updates: the *feed* is the only component
that detects an update (local emit or remote Nostr event); the *engine* is the only
component that reacts (reload). Nostr is the **fast path**; re-resolving against the
chain is the **truth/reconciliation** path.

## 5. Nostr event schema

- **kind:** a dedicated app kind `KIND_ASSET_UPDATE` (e.g. `20001`), defined in
  `src/api/nostr-relay.ts` next to `KIND_CHAT`. Do **not** reuse kind `1` — comment
  subscribers and update subscribers must not collide.
- **tag:** `#token` = `"<chainId>:<contract>:<tokenId>"` (`TAG_TOKEN`), token-scoped
  (not asset-scoped like `buildAssetTag`, because the publish seam knows `tokenId`
  but not necessarily `assetID`).
- **content (JSON):** `{ chainId, contractAddress, tokenId, newAssetURI, assetId? }`.
- **signing:** backend service key (`NOSTR_SERVICE_PRIVATE_KEY`), identical to chat.
- **model:** append-only events (a log). Client dedups by event id and reloads only
  when the resolved CID actually changed. (A replaceable-event kind — "latest wins"
  — was considered and rejected for v1: append-only matches the existing chat
  patterns and needs no relay replacement semantics.)

## 6. Backend

### 6.1 Publish endpoint

`POST /api/v1/live/publish` — body `{ chainId, tokenId, newAssetURI, proof? }`.

1. Validate body (Zod) + session (`authentication.ts`).
2. Authorize the caller as owner or Merkle editor of that token via
   `authorizeAssetAccess` (`src/api/authorization.ts:111`) — the same gate chat uses.
3. Rate-limit (reuse `rate-limiter.ts`).
4. Build `KIND_ASSET_UPDATE` event with `#token` tag + JSON content; sign with the
   service key; `relay.publish()`.
5. Return `202` with the event id.

The backend is the trust boundary: it signs **only after** verifying the caller
owns/edits the token, so a random wallet cannot spoof "token X updated".

### 6.2 Subscribe proxy (sibling of `chat-proxy.ts`, not a fork)

`WS /api/v1/live/ws?token=<session>` — a new, smaller module (e.g.
`src/api/live-feed.ts`) that reuses `nostr-relay.ts` primitives. It differs from chat
in two ways: it subscribes to **multiple tokens per connection**, and to the new kind.

- On connect: validate session (session-only, **no** per-token ownership proof — see
  §8).
- Client sends `{ type: "subscribe", tokens: ["<chainId>:<contract>:<tokenId>", …] }`
  to declare/replace the watched set (scene changes update the set without
  reconnecting).
- Backend maintains one `relay.subscribe([{ kinds: [KIND_ASSET_UPDATE],
  "#token": tokens }])` and re-issues the `REQ` when the set changes.
- Forward `{ type: "event", event }`, `{ type: "ready" }`, `{ type: "eose" }`.
- Heartbeats + disconnect cleanup, mirroring `chat-proxy.ts`.

### 6.3 CDP note

For CDP smart accounts, `updateAssetURI` is relayed through the backend wallet relay
(`_relayForCdp`). v1 keeps a **uniform** frontend-emit path (works for both EOA and
CDP). A later optimization may have the backend relay publish the Nostr event
server-side for CDP, removing one hop — noted, not built now.

## 7. Frontend

### 7.1 Publish seam — one line at the choke point

`wallet-publishing.ts` `updateAssetURI` already emits on the bus (`emit(EVENTS.ASSET_PUBLISHED, …)`). Add, on success (txHash obtained — **optimistic**, before
confirmation):

```
emit(EVENTS.ASSET_URI_CHANGED, { chainId, tokenId, newAssetURI: newTokenURI, txHash })
```

(`chainId` is the connected wallet's chain from `walletState.get().chainId` — the
same value the contract write already uses.)

Because every update type funnels through `updateAssetURI`, this single emit covers
publish, editor-publish, rename, and delete. The `blockchain/` module stays
transport-free (it only emits on the bus, as it already does).

### 7.2 Feed service — `services/live-updates.ts`

- Subscribes to the local `EVENTS.ASSET_URI_CHANGED` bus event:
  - `POST /api/v1/live/publish` (broadcast to others), then
  - treats it as an update locally (emit `ASSET_URI_UPDATED`).
- Maintains the WS connection for the open scene's referenced `(chainId, tokenId)`
  set (collected after scene load from `child_ref` nodes), with reconnect/backoff
  and event-id dedup — mirroring `comment-thread.ts`.
- On remote `{ type: "event" }`: parse, validate the `#token` tag is in the
  subscribed set, emit `EVENTS.ASSET_URI_UPDATED` with `{ chainId, tokenId,
  newAssetURI, source: "remote" }`.

### 7.3 Cache invalidation

`token-resolver.ts` gains `invalidateResolution(chainId, contractAddress, tokenId)`
that drops the matching `resolutionCache` entry (the key already encodes those three).

### 7.4 Child reload — `engine/child-reload.ts`

Subscribes to `EVENTS.ASSET_URI_UPDATED`. For each manifest node whose `child_ref`
references the updated token:

1. `invalidateResolution(...)` so re-resolution bypasses the stale cache.
2. `disposeNodeSubtree(node_id)` (`engine/cleanup.ts:109`) to tear down the old child
   geometry under its anchor.
3. Re-run the existing `loadTokenChildNode` path (`engine/scene-loader.ts:183`) to
   re-resolve (`tokenURI → collection → assetID → CID`) and reload the glTF.
4. If resolution fails (e.g. the referenced `assetID` was deleted), show the existing
   error placeholder — `loadTokenChildNode` already handles this. This is the correct
   UX for a now-dangling reference.

Guard: only reload when the resolved manifest CID differs from the currently loaded
one (dedups no-op events and makes the optimistic race harmless).

### 7.5 Event constants (asset-core)

Add to `packages/asset-core/src/events/bus.ts`:
`ASSET_URI_CHANGED` (local publish emit) and `ASSET_URI_UPDATED` (feed→engine).

## 8. Auth & trust model

- **Publish:** session + owner/editor proof required (spoofable otherwise).
- **Subscribe:** session only — the feed reveals public chain state (`tokenURI`/CIDs
  the viewer already holds from a scene they are viewing). This is a deliberate
  loosening vs chat (which requires asset access because comments carry write/access
  semantics); updates are read-only public data.
- **Authenticity:** the backend signs update events with the service key, so clients
  trust events only after the backend has authorized the publisher.

## 9. Reconciliation & failure handling

- **Optimistic publish race:** the event may arrive before the chain tx confirms.
  Subscribers re-resolve against the chain; if the new URI has not landed, the
  resolved CID is unchanged → no reload → self-corrects on the next event. No
  correctness hazard.
- **Missed events (offline / relay restart / reconnect):** on WS reconnect, on
  `visibilitychange`→visible, and on scene (re)open, the feed re-resolves its
  subscribed tokens and reloads any that changed. This is the chain-truth backstop
  that also self-heals a forgotten publish.
- **Relay unreachable:** the subscribe proxy surfaces `relayNotice`/`eose` errors like
  chat does; the client falls back to focus/visibility re-resolution.
- **Dedup/idempotency:** event-id dedup (as in `comment-thread.ts`) + the CID-change
  guard in §7.4.

## 10. Scaling & future

- Publish is O(1) per publisher; the relay fans out to N subscribers with
  tag-filtered `REQ`s, so a scene only receives its own tokens' events. This is the
  only delivery option that is both O(1) on RPC **and** sub-second (vs browser-direct
  polling = N×RPC at ~15s; vs backend indexer SSE = 1×RPC at ~15s).
- The single relay container + proxy connection count is the bottleneck; both are
  trivial at current (dev/testnet) scale. Future: add relays + NIP-65 outbox
  **without changing any client**, and optionally switch to a replaceable-event kind
  if "latest wins" semantics become valuable.
- The frontend `LiveUpdateFeed` abstraction is transport-agnostic: if RPC/relay
  constraints ever demand it, the transport can be swapped (e.g. backend indexer→SSE)
  while the reload machinery is unchanged.

## 11. Testing

- **Backend unit:** event build/sign + `#token` tag; `authorizeAssetAccess` gating
  (owner allowed, non-owner 403); rate limit.
- **Backend integration:** subscribe proxy against the Docker relay (subscribe message
  re-issues `REQ`, forwards events, dedup).
- **Frontend jest:** `live-updates.ts` (mock WS: subscribe message, dedup, reconnect,
  emit); `token-resolver.invalidateResolution`; `child-reload.ts` (mock loader:
  dispose + reload only for matching node, CID-change guard).
- **E2E (required per repo rules):** two browser contexts — context A publishes a
  child; context B with the parent scene open reloads that child within the window;
  plus a rename/delete variant (delete → error placeholder).

## 12. Decisions (resolved)

1. **Nostr** as transport; chain re-resolution as reconciliation truth.
2. **Optimistic publish** at tx-submit (not confirm-then-publish).
3. **Dedicated `KIND_ASSET_UPDATE` + `#token` tag** (never reuse kind `1`).
4. **Single choke point** at `updateAssetURI` in `wallet-publishing.ts`.
5. **Append-only events** (not replaceable) for v1.
6. **Session-only** subscribe auth (no per-token ownership proof).

## 13. Open questions (non-blocking)

- Exact `KIND_ASSET_UPDATE` number (pick an unregistered app kind; `20001` proposed).
- Whether to fold the subscribe proxy into `chat-proxy.ts` or keep a sibling module
  (recommended: sibling `src/api/live-feed.ts`).