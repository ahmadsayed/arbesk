# Asset Info Readouts — Design (UI refresh Phase 3, issue #84)

**Date:** 2026-10-04 · **Status:** approved in brainstorm · **Issue:** #84 · **Epic:** #87

## 1. Why

Artists and 3D-printing users check the same facts first: how big is it, how
heavy is it, will it print, where did it come from. Today those facts are
either absent (units-aware dimensions, printability), buried (triangle count
sits in an "Auto-detected" list only visible after a save), or aimed at the
wrong audience (the "Notes for the AI" metadata chips are character-oriented:
`character_name`, `role`, `species`, `lore`).

This phase adds read-only asset info readouts — bounding box with real units,
triangle count, file format/size, a print-ready (manifold) badge — to
Properties and the status bar, and replaces "Notes for the AI" with a typed
"Print & Provenance" section: licence, material, units, print notes, source
credits.

## 2. What exists already

- `manifest.metadata.computed` is baked on every save
  (`services/asset-save/manifest-builder.ts` → `computeAssetStats` →
  `@arbesk/asset-core` `formats/gltf/model-stats.ts`): `format`,
  `dimensions` (W×H×D with `unit: "meters"`), `bounds`, `center`, `origin`,
  `animation_clips`, `triangle_count`, `vertex_count`, mesh/node/material/
  texture counts, `rigged`, `bone_count`. Pure — accessor metadata only, no
  buffer reads.
- Properties → Metadata (`ui/metadata-editor.ts`, `studio-main.pug`
  `#metadataSection`): an "Auto-detected" `<dl>` rendering
  `metadata.computed`, and the free-form key/value "Notes for the AI"
  annotations editor writing `metadata.annotations` via the
  pending-annotations store (`services/asset-save/annotations.ts`).
- Bottom bar (`bottombar.pug`): `#bottomBarStatus`, `#bottomBarProvider`,
  `#bottomBarSelection` items.
- Manifest schema (`packages/asset-core/src/manifest/schema.ts`) already
  preserves arbitrary `metadata.annotations` keys — no schema change needed.

## 3. Decisions (locked in brainstorm)

1. **Units are a per-asset annotation.** `metadata.annotations.units` ∈
   `"m" | "cm" | "mm"`, default `"m"` (glTF spec). CAD/3MF saves stamp
   `units: "mm"` automatically. All dimension displays convert through it.
2. **Printability is on-demand, never baked.** A "Check printability" button
   in Properties runs a pure edge-analysis over the loaded scene; the result
   is a session-cached badge. Nothing enters the manifest or the save path.
3. **Typed fields over free-form storage.** "Print & Provenance" fields write
   plain keys into `metadata.annotations` (`licence`, `material`, `units`,
   `print_notes`, `source`); the free-form "+ Add field" rows stay.
4. **Status bar shows dimensions + triangles only**, from the baked
   `metadata.computed`; the print badge stays in Properties.
5. **The analysis is a pure module fed by the loaded scene** — not an
   asset-core executor op, not the Manifold WASM kernel.

## 4. Units & dimensions display

New `frontend/src/js/utils/units.ts`:

- `type Units = "m" | "cm" | "mm"`.
- `readUnits(annotations): Units` — `"mm"`/`"cm"`/`"m"`; anything else or
  missing → `"m"`.
- `formatDimensions(dimensions: ComputedDimensions, units: Units): string` —
  converts from the stored meters (`m` → `×1`, `cm` → `×100`, `mm` → `×1000`)
  and formats `85 × 54 × 12 mm` / `1.84 × 0.62 × 0.55 m`. Precision: mm shows
  integers, cm one decimal, m two decimals.
- `formatCountCompact(n)` — `12.4k` style for the status bar.

Consumers:

- `metadata-editor.ts` `formatDimensions` routes through `formatDimensions`
  with `readUnits(readAnnotations())`, so editing the Units field re-renders
  the Auto-detected list on the next `render()`.
