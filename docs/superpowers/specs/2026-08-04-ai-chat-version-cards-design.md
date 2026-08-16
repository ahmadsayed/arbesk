# AI Chat Version Cards — Design

Date: 2026-08-04
Status: Approved (brainstorming), pending implementation plan

## Problem

The AI generation chat (`frontend/src/js/ui/create-panel.ts`) has grown into a
complex, linear, fragile flow:

1. **Ephemeral task-ID coupling.** Every follow-up (retexture, retopo, rig,
   animate) references the in-memory backend task registry
   (`src/api/generation-tasks.ts`, 1-hour TTL, wallet-bound, holds the transient
   BYOK key). After an hour — or a backend restart, or a different BYOK key —
   the follow-up chips die with "source generation expired", even though the
   GLB sits immutable in IPFS and the bubble already holds its CID.
2. **Linear refine chain.** Typed follow-up prompts retexture only the model
   tracked by the hidden module-level `lastTripoTaskId`. Retopo/animate results
   never update it, so a retopo'd model can never be retexture-refined by
   typing — the flow is a line, not a graph. Tripo's texture endpoint also only
   accepts task IDs from *generation* tasks, so a decimate task ID is not a
   valid refine source upstream.
3. **Cluttered bubbles.** Each Tripo3D bubble sprouts 7 choice chips (4 preset
   combos + Retopo + Rig only + More…) plus a separate recovery chip after
   animation.
4. **No durable version history.** Bubbles exist only for the live session;
   "Show in Studio" loads but does not save, so older versions cannot be
   recovered from the chat after the fact.

## Decisions (from brainstorming)

- Bubble actions: **one compact action row** per actionable bubble —
  `Retexture` · `Retopo` · `Auto-rig` · `Animate…` (not chips, not an overflow
  menu).
- Version recovery: clicking an older bubble's body **loads that version into
  the Studio** (no preview-first step).
- Follow-up model reference: **GLB everywhere** — the backend fetches the
  bubble's GLB from IPFS and uploads it to Tripo (`POST /files` →
  `file_token`). No task-ID fast path.
- Typed follow-ups: refine the **active version** with a visible
  `Refining: <name> ×` indicator above the input (not explicit-only).
- **Show in Studio auto-saves a draft** (existing asset-save flow). Publish
  stays explicit and unchanged.
- Quality is a **panel-level generation option** shown when Tripo3D is the
  selected provider (replaces the "High quality texture" checkbox).
- Rig-without-animation is a dedicated **Auto-rig** action.
- Retopo exposes a **polygon budget** control.

## Design

### 1. Bubble = version card (frontend)

Every generation bubble is a version card:

- **Body**: live preview/thumbnail (as today) + prompt caption. Clicking the
  body loads that version's manifest into the Studio (`loadAssetManifest`) —
  durable; works after reload because provenance bubbles already rebuild from
  the manifest chain (`chat-history.js`).
- **Action row** (replaces the 7 preset chips and the post-animation recovery
  chip):
  - `Retexture` — dialog: texture prompt only. Runs texture-only refine on
    this bubble's GLB. Texture quality comes from the panel-level setting.
  - `Retopo` — dialog: polygon budget number input (500–20,000 tris, default
    20,000; blank = adaptive, with a warning that adaptive is aggressive on
    faces). Maps to Tripo `face_limit`.
  - `Auto-rig` — one click, no dialog: rig-check → rig, stops there
    (Mixamo-ready GLB, no baked animation).
  - `Animate…` — dialog: existing preset checkboxes (max 5), then the full
    rig-check → rig → retarget chain.
- **Availability rules** (same logic as today, relocated):
  - Animated results (`task === "animate"`): no actions.
  - Auto-rig results: only `Animate…` (retarget-only path — re-rigging is
    pointless, retopo would strip the skeleton).
  - All other Tripo3D results: all four actions.
  - Mock provider: no actions.
- `Show in Studio` stays the explicit primary button. It now also **auto-saves
  a draft** after loading (existing asset-save service) and the bubble is
  annotated as a saved version. Publish remains fully user-controlled.

### 2. Create panel quality option

- When Tripo3D is the selected provider, a quality selector appears in the
  create panel near the provider row: `Standard` / `Detailed` / `Extreme 8K`
  → Tripo `texture_quality`.
- It replaces the "High quality texture" checkbox (`highQualityRow` /
  `highQualityInput`, Pug template + `create-panel.js` sync logic).
- The setting applies to text-to-3D, image-to-3D, and retexture calls (all
  accept `texture_quality`; generation model default is ≥ v3.0 so the
  parameter is valid).

### 3. Backend: GLB is the canonical follow-up input

