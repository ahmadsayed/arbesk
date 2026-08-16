# Asset Chat Provenance (Save-Anchored, Chain-Based) — Design

**Date:** 2026-08-02
**Status:** Approved (user reviewed design interactively)
**Scope:** Persist AI chat prompts inside asset manifest versions so opening an asset shows the prompts that produced it. Text-only prompts this phase.

## 1. Context

AI chat is currently fully ephemeral: prompt bubbles live in the DOM (`chat-messages.js`), pending generations live in an in-memory `Map` (`state/pending-generations.ts` — "no persistence, a page reload drops undecided generations"), and the backend persists nothing. Starting a new project or reloading wipes the conversation. The only trace of a prompt today is the node *name*, truncated to 60 chars (`services/api.ts` sets it from `prompt.slice(0, 60)`).

**Decision: Path 2 — first-class in the asset version, not Nostr.** Two paths were considered:

- **Path 1 (Nostr, like comments)** — full transcript via `chat-proxy.ts` → relay → IPFS archive → manifest CID. Rejected for this phase: prompts are provenance, not conversation; provenance must load with the asset with zero network dependencies; a second Nostr thread type duplicates WS auth, rate limiting, and archive machinery.
- **Path 2 (manifest)** — chosen. Prompts are small; they belong to the version they produced.

**Key refinement: the chain is the history.** The dormant `scene.nodes[].history[]` array (documented in `ARCHITECTURE.md` §4.1, never implemented, to be removed — see §6) would duplicate every entry across all subsequent snapshots. Instead, each manifest version carries **only its own** chat records; walking `prev_asset_manifest_cid` and concatenating per-version records reconstructs the full conversation, oldest → newest, with each prompt stored exactly once.

**Save-anchored persistence only.** A prompt is recorded when its result is accepted into the scene ("Show in Studio" / apply) **and** the manifest is saved/published. Unaccepted pending records die with the page — correct provenance semantics (they produced nothing). Preserving *unsaved* chat (drafts, rejected generations) is a **future Nostr phase**, explicitly out of scope.

### Decisions (user-confirmed 2026-08-02)

1. Record lives in a top-level `metadata` object (not `generation` — not AI-specific; not per-node — scene nodes are immutable references).
2. `metadata.chat` is an array **scoped to this version**: one save can bundle several accepted prompts (e.g., a model generation + a texture update).
3. Store the provider task ID (`taskId`) so a future "enhance texture" / "new chat from model snapshot" (image-to-3D) feature can continue the provider-side chain across sessions. **Considered in design, not implemented** — text-only prompts now.
4. Read UI: chat-like bubble view in the Create panel when opening an asset (not the ledger panel).
5. Remove the dormant `node.history[]` spec as part of this change.

## 2. Manifest Schema

Each version produced by AI chat activity gains:

```json
"metadata": {
  "chat": [
    {
      "prompt": "a low-poly wooden cabin",
      "provider": "tripo3d",
      "task": "model",
      "taskId": "tripo-task-abc123",
      "timestamp": 1780000100
    },
    {
      "prompt": "give it a mossy bark texture",
      "provider": "tripo3d",
      "task": "texture",
      "taskId": "tripo-task-def456",
      "timestamp": 1780000250
    }
  ]
}
```

Entry fields:

- `prompt` (string, required) — the user's chat text, verbatim.
- `provider` (string, required) — `"tripo3d"` | `"mock"` | `"parametric"` (matches the provider naming in `generate-node.ts`; extensible).
- `task` (string, required) — `"model"` | `"texture"`; extensible — old clients must ignore unknown values.
- `taskId` (string, optional) — the **provider's** task ID (e.g., Tripo task ID), not the backend registry ID. Omitted for `mock` and `parametric`.
- `timestamp` (number, required) — unix seconds, set when the record is written.

Parametric chat edits (color/scale, client-side) are recorded as `{provider: "parametric", task: "parametric"}` with no `taskId`. Versions with no AI activity omit `metadata.chat` entirely.

`metadata` participates in the manifest semantic diff (`manifest-builder.js` strips only `version`/`timestamp`/`prev_asset_manifest_cid` for no-op detection) — intended: a save that records chat is never a no-op.

Zod: add `metadata.chat` to `manifestSchema` in `src/api/schemas.ts`. Non-strict parsing means old clients tolerate the field; add it for cleanliness.

## 3. Write Path