- The diagnostic `bounds` / `center` / `origin` rows stay as-is — this phase
  adds readouts, it doesn't subtract diagnostics.

CAD stamping: CAD-generated assets carry exact kernel-computed geometry in
`CadStats` (`bboxMm`, `triangles`, `volumeMm3`) at render time
(`workers/cad-render-core.ts`), but today only summary/provider/attribution
reach `metadata.cad` (`services/api.ts` `stageCadAsset`). This phase stamps
`metadata.cad.stats = { triangles, bboxMm }` at generation/follow-up, and
`computeAssetStats` (`services/asset-save/metadata-extract.ts`) maps a 3MF
root's `metadata.cad.stats.bboxMm` to `computed.dimensions`
(`unit: "mm"`) + `computed.triangle_count`. That gives CAD assets real mm
dimensions without parsing 3MF on the save path. Uploaded (non-CAD) 3MF
files stay format-only. Separately, when `manifest.metadata.cad` exists and
no explicit `annotations.units` is set, the save stamps `units: "mm"`.
Explicit user choice always wins.

## 5. Printability check

New `frontend/src/js/utils/printability.ts` — pure, no imports:

```ts
interface PrintabilityReport {
  manifold: boolean;
  triangleCount: number;
  openEdges: number;        // edges shared by exactly 1 triangle
  nonManifoldEdges: number; // edges shared by 3+ triangles
}
function analyzePrintability(
  meshes: { positions: Float32Array; indices: Uint32Array }[]
): PrintabilityReport;
```

Edge keys are quantized vertex-position pairs (positions, not indices —
welding duplicated vertices at 1e-5 tolerance), packed as string keys into a
`Map<string, number>` of edge → sharer count. A mesh set is watertight when
every edge is shared by exactly 2 triangles. Degenerate triangles (two equal
vertices) are skipped.

UI: a new `ui/printability.ts` module (keeps `metadata-editor.ts` under the
complexity ratchet), rendering into the Metadata section:

- A "Check printability" button in the Metadata section's Auto-detected
  block (visible when an asset is open).
- On click: collect `positions`/`indices` from the scene's loaded meshes
  (Babylon `getVerticesData(PositionKind)` / `getIndices()`, skipping
  viewport chrome via `metadata.isViewportChrome`), run the analysis, render
  a badge inline: `Print-ready` (success token) or
  `Not watertight · N open edges` (warning token), plus a toast.
- Results are cached in a session `Map<manifestCid, PrintabilityReport>`;
  the entry is dropped on `SCENE_CLEARED` and simply doesn't apply once a
  follow-up produces a new version (new CID). No edit-path invalidation is
  needed: the app's in-scene edits (color, scale, placement) never change
  mesh topology, so a cached verdict stays true for its CID.

Meshes already in memory means no IPFS reads, no worker; at the ≤20k-face
scale of Tripo retopo targets this runs in milliseconds on the main thread.
If profiling ever says otherwise, the pure module moves into the existing
gltf worker pool unchanged.

## 6. Metadata section rework

`studio-main.pug` `#metadataSection`:

- The "Notes for the AI" `<details>` becomes **"Print & Provenance"** with
  five typed fields:
  - **Licence** — text input, placeholder `CC-BY-4.0` (SPDX hint).
  - **Material** — text input, placeholder `PLA, resin, …`.
  - **Units** — select `m` / `cm` / `mm` (the `units` annotation; drives all
    dimension display).
  - **Print notes** — textarea.
  - **Source / Credits** — text input, placeholder `URL or attribution`.
- All five write plain string keys into `metadata.annotations` through the
  existing pending-annotations store — no manifest schema change, old assets
  unchanged.
- The free-form key/value rows and "+ Add field" button stay below the typed
  fields; annotations with keys outside the five render there. The typed
  fields seed from existing annotations on load (an old asset with
  `material: "PLA"` shows it in the Material input).