- **Schema** (`src/api/schemas.ts`): `refineTaskId` / `retopoTaskId` /
  `animateTaskId` are replaced by:
  - `sourceAssetCid` — CID of the source GLB in IPFS (the bubble's
    `sourceAssetCid`).
  - `action`-style dispatch stays field-based: `retexture: true` (with
    `prompt` as the texture prompt), `retopo: true` (with `faceLimit`),
    `animate: true` (with `animations`). The dedicated **Auto-rig** action is
    `animate: true` + `rigOnly: true` (rig-check → rig, terminal); `rigOnly`
    is not valid without `animate: true`.
  - New: `textureQuality` (`standard|detailed|extreme`, default `standard`)
    for text/image generation and retexture. The `highQuality` boolean is
    retired.
- **Route** (`src/api/assets/generate-node.ts`): on any follow-up, the backend
  1. fetches the GLB bytes for `sourceAssetCid` via the existing storage layer
     (Kubo locally, Pinata gateway on testnet),
  2. uploads them to Tripo `POST /files` → `file_token`,
  3. passes the token as `input` to `models/texture` / `mesh/decimate` /
     `animations/rig-check`.
- **Animate chain**: rig-check and rig both take the same `file_token` (rig
  accepts `file_token` input). Retarget still consumes the rig task ID —
  internal to one chain, unchanged. The retarget-only path (auto-rig result +
  `Animate…`) is preserved.
- **Adapter** (`src/api/adapters/tripo3d-adapter.ts`):
  - New `uploadModel(bytes, apiKey)` — mirrors `uploadImage`, GLB payload.
  - `createRefineTask` / `decimateTask` / `rigCheckTask` / `rigModelTask` take
    the file token as `input` instead of a generation task ID.
  - `createTask` / `createImageTask` / `createRefineTask` accept
    `textureQuality`; the `highQuality` flag is removed.
- **Registry** (`src/api/generation-tasks.ts`): still tracks *running* tasks
  and the transient BYOK key. Source lookups (`getCompletedTask`) and the
  `REFINE_SOURCE_NOT_FOUND` / `RETOPO_SOURCE_NOT_FOUND` /
  `ANIMATE_SOURCE_NOT_FOUND` 404s are deleted — no expiry dead-end, no
  cross-key fragility, works on any bubble or saved asset, after any restart.
- **Frontend service** (`services/api.ts`): the silent
  "refine source expired → fresh model" fallback is deleted (expiry is no
  longer possible). `generateAsset` sends `sourceAssetCid` + action fields.

### 4. Typed prompts follow the active version

- `lastTripoTaskId` is replaced by an explicit active-version reference
  `{ sourceAssetCid, manifestCid, name }`, set on: generation result,
  Show in Studio, and bubble-click restore.
- Indicator above the prompt input: `Refining: <name> ×` — × detaches, so the
  next prompt creates a fresh model. Attached image always starts fresh
  (unchanged). Clear Chat / asset switch reset it (unchanged).
- Typed prompt + active version → retexture on that version's GLB via the
  Section-3 path. Typed prompt + no active version → fresh text-to-3D.
- Provenance (`metadata.chat`) keeps recording `{prompt, provider, task,
  taskId?, timestamp}` per version — `taskId` now means the Tripo follow-up
  task; the schema is unchanged.

## Error handling

- Tripo `POST /files` failure → existing `TripoApiError` → 401/402/500
  mapping (`PROVIDER_AUTH_FAILED` / `PROVIDER_CREDITS_EXHAUSTED` /
  `PROVIDER_ERROR`).
- GLB fetch from IPFS fails → 400 `SOURCE_ASSET_UNAVAILABLE`.
- `sourceAssetCid` payload > 150 MB (Tripo limit) → 400 with a clear message
  (generated GLBs are far under this; guard is defensive).
- `MODEL_NOT_RIGGABLE` and the animate-chain stage labels are unchanged.

## Testing

- **Jest backend** (`test/api.test.js`): new schema validation, follow-up
  routes with `sourceAssetCid` (mocked adapter: upload → file_token → correct
  endpoint input), error mappings, retired 404 paths.
- **Jest frontend**: action-row rendering rules (animated / rig-only / mock),
  active-version indicator set/detach/reset, quality selector visibility.
- **E2E sync** (per AGENTS.md §10): `e2e/helpers/studio-selectors.mjs` moves
  from chips to the action row; animate/retopo specs updated; new spec for
  click-to-restore version recovery; retexture-via-typed-prompt spec updated
  for the indicator. Mock provider flows are unaffected.
- Comment fixes along the way: stale "clean quad topology" mentions
  (`create-panel.js`, `api.js` JSDoc) → triangulated topology.

## Out of scope

- Publish flow (unchanged, explicit).
- Tripo rig/retarget quality knobs (the API exposes none).
- Nostr-based chat preservation (future phase).
- Cross-asset chat (the chat still resets on asset switch).
