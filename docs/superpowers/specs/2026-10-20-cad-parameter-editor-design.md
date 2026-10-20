# CAD Parameter Editor and Colour in Code — Design

**Date:** 2026-10-20 · **Status:** approved in brainstorm

## 1. Why

A CAD part is a Manifold script plus a parameter table, and the browser already
runs the script locally. Users cannot change a parameter, though: the only way
to resize a part is another AI prompt, which costs a round and may change more
than was asked. This spec adds a Parameters editor to the Studio Inspector.
A parameter edit rebuilds the part locally, previews it live, and on save
writes a new 3MF.

Colour has to be part of the same design. Per-part colour is the one Studio edit
stored *inside* the 3MF (`editSourceColors`, commit 4ca37bfd), so a rebuild
would erase it. Putting colour in the script makes the code the single source of
truth for both shape and colour.

## 2. What exists

- **Design document** (`packages/cad-gen/src/types.ts`): `CadDesign = { code,
  parameters, summary, turn }`. `CadParameter = { value: number, unit: "mm",
  min?, max?, label? }`. `parseParameter` (`core/document.ts:19`) rejects any
  unit other than `"mm"`. The API mirrors this in `cadParameterSchema` /
  `cadDesignSchema` (`src/api/schemas.ts:366`).
- **Kernel** (`core/kernel.ts`): `parameterValues` passes `{ name: value }` to
  the script as `PARAMETERS`/`P`. `run()` returns `{ mesh, parts, stats }`, with
  one `CadMesh` per returned part (spec 2026-10-10).
- **Exporter** (`core/export/three-mf.ts`): `meshTo3mf(parts, design)` writes
  one uncoloured `<object>` per part (named `part-1..n` when there are several),
  plus the design sidecar `Metadata/arbesk_cad.json` (`export/embed.ts`).
- **Contract** (`core/contract.ts`): `CONTRACT_VERSION = 2`,
  `PRELUDE_VERSION = "2026-10-10.7"`. `PRELUDE_NAMES` (`core/prelude.ts:20`)
  lists the injected helpers, and the guard allows only those.
- **Browser render**: `renderCadDesignInWorker` (`frontend/src/js/services/
  cad-render.ts`) → `cad-worker.ts` → `renderCadDesign` (`workers/
  cad-render-core.ts`: guard → kernel → 3MF bytes). `resolveCadDesign`
  (`services/cad-design-source.ts`) reads the design back from a raw .3mf or a
  composite-3mf CID.
- **Inspector** (`frontend/src/pug/includes/studio-main.pug`, `aside#inspector`):
  collapsible sections Asset, Token Info, Scale, Animations, Color
  (`#parametricEditor`), Auto-detected, Print & Provenance, Comments. It is
  driven by `engine/parametric-preview.ts`, which already does live colour
  preview, pending edits, undo and Edit/View gating.
- **Save** (`services/asset-save/manifest-builder.ts`): source edits run as
  ordered jobs, first `applySourceColorEdits` (3MF colours baked via
  `asset-core/formats/3mf/color-editor.ts`) and then `applySourcePartRemovals`.
  The 3MF handler has no `removeSourceParts`.
- **Refine chip** (`ui/refine-target.ts`): `ActiveVersion.design` caches the
  design sent as `priorDesign` on the next AI prompt.
- **3MF parser** (`asset-core/formats/3mf/parser.ts`) reads `<basematerials>`
  `<base displaycolor>`, so exported colours render with no asset-core change.

## 3. Decisions (locked in brainstorm)

1. **Interaction:** live preview, then save. Edits rebuild in the viewport;
   nothing is stored until Save Draft / Publish, which creates a new version.
2. **Placement:** a Parameters section in the Inspector, next to Scale and
   Color.
3. **Where parameters come from:** the parameters the script actually reads.
   The stored `parameters` table stays as it is and still provides labels,
   ranges and units. No parameter header inside the code.
4. **Colour lives in the script:** a `color(part, hex)` prelude helper and a
   `color` parameter type, in this spec rather than a follow-up.
5. **Save updates the 3MF:** new geometry, plus a sidecar storing the edited
   values.

## 4. cad-gen core

### 4.1 Colour parameter type

```ts
export interface CadLengthParameter {
  type?: "length";          // absent = length (every existing design)
  value: number; unit: "mm"; min?: number; max?: number; label?: string;
}
export interface CadColorParameter {
  type: "color";
  value: string;            // "#rrggbb", lowercase after parsing
  label?: string;
}
export type CadParameter = CadLengthParameter | CadColorParameter;
```