- The character quick-add chips (`character_name`, `role`, `species`, `tags`,
  `lore`, `pivot`) are deleted.

## 7. Status bar readout

`bottombar.pug` gains `span#bottomBarAssetInfo.bottombar-status-item.tabular`
(hidden by default). When an asset is open and `metadata.computed` carries
`dimensions` and `triangle_count`, a subscriber (asset state changed +
annotations changed) sets:

```
1.84 × 0.62 × 0.55 m · 12.4k tris
```

Unit-aware via `formatDimensions`; hidden with no asset, no computed facts,
or a never-saved draft (no `metadata.computed` yet). Owner: a small new
`ui/bottombar-info.ts` subscribed to asset-state/annotation events —
`asset-chrome.ts` is already at the complexity ratchet.

## 8. Accessibility & theming

- Badge text carries the meaning; colour is supplementary (WCAG 1.4.1).
- All new text pairs go into `DERIVED_TEXT_PAIRS` in
  `test/frontend/theme-contrast.test.js` if any `color-mix()` tint is
  introduced; otherwise existing tokens only (`.badge` idiom if one exists,
  else `--success`/`--warning` on `--raised-bg`).
- `units` select and typed inputs get `aria-label`s; the status-bar item is
  `aria-live="off"` (it mirrors Properties; screen readers use the list).
- `.tabular` for the numbers (JetBrains Mono + tabular figures).

## 9. Testing

**Unit (bun test):**

- `test/frontend/units.test.js` — conversion table, default, bad values.
- `test/frontend/printability.test.js` — closed cube → manifold; single
  plane → 4 open edges; duplicated-vertex weld tolerance; degenerate
  triangles skipped; empty input.
- `metadata-editor.test.js` — typed fields round-trip into
  `metadata.annotations`; Units select re-renders dimensions; old
  annotations land in free-form rows; chips gone.
- Status-bar render/hide cases (in whichever module owns it).

**E2E (`e2e/`, selectors synced to `studio-selectors.mjs`):**

- Spec 21 (`metadata-computed`) extended: after a CAD save, status bar shows
  mm dimensions; after a Tripo-mock save, meter dimensions.
- Printability: on a CAD-generated model (Manifold kernel output is
  watertight by construction) the badge reads `Print-ready`; on the
  Tripo-mock character it reads `Not watertight · N open edges` — AI models
  are genuinely non-manifold (verified: open clothing shells), and the honest
  negative is the useful signal.
- Metadata: typed fields persist across save/reopen.

**Contract notes:** `metadata.computed` gains optional keys only:
`dimensions` + `triangle_count` on 3MF roots (from `metadata.cad.stats`).
No existing keys change shape; `file_size` is dropped (§10).

## 10. `file_size` dropped

The issue asks for "format/size". Format is already in `metadata.computed`;
byte size is **not** plumbed: the save pipeline never holds the composed GLB
byte length at stats time (stats read the root glTF JSON; buffers live in
separate IPFS parts). Per YAGNI, `file_size` is dropped — format alone
satisfies the readout.

## 11. Out of scope

- Manifold/printability baked into the manifest, shown in Library or public
  profiles.
- Self-intersection, wall thickness, or overhang analysis.
- Changing the `metadata.computed` writer's purity (no buffer reads on save).
- Migrating existing free-form annotations into typed fields on read
  (they render as free-form rows; the user can re-key them).

## 12. Risks

- **Units honesty**: defaulting glTF to meters means Tripo characters read
  ~2 m — correct per spec, and the Units select is the escape hatch. The
  placeholder/hint copy must make that discoverable.
- **Session-cached badge staleness**: mitigated by construction — no in-app
  edit changes mesh topology (color/scale/placement only), and follow-up
  regenerations produce a new CID that the cache doesn't cover.
- **E2E churn**: metadata section ids change (`#metadataAnnotationsList`
  stays; chips removed). Grep `e2e/` before renaming anything.