```
Chat prompt → POST /generations → poll → success payload gains providerTaskId
  → generateAsset() returns {..., taskId, providerTaskId}    (services/api.ts)
  → pending record gains {taskId, provider, task}           (state/pending-generations.ts)
  → "Show in Studio" / apply consumes record into scene
  → save/publish: manifest builder collects records consumed since previous
    version
  → metadata.chat written into new manifest version          (manifest-builder.js / asset-save)
```

Concrete changes:

1. **Backend surfaces the provider task ID** — `src/api/assets/generate-node.ts` poll-success response (currently `generate-node.ts:246`) gains `providerTaskId: entry.tripoTaskId`. This amends decision #3 of `2026-07-22-clear-chat-refine-design.md` ("the Tripo task ID never reaches the browser") for this field only: the ID is tied to the user's own BYOK Tripo account, so exposing it to that user's browser is low-risk, and cross-session enhance flows require it. The internal registry `taskId` remains the polling handle and is never stored.
2. **`services/api.ts` `generateAsset()`** — return `providerTaskId` **alongside** the existing registry `taskId`. The registry ID must stay unchanged: the in-session refine chain (`refineTaskId`) looks it up in the backend task registry (`getCompletedTask`). Only `providerTaskId` is persisted in manifests.
3. **`state/pending-generations.ts`** — pending records gain `taskId` (provider task ID), `provider`, `task`, and a `recorded` flag (set once written into a saved version).
4. **`create-panel.js`** — passes the new fields through when registering the pending record; `task` is `"texture"` when the generation was a refine, else `"model"`.
5. **Manifest build** (`manifest-builder.js` / `services/asset-save/`) — at save time, append the consumed records as `metadata.chat` entries. Parametric `{provider: "parametric"}` entries are supported by the schema but no current UI path produces chat-prompt parametric commands, so none are written this phase.

## 4. Read Path

Opening an asset shows its prompt history as a **read-only chat-like bubble view in the Create panel**, above/separate from the live composer:

1. Walk the manifest chain client-side — same pattern as the ledger (`walkManifestChain()` + `getFromRemoteIPFS()` per manifest, `ledger-panel.js:100-104`).
2. Collect `metadata.chat` from each version, oldest → newest.
3. Render as bubbles reusing `chat-messages.js` rendering (user-prompt style), labeled per entry (e.g., provider/task badge, version number).
4. Live session chat continues to work as today; historical view is clearly delimited from the live composer. No interactivity on historical bubbles this phase (no re-run/copy — future).

## 5. Edge Cases

- Version with no AI activity → no `metadata.chat`; walker skips it.
- Old/corrupt manifest missing or with malformed `metadata.chat` → skip that version, continue walk.
- Shared asset → collaborators see identical prompt history (it's in the manifest; no auth, no relay).
- Chain walk failure (IPFS unreachable) → show live chat only, `console.warn` (same posture as ledger's `[LEDGER]` warn).
- Burn → nothing extra to unpin; records live inside manifests already walked by the chain walker.
- Accepted-but-unsaved work → still ephemeral (page reload drops it), consistent with current pending-generation semantics.

## 6. Cleanup: Remove Dormant `node.history[]`

- `docs/ARCHITECTURE.md` §4.1 — remove the `history` array from the manifest example and the provenance-log sentence in the §4.1 closing note; document `metadata.chat` in its place.
- `src/api/schemas.ts` — delete `historyEntrySchema` and `history` from `nodeSchema`.
- `frontend/src/js/ui/ledger-panel.ts` — remove the dead node-history extraction loop (`extractActivities`, ~lines 135-141); optionally surface `metadata.chat` entries as "AI: prompt…" activity lines (nice-to-have, keep if trivial).
- Check burn chain-walker for `history[].src` consumption and remove/adjust (`manifest-chain-walker.ts`).

## 7. Testing

- **Jest**: `metadata.chat` schema validation (valid entries, unknown `task` values tolerated, missing required fields rejected); manifest builder writes entries on save and skips AI-free versions; no-op detection unaffected when no chat is consumed; `historyEntrySchema` removal breaks no existing suite.
- **E2E**: generate → "Show in Studio" → save → reopen asset → prompt bubble visible; two prompts accepted before one save → both bubbles in order; new project still clears live chat but asset reopen shows history.

## 8. Future Phases (designed for, not implemented)

- **Nostr unsaved-chat preservation** — full session transcript incl. drafts/rejections via the comments pattern (new tag/kind, archive CID).
- **Enhance/refine from history** — `taskId` enables cross-session `texture_model` continuation; UI affordance on historical bubbles.
- **Image-to-3D spawn** — "new chat from model snapshot": screenshot of an existing model as AI input; `taskId` + asset CID are the hooks.
- **AI response text** — only user prompts are stored this phase.
