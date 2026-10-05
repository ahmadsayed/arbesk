# CAD Incremental Edit — Design

**Date:** 2026-10-05 · **Status:** approved in brainstorm

## 1. Why

A parametric CAD part is a script plus a parameter table. Today every CAD prompt
in the Studio starts from scratch, so "make the slot 2 mm wider" produces a new,
unrelated part. Users need to refine a part step by step: each follow-up prompt
should edit the current design, keeping everything the user did not ask to
change.

## 2. What exists

- `@arbesk/cad-gen` backend already supports continuity. `buildTurnMessages`
  (`backend/prompt.ts`) takes `priorDesign` and sends it as
  `CURRENT DESIGN (JSON)` (code, parameter values, summary). The system prompt
  ends with "When a previous design is supplied, treat it as the current state:
  return the COMPLETE updated script, preserving everything the user did not ask
  to change." The repair loop (`facade.ts`) and library selection
  (`select.ts`) use it, and `turn` becomes `prior.turn + 1`.
- `POST /api/v1/cad/generations` (`src/api/routes/cad.ts`) validates and
  forwards `priorDesign` (`cadDesignSchema` in `src/api/schemas.ts`).
  `sourceRef` returns 501.
- Every generated part embeds its design in the 3MF
  (`Metadata/arbesk_cad.json`). The browser entry of `@arbesk/cad-gen` exports
  `readDesignFrom3mf`.
- **The gap:** the Studio sends CAD prompts to `POST /api/v1/generations`
  with only `{ provider: "cad", prompt, nodeId }`
  (`frontend/src/js/services/api.ts`, `generateCadAsset`). The route calls
  `provider.textToModel({ prompt })` (`src/api/assets/generate-node.ts`), and
  the CAD provider calls `generator.generate({ prompt })`
  (`packages/ai-asset-gen/src/providers/cad-provider.ts`).
- The create panel's "Refining: …" chip (`ActiveVersion` in
  `frontend/src/js/ui/create-panel.ts`) is set only for Tripo3D and uploaded
  models, and makes typed prompts retexture that version.
  `dispatchGeneration` deliberately starts every CAD generation as a fresh
  asset.

## 3. Decisions (locked in brainstorm)

1. **Edit vs new part:** reuse the "Refining" chip. When a CAD version is
   active, the next typed prompt edits it. Detaching the chip starts a fresh
   part.
2. **Where the previous design comes from:** the client sends the full design
   as `priorDesign`. The server stays stateless.
3. **Context sent to the model:** only the current design plus the new
   request. No earlier prompts.
4. **Chip vs provider selector:** the chip wins. Its kind decides CAD edit or
   Tripo retexture. While a chip is attached the provider selector shows the
   chip's provider and is disabled.
5. **Implementation:** extend the existing `/generations` CAD path, not the
   Studio's move to `/cad/generations`, and not server-side `sourceRef`
   resolution.

## 4. Backend

1. **Schema** (`generateAssetSchema`, `src/api/schemas.ts`): add an optional
   `priorDesign`, reusing `cadDesignSchema` so both routes validate a design
   identically. A refine rejects `priorDesign` unless `provider === "cad"`,
   giving a 400 with the field path, like the existing Tripo-only rules.
2. **Route** (`src/api/assets/generate-node.ts`, CAD branch):
   `provider.textToModel({ prompt, priorDesign })`.
3. **Facade** (`packages/ai-asset-gen/src/facade.ts`): the `textToModel`
   input gains `priorDesign?: CadDesign`. Tripo and mock ignore it.
4. **CAD provider** (`cad-provider.ts`): store `priorDesign` on the task
   state and pass it as `generator.generate({ prompt, priorDesign, signal })`.
5. Prompt assembly, repair, library selection and the `turn` increment need no
   change.

A malformed design is rejected with a 400 before the quota is touched. Quota
and refunds are unchanged: an edit costs one generation unit, and a failed or
stopped edit is refunded like any generation.

## 5. Frontend