- `parseParameter` branches on `type`. Length keeps today's checks exactly. A
  colour value must match `/^#[0-9a-fA-F]{6}$/` and is stored lowercase. A
  colour parameter takes no `unit`, `min` or `max`. Any other `type` is a
  `CadDesignError`.
- `cadParameterSchema` becomes the same discriminated union, so both API routes
  validate identically.
- `parameterValues` passes the hex string for colour parameters and the number
  for lengths.
- `validateParameterOverrides` widens to `Record<string, number | string>` and
  also rejects an override whose kind does not match the declared type.

### 4.2 `color(part, hex)` prelude helper

- Returns the same solid, tagged with the colour. The tag is a per-run
  `WeakMap<Manifold, string>` held by `buildPrelude`'s closure, so the kernel can
  read it and the script cannot forge it.
- Throws `"color needs a #rrggbb hex"` on any other value.
- The tag belongs to that exact solid instance. A boolean or transform after
  `color()` produces a new solid with no tag. The prompt says to call `color()`
  last, on the solid being returned.
- `run()` looks up each returned part's tag. `KernelRunResult.parts[i]` gains an
  optional `color?: string`. Untagged parts are unchanged, so old designs give
  identical output.
- `PRELUDE_NAMES` gains `"color"`. `PRELUDE_VERSION` is bumped.
  `CONTRACT_VERSION` stays at 2: the change is additive, and the prelude version
  check already stops a stale client from running a design that calls `color`.

### 4.3 Exporter

- When any part has a colour, `buildModelXml` writes one
  `<basematerials id="…">` group with one `<base name="#rrggbb"
  displaycolor="#RRGGBBFF"/>` entry per distinct colour. Each coloured object
  gets `pid`/`pindex`. Uncoloured objects carry no material reference.
- When no part has a colour, the output is byte-identical to today's.

### 4.4 Used parameters

`usedParameterNames(code): { names: string[]; dynamic: boolean }` in
`core/document.ts`. It reuses the existing non-code-span scanner (comments and
string literals are skipped) and collects:

- `P.x` / `PARAMETERS.x`
- `P["x"]` / `P['x']`
- destructuring `const { a, b: alias } = P` (keys `a`, `b`)

`dynamic` is true when the script reads a parameter with a computed key
(`P[expr]`) or passes `P`/`PARAMETERS` as a whole value. The caller then shows
every parameter. Exported from both the package entry and the browser entry.

### 4.5 Prompt

`backend/prompt.ts` gains the `color()` helper in the prelude reference and the
colour parameter shape. Rules: use colour only when the user asks for one or the
object has several parts; declare every colour as a `type: "color"` parameter
(never a literal hex in the call); call `color()` last on each returned solid.
The "PARAMETERS hold NUMBERS only" rule is reworded: lengths are numbers,
colours are `#rrggbb` strings, and every other string option stays literal.

## 5. Studio

### 5.1 Inspector section

- New `section#cadParamsSection.inspector-section` (summary "Parameters"),
  placed before the Color section. It is shown when the selected node's
  manifest has `metadata.cad` and its design resolves through
  `resolveCadDesign`. The design is cached per source CID.
- A new module `frontend/src/js/ui/cad-params-panel.ts` owns it. One row per
  used parameter, in table order:
  - length: label (falls back to the name), a number input and a range slider
    from `min` to `max`, and the unit "mm". Without `min`/`max` there is no
    slider, only the number input. Values outside the range are clamped when
    committed.
  - colour: label and `input[type=color]`.
- **Reset** restores the values loaded with the version.
- Inputs are disabled in View mode with the Scale hint pattern
  ("Switch to Edit to change parameters.").
- Follows the edit-ui skill: Graphite/Paper tokens, labelled controls, WCAG 2.2
  AA, keyboard reachable.

### 5.2 Live preview

- `input` events schedule a render after a 300 ms pause. At most one worker
  render runs at a time; if values change during a render, only the newest
  values are rendered next.
- A successful render swaps the node's meshes for the rebuilt 3MF through the
  3MF handler's load path. The node keeps its manifest transform and
  `post_processor` overlay.
- A failed render (guard, kernel, timeout) keeps the last good preview. The
  section shows the `CadRenderError` message inline and marks the change as
  not applied. Saving is blocked while the latest values have no successful
  render.