### 5.1 Active version

```ts
interface ActiveVersion {
  kind: "mesh" | "cad";
  sourceAssetCid: string;   // GLB (mesh) or 3MF (cad) CID
  manifestCid: string | null;
  name: string;
  design?: CadDesign;       // cad only; set at once or loaded lazily
}
```

Existing call sites set `kind: "mesh"` and behave exactly as today.

A CAD version becomes active:

1. **After a fresh CAD result.** `generateCadAsset` returns the `design` it
   already receives from the poll (added to `GenerateAssetResult`), so the chip
   is set with the design in hand.
2. **On Show in Studio, or a bubble or history restore** of a
   `provider: "cad"` record. The chip is set without a design.
3. **When an asset or version is opened** whose manifest has `metadata.cad`.
   The chip is set without a design.

### 5.2 Loading the design lazily

`resolveCadDesign(version)` fetches the version's 3MF from IPFS through the
existing cached reader, calls `readDesignFrom3mf`, and caches the result on the
`ActiveVersion`. It runs at most once per chip, on the first send.

### 5.3 Sending

- **Routing:** the chip's `kind` decides. `cad` is a CAD edit, `mesh` is a
  Tripo retexture (unchanged), and with no chip the provider selector decides.
- **Provider selector:** while a chip is attached it shows the chip's provider,
  is disabled, and carries the hint "Detach to choose a provider".
- **CAD edit:** a chat line `Editing "<name>"…`, then `dispatchGeneration`
  passes `priorDesign`, `prevAssetManifestCid` and `transformMatrix` to
  `generateCadAsset`. `generateCadAsset` already accepts the last two, so the
  result saves as the next version of the same asset, in place. Its request body
  becomes `{ provider: "cad", prompt, nodeId, priorDesign }`.
- **An attached image** starts fresh and the chip is ignored, matching the Tripo
  rule. The `/generations` CAD path takes no images.
- **After a successful edit** the chip moves to the new version, with the
  design from the result, so the next prompt edits the latest version.

### 5.4 Errors

| Case | Behaviour |
|------|-----------|
| Design cannot be read (IPFS failure, or a 3MF without the sidecar) | Toast "Couldn't load the design of '<name>'. Detach to generate a new part." No request is sent, so nothing is charged. The chip stays. |
| `CAD_REQUEST_UNSUITABLE` on an edit | The existing message, without the "Retry with Tripo 3D" offer (switching provider would discard the part). That offer stays for fresh generations. |
| 400 on `priorDesign` (exceeds limits) | Toast "This design is too large to edit. Detach to start a new part." |
| Edit produces a bad part | It is a normal new version. The version timeline and earlier versions cover recovery. |

Clear chat, switching assets and New clear the chip, as today.

## 6. Testing

**Backend (unit):**
- The schema accepts `priorDesign` only with `provider: "cad"`; a malformed
  design is a 400 naming the field.
- `generate-node` forwards `priorDesign`.
- `cad-provider` passes it to a stub generator, which asserts it arrived.

**Frontend (unit):**
- Routing follows the chip's `kind`, and the selector is disabled while a chip
  is attached.
- `resolveCadDesign` fetches once and caches; a failure shows the toast and no
  request is sent.
- The `generateCadAsset` body includes `priorDesign`, and
  `prevAssetManifestCid` is passed for the version chain.
- The chip moves to the new version after success.

**E2E (new spec, `CAD_MOCK_GENERATION=true`):**
- Generate a CAD part; the chip reads "Refining: …".
- Send a follow-up. The intercepted `/generations` request carries
  `priorDesign` with the first design's code, and the result is v2 of the same
  asset.
- Detach the chip; the next prompt sends no `priorDesign`.

## 7. Out of scope

- Server-side `sourceRef` resolution (the 501 path).
- Sending earlier prompts as context.
- A parameter-editing UI.
- `besk` CLI/MCP changes. The CLI uses `/cad/generations`, which already
  accepts `priorDesign`.