- Each committed change (`change` event) pushes one undo entry (previous value
  map → new value map) through `pushUndoEntry` / `registerUndoApplier`. Undo
  re-renders.
- The edit is a pending source registered with `registerPendingSource`, so
  Save Draft / Publish become active. Closing the inspector does **not** discard
  the edit (unlike the colour preview revert). Discard follows the existing
  unsaved-changes flow.

### 5.3 Studio colour picker on CAD parts

If the selected part of a CAD node was coloured by `color(…, P.x)`, the
existing per-part colour picker (`selectedComponentColor`) edits parameter `x`
and the row in the Parameters section updates to match. The part ↔ parameter
link is recorded at render time: the kernel stores, per part, which colour
parameter value tagged it, matched by value. When two colour parameters share a
value, the first in table order wins. Parts with no colour parameter keep
today's bake-into-3MF path.

## 6. Save

- New `applyCadParameterEdits(manifest, pending, dedupMap)` in
  `manifest-builder.ts`. It runs **before** `applySourceColorEdits`. For each
  edited node:
  1. Takes the bytes from the last successful preview render. Their sidecar
     already holds the edited values. The design's `summary` becomes
     `"Parameters: width 60→80 mm, lidColor #d33a2c→#2c7ad3"`, and `turn` is
     unchanged.
  2. Reads the per-object baked colours of the node's current source (3MF
     `<basematerials>` / triangle colours from earlier Studio bakes). Only parts
     the script leaves uncoloured receive them; a part tagged by `color()`
     keeps the script's colour.
  3. Uploads the 3MF, normalizes it through the handler's `decomposeForSave`,
     and points the node at the new CID (`pointNodeAtEditedSource`).
  4. Re-applies the baked colours from step 2 by object name (`part-n`) through
     `editSourceColors`. Names with no match are dropped and listed in a toast:
     "Colours reset on part-3 (the part count changed)."
  5. Updates `metadata.cad.stats` (`triangles`, `bboxMm`) from the render
     stats.
- A pending Studio colour edit for the same node then runs as today, on the new
  CID.
- After a successful save, the active "Refining" chip's `design` (if it points
  at this node) is replaced with the edited design, so the next AI prompt
  starts from the saved values.

## 7. Errors

| Case | Behaviour |
|------|-----------|
| Design cannot be read from the source | Section hidden; console warn |
| Prelude mismatch | Section shows "This part was made with a newer CAD runtime — refresh the page." and is disabled |
| Render fails | Last good preview kept; inline error; save blocked for that node |
| Upload / decompose fails on save | Save fails with the existing save error path; nothing half-applied on the manifest |
| Part count changes on rebuild | Matching colours kept; toast lists reset parts |

## 8. Testing

**Unit (`test/`):**
- `parseParameter`: colour accepted, lowercased; bad hex, `unit` on a colour,
  unknown `type` rejected; lengths unchanged.
- `usedParameterNames`: dot, bracket, destructuring with alias, names inside
  comments/strings ignored, computed key sets `dynamic`.
- Kernel: `color()` tags a returned part; a boolean after `color()` drops the
  tag; a bad hex throws; untagged designs produce identical `parts`.
- Exporter → `parse3mfModel` round trip: colours come back per object; an
  uncoloured design is byte-identical to the current output.
- API schema: a colour parameter passes `cadDesignSchema`.
- `manifest-builder`: parameter edit yields a new CID, sidecar holds new values,
  baked colours carried by name, dropped names reported, stats updated, runs
  before the colour bake.

**Frontend (`test/frontend/`):**
- `cad-params-panel`: only used parameters are listed (all when `dynamic`);
  min/max clamp; renders are debounced and only the newest values run; failure
  keeps the preview and blocks save; View mode disables inputs; undo restores
  values.

**E2E (new spec, `CAD_MOCK_GENERATION=true`):** generate a part → Parameters
section lists its parameters → change a length → bottom-bar dimensions change →
Save Draft → reopen the version → the new value and dimensions persist.

## 9. Out of scope

- Colouring individual faces; colour on intermediate solids.
- Editing the script by hand; adding, removing or renaming parameters in the UI.
- A `besk` CLI/MCP command to set parameters. CLI↔MCP parity applies, so it is
  a separate follow-up (arbesk-add-command).
- Server-side `sourceRef` resolution.
