# Asset Info Readouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the facts print users check first — unit-aware dimensions, triangle count, an on-demand printability badge — and replace the character-oriented "Notes for the AI" metadata chips with typed Print & Provenance fields.

**Architecture:** All heavy facts already exist (`metadata.computed` baked at save; CAD `CadStats.bboxMm` at render). This plan adds two pure utils (`units`, `printability`), stamps CAD stats into `metadata.cad` so 3MF roots get real mm dimensions, reworks the metadata section to typed fields over plain annotation keys, and adds a status-bar readout. No manifest schema change, no save-path buffer reads, nothing baked for printability.

**Tech Stack:** TypeScript frontend (Bun.build), Pug/SCSS, bun test + jsdom, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-10-04-asset-info-readouts-design.md`

## Global Constraints

- Branch: `feat/asset-info-readouts` off `origin/main` in the worktree `.worktrees/ui-theme-p1-1`; one PR closes #84; commit per task with the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer.
- Frontend imports carry explicit `.ts` extensions (`.js` only for plain-JS files like `constants/chains.js`).
- Tests: `// @test-env dom` first line for DOM tests; run via `bun scripts/run-tests.mjs <file>`; mock ESM with `mock.module()` before dynamic `import()`.
- SCSS: theme tokens only in `components/` (no hex); numbers get `.tabular`; `test/frontend/style-guards.test.js` must pass.
- E2E ids are a public contract: sync `e2e/helpers/studio-selectors.mjs` with any id/label change and grep `e2e/` before renaming.
- After each task touching `frontend/src`: `cd frontend && bun run build`.
- The pre-commit hook runs `fallow audit` (new-findings-only): keep new functions small; `asset-chrome.ts` is already at the ratchet — do not add to it.
- After any E2E run: `git checkout -- blockchain/deployments` (the harness dirties it).
- Existing unit baseline: 19 frontend test files fail on clean `origin/main` — compare failing-file sets, never totals.

---
### Task 1: Units util

**Files:**
- Create: `frontend/src/js/utils/units.ts`
- Test: `test/frontend/units.test.js`

**Interfaces:**
- Produces: `type Units = "m" | "cm" | "mm"`;
  `readUnits(annotations: Record<string, unknown> | null | undefined): Units`;
  `formatDimensions(d: { width?: number; height?: number; depth?: number; unit?: string }, units: Units): string`;
  `formatCountCompact(n: number): string`.
- Consumed by: Task 4 (metadata-editor dimensions), Task 6 (status bar).

- [ ] **Step 1: Write the failing test**

Create `test/frontend/units.test.js` (no DOM needed):

```js
import { describe, expect, test } from "bun:test";
import {
  readUnits,
  formatDimensions,
  formatCountCompact,
} from "../../frontend/src/js/utils/units.js";

const D = { width: 1.845, height: 0.62, depth: 0.5499, unit: "meters" };
const DMM = { width: 85, height: 54, depth: 12.4, unit: "mm" };

describe("readUnits", () => {
  test("defaults to m and rejects junk", () => {
    expect(readUnits(null)).toBe("m");
    expect(readUnits({})).toBe("m");
    expect(readUnits({ units: "furlongs" })).toBe("m");
  });
  test("accepts m/cm/mm", () => {
    expect(readUnits({ units: "mm" })).toBe("mm");
    expect(readUnits({ units: "cm" })).toBe("cm");
    expect(readUnits({ units: "m" })).toBe("m");
  });
});

describe("formatDimensions", () => {
  test("meters stay meters at 2 decimals, trailing zeros stripped", () => {
    expect(formatDimensions(D, "m")).toBe("1.85 × 0.62 × 0.55 m");
  });
  test("converts meters to cm and mm", () => {
    expect(formatDimensions(D, "cm")).toBe("184.5 × 62 × 55 cm");
    expect(formatDimensions(D, "mm")).toBe("1845 × 620 × 550 mm");
  });
  test("mm-stored input (CAD) converts from mm", () => {
    expect(formatDimensions(DMM, "mm")).toBe("85 × 54 × 12 mm");
    expect(formatDimensions(DMM, "cm")).toBe("8.5 × 5.4 × 1.2 cm");
  });
  test("missing values dash out", () => {
    expect(formatDimensions({ width: 1 }, "m")).toBe("—");
  });
});

describe("formatCountCompact", () => {
  test("small counts are plain, thousands are k-compact", () => {
    expect(formatCountCompact(990)).toBe("990");
    expect(formatCountCompact(12400)).toBe("12.4k");
    expect(formatCountCompact(1000000)).toBe("1000k");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun scripts/run-tests.mjs test/frontend/units.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `utils/units.ts`**

```ts
/**
 * Unit-aware formatting for asset facts.
 * @remarks `metadata.computed.dimensions` are stored in glTF units
 *   ("meters") or, for CAD-stamped 3MF roots, "mm". The per-asset
 *   `metadata.annotations.units` field picks the display unit.
 */

export type Units = "m" | "cm" | "mm";

export function readUnits(
  annotations: Record<string, unknown> | null | undefined
): Units {
  const u = annotations?.units;
  return u === "mm" || u === "cm" || u === "m" ? u : "m";
}

interface Dims {
  width?: number;
  height?: number;
  depth?: number;
  unit?: string;
}

/** Normalize a stored value to meters (the glTF reference unit). */
function toMeters(v: number, unit?: string): number {
  return unit === "mm" ? v / 1000 : v;
}

const SCALE: Record<Units, number> = { m: 1, cm: 100, mm: 1000 };
const DECIMALS: Record<Units, number> = { m: 2, cm: 1, mm: 0 };

function formatValue(meters: number, units: Units): string {
  const x = meters * SCALE[units];
  const dec = DECIMALS[units];
  if (dec === 0) return String(Math.round(x));
  // fixed decimals, then strip trailing zeros (and a bare trailing dot)
  return x.toFixed(dec).replace(/\.?0+$/, "");
}

export function formatDimensions(d: Dims, units: Units): string {
  const raw = [d?.width, d?.height, d?.depth];
  if (raw.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
    return "—";
  }
  const vals = (raw as number[]).map((n) => formatValue(toMeters(n, d?.unit), units));
  return `${vals.join(" × ")} ${units}`;
}

/** 990 → "990", 12400 → "12.4k". */
export function formatCountCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n < 1000) return String(Math.round(n));
  return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}
```

- [ ] **Step 4: Run tests**

Run: `bun scripts/run-tests.mjs test/frontend/units.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/utils/units.ts test/frontend/units.test.js
git commit -m "feat(utils): unit-aware dimension + compact-count formatting"
```

---
### Task 2: Printability analysis (pure)

**Files:**
- Create: `frontend/src/js/utils/printability.ts`
- Test: `test/frontend/printability.test.js`

**Interfaces:**
- Produces: `interface MeshGeometry { positions: Float32Array | number[]; indices: Uint32Array | number[] }`;
  `interface PrintabilityReport { manifold: boolean; triangleCount: number; openEdges: number; nonManifoldEdges: number }`;
  `analyzePrintability(meshes: MeshGeometry[]): PrintabilityReport`.
- Consumed by: Task 5 (the UI button).

- [ ] **Step 1: Write the failing test**

Create `test/frontend/printability.test.js` (no DOM needed):

```js
import { describe, expect, test } from "bun:test";
import { analyzePrintability } from "../../frontend/src/js/utils/printability.js";

// Unit cube: 8 corners, 12 triangles (2 per face).
const CUBE = {
  positions: [
    0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
    0, 0, 1,  1, 0, 1,  1, 1, 1,  0, 1, 1,
  ],
  indices: [
    0, 2, 1,  0, 3, 2, // bottom
    4, 5, 6,  4, 6, 7, // top
    0, 1, 5,  0, 5, 4, // front
    2, 3, 7,  2, 7, 6, // back
    1, 2, 6,  1, 6, 5, // right
    0, 4, 7,  0, 7, 3, // left
  ],
};

// Single quad: 4 corners, 2 triangles — 4 boundary edges.
const PLANE = {
  positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
  indices: [0, 1, 2, 0, 2, 3],
};

describe("analyzePrintability", () => {
  test("closed cube is manifold", () => {
    const r = analyzePrintability([CUBE]);
    expect(r.manifold).toBe(true);
    expect(r.triangleCount).toBe(12);
    expect(r.openEdges).toBe(0);
    expect(r.nonManifoldEdges).toBe(0);
  });

  test("single plane has 4 open edges", () => {
    const r = analyzePrintability([PLANE]);
    expect(r.manifold).toBe(false);
    expect(r.openEdges).toBe(4);
  });

  test("duplicated vertices are welded (positions, not indices)", () => {
    // Same quad as PLANE but each triangle carries its own 4 corners.
    const dup = {
      positions: [
        0, 0, 0, 1, 0, 0, 1, 1, 0,
        0, 0, 0, 1, 1, 0, 0, 1, 0,
      ],
      indices: [0, 1, 2, 3, 4, 5],
    };
    const r = analyzePrintability([dup]);
    expect(r.triangleCount).toBe(2);
    expect(r.openEdges).toBe(4); // diagonal is welded and shared by 2
  });

  test("an edge shared by 3 triangles is non-manifold", () => {
    const twoPlanes = {
      positions: [...PLANE.positions, 0, 0, 1],
      indices: [...PLANE.indices, 0, 1, 6], // third face on edge 0-1
    };
    const r = analyzePrintability([twoPlanes]);
    expect(r.manifold).toBe(false);
    expect(r.nonManifoldEdges).toBe(1);
  });

  test("degenerate triangles are skipped", () => {
    const deg = { positions: [0, 0, 0, 1, 0, 0], indices: [0, 0, 1] };
    const r = analyzePrintability([deg]);
    expect(r.triangleCount).toBe(0);
    expect(r.manifold).toBe(false); // empty is not print-ready
  });

  test("empty input", () => {
    const r = analyzePrintability([]);
    expect(r).toEqual({
      manifold: false,
      triangleCount: 0,
      openEdges: 0,
      nonManifoldEdges: 0,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun scripts/run-tests.mjs test/frontend/printability.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `utils/printability.ts`**

```ts
/**
 * Watertightness (manifold) check for print readiness.
 * @remarks Pure over typed arrays — no Babylon, no DOM — so it is testable
 *   in bun and portable to a worker or the CLI later. Vertices are welded by
 *   quantized position (1e-5 tolerance), not by index, so duplicated-corner
 *   meshes are judged by their true topology. A mesh set is watertight when
 *   every edge is shared by exactly 2 triangles.
 */

export interface MeshGeometry {
  positions: Float32Array | number[];
  indices: Uint32Array | number[];
}

export interface PrintabilityReport {
  manifold: boolean;
  triangleCount: number;
  /** edges shared by exactly 1 triangle (boundary) */
  openEdges: number;
  /** edges shared by 3+ triangles */
  nonManifoldEdges: number;
}

const WELD = 1e5;

function vertexKey(positions: Float32Array | number[], i: number): string {
  const o = i * 3;
  return (
    Math.round(positions[o] * WELD) + "," +
    Math.round(positions[o + 1] * WELD) + "," +
    Math.round(positions[o + 2] * WELD)
  );
}

export function analyzePrintability(meshes: MeshGeometry[]): PrintabilityReport {
  const edgeCount = new Map<string, number>();
  let triangleCount = 0;

  for (const { positions, indices } of meshes) {
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const a = vertexKey(positions, indices[t]);
      const b = vertexKey(positions, indices[t + 1]);
      const c = vertexKey(positions, indices[t + 2]);
      if (a === b || b === c || a === c) continue; // degenerate
      triangleCount++;
      const edges = [
        a < b ? a + "|" + b : b + "|" + a,
        b < c ? b + "|" + c : c + "|" + b,
        c < a ? c + "|" + a : a + "|" + c,
      ];
      for (const e of edges) edgeCount.set(e, (edgeCount.get(e) ?? 0) + 1);
    }
  }

  let openEdges = 0;
  let nonManifoldEdges = 0;
  for (const n of edgeCount.values()) {
    if (n === 1) openEdges++;
    else if (n > 2) nonManifoldEdges++;
  }

  return {
    manifold: triangleCount > 0 && openEdges === 0 && nonManifoldEdges === 0,
    triangleCount,
    openEdges,
    nonManifoldEdges,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `bun scripts/run-tests.mjs test/frontend/printability.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/utils/printability.ts test/frontend/printability.test.js
git commit -m "feat(utils): pure watertightness analysis for print readiness"
```

---
### Task 3: CAD stats → manifest; 3MF dimensions; mm auto-stamp

**Files:**
- Modify: `frontend/src/js/services/api.ts` (`stageCadAsset`, ~line 779–821)
- Modify: `frontend/src/js/services/asset-save/metadata-extract.ts`
- Modify: `frontend/src/js/services/asset-save/manifest-builder.ts` (annotations bake block, ~line 795)
- Test: `test/frontend/asset-save-metadata.test.js`

**Interfaces:**
- Consumes: `rendered.stats` (`CadStats` from `workers/cad-render-core.ts`: `{ triangles, vertices, volumeMm3, bboxMm: { min, max } }`).
- Produces: manifests may carry `metadata.cad.stats: { triangles: number, bboxMm: { min: [n,n,n], max: [n,n,n] } }`; 3MF roots gain `computed.dimensions` (`unit: "mm"`, **height = Z**, the CAD vertical) and `computed.triangle_count`; CAD saves default `metadata.annotations.units = "mm"` when unset.

- [ ] **Step 1: Write the failing tests**

Append to `test/frontend/asset-save-metadata.test.js` (follow the file's existing import/mock style — it already imports `computeAssetStats`):

```js
test("3MF root with CAD stats maps bboxMm to mm dimensions (height = Z)", async () => {
  const manifest = {
    scene: { nodes: [{ source: { cid: "bafy3mf", format: "3mf" } }] },
    metadata: {
      cad: {
        stats: {
          triangles: 12400,
          bboxMm: { min: [0, 0, 0], max: [85, 54, 12] },
        },
      },
    },
  };
  const stats = await computeAssetStats(manifest);
  expect(stats.format).toBe("3mf");
  expect(stats.dimensions).toEqual({
    width: 85,
    depth: 54,
    height: 12,
    unit: "mm",
  });
  expect(stats.triangle_count).toBe(12400);
});

test("3MF root without CAD stats stays format-only", async () => {
  const manifest = {
    scene: { nodes: [{ source: { cid: "bafy3mf", format: "3mf" } }] },
  };
  const stats = await computeAssetStats(manifest);
  expect(stats).toEqual({ format: "3mf" });
});
```

And a units-stamp test. Check how `manifest-builder.test.js` builds its context (`ctx.mod.prepareManifestForWrite`) and add there instead if `annotations` plumbing lives in that file's mocks:

```js
test("CAD save defaults annotations.units to mm when unset", async () => {
  // reuse the file's existing helper to build a manifest context, with
  // metadata.cad present and no annotations.units
  const result = await ctx.mod.prepareManifestForWrite("CAD mm");
  expect(result.manifest.metadata.annotations.units).toBe("mm");
});

test("explicit units annotation wins over the CAD mm default", async () => {
  // same, but seed annotations { units: "m" } in the pending/current manifest
  const result = await ctx.mod.prepareManifestForWrite("CAD m");
  expect(result.manifest.metadata.annotations.units).toBe("m");
});
```

(Verify against `manifest-builder.test.js`'s existing fixtures and adjust the setup lines — the assertions are the contract.)

- [ ] **Step 2: Run them to verify they fail**

Run: `bun scripts/run-tests.mjs test/frontend/asset-save-metadata.test.js test/frontend/manifest-builder.test.js`
Expected: FAIL (dimensions undefined / no units stamp).

- [ ] **Step 3a: Stamp stats in `stageCadAsset` (`services/api.ts`)**

Widen the param and stamp:

```ts
async function stageCadAsset(
  rendered: {
    bytes: Uint8Array;
    summary: string;
    stats?: { triangles?: number; bboxMm?: { min: number[]; max: number[] } };
  },
```

```ts
  manifest.metadata = {
    ...(manifest.metadata ?? {}),
    cad: {
      summary: rendered.summary,
      provider: final.provider ?? null,
      attribution: final.attribution ?? [],
      providerTaskId: final.providerTaskId ?? null,
      ...(rendered.stats?.bboxMm
        ? {
            stats: {
              triangles: rendered.stats.triangles ?? 0,
              bboxMm: rendered.stats.bboxMm,
            },
          }
        : {}),
    },
  };
```

Also update the doc comment above `stageCadAsset` ("summary/provider/attribution/providerTaskId" → add "stats (triangles/bboxMm)").

- [ ] **Step 3b: 3MF dimensions in `metadata-extract.ts`**

Replace the early return:

```ts
  if (format === "3mf") {
    // CAD-generated 3MF carries exact kernel stats in mm (Z-up: height = Z).
    const cadStats = manifest?.metadata?.cad?.stats;
    const bbox = cadStats?.bboxMm;
    if (!bbox) return { format: "3mf" };
    const size = bbox.max.map((v: number, k: number) => v - bbox.min[k]);
    return {
      format: "3mf",
      dimensions: {
        width: size[0],
        depth: size[1],
        height: size[2],
        unit: "mm",
      },
      triangle_count:
        typeof cadStats.triangles === "number" ? cadStats.triangles : undefined,
    };
  }
```

- [ ] **Step 3c: mm default in `manifest-builder.ts`**

Immediately after the annotations-bake block (`if (pendingAnnotations !== null) { … }`), add:

```ts
  // CAD parts are millimetre-native: default the units annotation to mm
  // unless the user picked one explicitly.
  if (manifest.metadata?.cad) {
    manifest.metadata.annotations ||= {};
    if (!manifest.metadata.annotations.units) {
      manifest.metadata.annotations.units = "mm";
    }
  }
```

- [ ] **Step 4: Run tests**

Run: `bun scripts/run-tests.mjs test/frontend/asset-save-metadata.test.js test/frontend/manifest-builder.test.js`
Expected: new tests PASS; `manifest-builder.test.js` keeps its pre-existing baseline failures (13 at the time of writing — compare test names, not counts).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/services test/frontend/asset-save-metadata.test.js test/frontend/manifest-builder.test.js
git commit -m "feat(save): stamp CAD kernel stats; 3MF roots gain mm dimensions"
```

---
### Task 4: Metadata section → "Print & Provenance"

**Files:**
- Modify: `frontend/src/pug/includes/studio-main.pug` (`#metadataSection`, ~line 98–116)
- Modify: `frontend/src/js/ui/metadata-editor.ts`
- Test: `test/frontend/metadata-editor.test.js`

**Interfaces:**
- Consumes: `readUnits`, `formatDimensions` from `utils/units.ts` (Task 1); the pending-annotations store (`getPendingAnnotations` / `setPendingAnnotations` from `services/asset-save/annotations.ts`).
- Produces: typed field ids `#metaLicence`, `#metaMaterial`, `#metaUnits`, `#metaPrintNotes`, `metaSource`; annotation keys `licence` / `material` / `units` / `print_notes` / `source`. Keeps `#metadataAnnotationsList`, `#metadataAddBtn`, `#metadataComputedList` ids. Removes the `.metadata-chip` quick-add buttons.

- [ ] **Step 1: Write the failing tests**

Append to `test/frontend/metadata-editor.test.js` (follow the file's existing DOM fixture and module-load pattern):

```js
test("typed fields seed from and write to plain annotation keys", async () => {
  // existing helper: make an asset active with annotations
  //   { licence: "CC0", material: "PLA", units: "mm", print_notes: "brim",
  //     source: "https://example.com", custom_key: "kept" }
  // then:
  expect(document.getElementById("metaLicence").value).toBe("CC0");
  expect(document.getElementById("metaUnits").value).toBe("mm");
  // custom keys stay in the free-form rows:
  expect(
    [...document.querySelectorAll("#metadataAnnotationsList .metadata-kv-key")]
      .map((i) => i.value)
  ).toEqual(["custom_key"]);
  // typing into a typed field writes the annotation:
  const lic = document.getElementById("metaLicence");
  lic.value = "CC-BY-4.0";
  lic.dispatchEvent(new Event("input"));
  expect(getPendingAnnotations().licence).toBe("CC-BY-4.0");
});

test("dimensions render unit-aware from the units annotation", async () => {
  // active asset with metadata.computed.dimensions {width:0.085,height:0.054,depth:0.012,unit:"meters"}
  // and annotations {units:"mm"}:
  const list = document.getElementById("metadataComputedList");
  expect(list.textContent).toContain("85 × 54 × 12 mm");
});

test("character quick-add chips are gone", () => {
  expect(document.querySelector(".metadata-chip")).toBe(null);
});
```

(Adjust the fixture setup lines to the file's existing helpers — assertions are the contract. Export `getPendingAnnotations` from the annotations module import in the test the way the file already imports sibling modules.)

- [ ] **Step 2: Run to verify they fail**

Run: `bun scripts/run-tests.mjs test/frontend/metadata-editor.test.js`
Expected: FAIL (elements absent / old formatting).

- [ ] **Step 3a: Pug**

In `studio-main.pug`, replace the "Notes for the AI" `<details>` block with:

```pug
      details.metadata-subsection(open)
        summary.inspector-section-title Print & Provenance
        div
          .metadata-typed
            label.metadata-typed-label(for="metaLicence") Licence
            input#metaLicence.form-input(type="text" placeholder="CC-BY-4.0" aria-label="Licence")
            label.metadata-typed-label(for="metaMaterial") Material
            input#metaMaterial.form-input(type="text" placeholder="PLA, resin, …" aria-label="Material")
            label.metadata-typed-label(for="metaUnits") Units
            select#metaUnits.form-select(aria-label="Units")
              option(value="m") meters
              option(value="cm") centimetres
              option(value="mm") millimetres
            label.metadata-typed-label(for="metaPrintNotes") Print notes
            textarea#metaPrintNotes.form-textarea(rows="2" aria-label="Print notes")
            label.metadata-typed-label(for="metaSource") Source / Credits
            input#metaSource.form-input(type="text" placeholder="URL or attribution" aria-label="Source or credits")
          #metadataAnnotationsList.metadata-kv
          .metadata-actions
            button#metadataAddBtn.btn.btn-secondary.btn-sm(type="button") + Add field
```

(Delete the `.metadata-quick-add` block with its six `.metadata-chip` buttons.)

- [ ] **Step 3b: `metadata-editor.ts`**

1. Import: `import { readUnits, formatDimensions as formatDimsWithUnits } from "../utils/units.ts";`
2. Replace the `dimensions` formatter entry so it is unit-aware — change `COMPUTED_FIELDS` `dimensions` line to:

```ts
  dimensions: {
    label: "Dimensions",
    format: (v) => formatDimsWithUnits(v as any, readUnits(readAnnotations())),
  },
```

and delete the now-unused local `formatDimensions` function.

3. Typed fields:

```ts
const TYPED_FIELDS = [
  { id: "metaLicence", key: "licence" },
  { id: "metaMaterial", key: "material" },
  { id: "metaUnits", key: "units" },
  { id: "metaPrintNotes", key: "print_notes" },
  { id: "metaSource", key: "source"},
] as const;

const TYPED_KEYS = new Set<string>(TYPED_FIELDS.map((f) => f.key));

function renderTypedFields(): void {
  const annotations = readAnnotations();
  for (const { id, key } of TYPED_FIELDS) {
    const input = el(id) as HTMLInputElement | HTMLSelectElement | null;
    if (!input) continue;
    const v = annotations[key];
    input.value = typeof v === "string" ? v : v == null ? "" : String(v);
  }
}

function writeTypedField(key: string, value: string): void {
  const annotations = { ...readAnnotations() };
  if (value === "") delete annotations[key];
  else annotations[key] = value;
  writeAnnotations(annotations);
}
```

4. In `renderAnnotations()`, skip typed keys:

```ts
  for (const [k, v] of Object.entries(annotations)) {
    if (TYPED_KEYS.has(k)) continue;
    list.appendChild(rowHtml(k, v));
  }
```

5. In `render()`, call `renderTypedFields()` before `renderAnnotations()`.
6. In `initMetadataEditor()`: delete the `.metadata-chip` wiring; add:

```ts
  for (const { id, key } of TYPED_FIELDS) {
    el(id)?.addEventListener("input", (e) => {
      writeTypedField(key, (e.target as HTMLInputElement).value);
      if (key === "units") render(); // re-render unit-aware dimensions
    });
  }
```

- [ ] **Step 3c: SCSS**

Add to `_metadata-editor.scss` (tokens only):

```scss
.metadata-typed {
  display: grid;
  grid-template-columns: minmax(90px, auto) 1fr;
  gap: var(--size-1) var(--size-2);
  align-items: center;
  margin-bottom: var(--size-2);
}

.metadata-typed-label {
  font-size: var(--font-size-0);
  color: var(--dim-fg);
}
```

- [ ] **Step 4: Build + tests**

Run: `cd frontend && bun run build && cd .. && bun scripts/run-tests.mjs test/frontend/metadata-editor.test.js test/frontend/units.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src test/frontend/metadata-editor.test.js
git commit -m "feat(inspector): Print & Provenance typed metadata fields, unit-aware dimensions"
```

---
### Task 5: Printability button + badge

**Files:**
- Create: `frontend/src/js/ui/printability.ts`
- Modify: `frontend/src/pug/includes/studio-main.pug` (Auto-detected block)
- Modify: `frontend/src/scss/components/_metadata-editor.scss`
- Modify: `frontend/src/js/app-init.ts` (call `initPrintability()`)
- Test: `test/frontend/printability-ui.test.js`

**Interfaces:**
- Consumes: `analyzePrintability`, `PrintabilityReport`, `MeshGeometry` from `utils/printability.ts` (Task 2); `getRenderableMeshes` from `engine/transforms.ts`; `getAssetState` from `@arbesk/asset-core/domain/asset.js`; `on`/`EVENTS` from `@arbesk/asset-core/events/bus.js`; `showToast` from `ui/toasts.ts`.
- Produces: `initPrintability(): void`; `#printCheckBtn`, `#printBadge`. Babylon (`BABYLON` CDN global) is referenced only inside the click handler, never at module top level.

- [ ] **Step 1: Write the failing test**

Create `test/frontend/printability-ui.test.js` (`// @test-env dom` first line). Mock `@arbesk/asset-core/domain/asset.js` (`getAssetState` returning a manifest-cid state) and `engine/transforms.ts` (`getRenderableMeshes` passthrough), following `header-wallet-button.test.js`'s mock style:

```js
// @test-env dom
import { beforeAll, beforeEach, expect, jest, mock, test } from "bun:test";

const state = { cid: "bafyA", meshes: [] };

await mock.module("@arbesk/asset-core/domain/asset.js", () => ({
  getAssetState: () => ({ activeAssetManifestCid: state.cid }),
}));
await mock.module("../../frontend/src/js/engine/transforms.js", () => ({
  getRenderableMeshes: (m) => m,
}));
await mock.module("../../frontend/src/js/ui/toasts.js", () => ({
  showToast: jest.fn(),
}));

let mod, bus;

const CUBE = {
  metadata: {},
  getVerticesData: () => [
    0,0,0, 1,0,0, 1,1,0, 0,1,0,
    0,0,1, 1,0,1, 1,1,1, 0,1,1,
  ],
  getIndices: () => [
    0,2,1, 0,3,2, 4,5,6, 4,6,7,
    0,1,5, 0,5,4, 2,3,7, 2,7,6,
    1,2,6, 1,6,5, 0,4,7, 0,7,3,
  ],
};

await mock.module("../../frontend/src/js/engine/state.js", () => ({
  state: { get scene() { return { meshes: state.meshes }; } },
}));

beforeAll(async () => {
  mod = await import("../../frontend/src/js/ui/printability.js");
  bus = await import("@arbesk/asset-core/events/bus.js");
});

beforeEach(() => {
  state.cid = "bafyA";
  state.meshes = [];
  document.body.innerHTML = `
    <button id="printCheckBtn" hidden></button>
    <span id="printBadge" hidden></span>`;
  mod.initPrintability();
});

test("cube scene → Print-ready badge", () => {
  state.meshes = [CUBE];
  document.getElementById("printCheckBtn").click();
  const badge = document.getElementById("printBadge");
  expect(badge.hidden).toBe(false);
  expect(badge.textContent).toBe("Print-ready");
  expect(badge.classList.contains("print-badge-ok")).toBe(true);
});

test("open scene → Not watertight with open-edge count", () => {
  state.meshes = [{
    metadata: {},
    getVerticesData: () => [0,0,0, 1,0,0, 1,1,0, 0,1,0],
    getIndices: () => [0,1,2, 0,2,3],
  }];
  document.getElementById("printCheckBtn").click();
  const badge = document.getElementById("printBadge");
  expect(badge.textContent).toBe("Not watertight · 4 open edges");
  expect(badge.classList.contains("print-badge-warn")).toBe(true);
});

test("badge resets when the scene clears and button hides with no asset", () => {
  state.meshes = [CUBE];
  document.getElementById("printCheckBtn").click();
  expect(document.getElementById("printBadge").hidden).toBe(false);
  bus.emit(bus.EVENTS.SCENE_CLEARED, {});
  expect(document.getElementById("printBadge").hidden).toBe(true);
  state.cid = null;
  bus.emit(bus.EVENTS.ASSET_STATE_CHANGED, {});
  expect(document.getElementById("printCheckBtn").hidden).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun scripts/run-tests.mjs test/frontend/printability-ui.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3a: Implement `ui/printability.ts`**

```ts
/**
 * On-demand printability check in Properties → Metadata.
 * @remarks Runs the pure edge analysis over the scene's renderable meshes
 *   (in-memory Babylon vertex data — no IPFS reads). The verdict is cached
 *   per manifest CID for the session only; nothing enters the manifest.
 *   In-scene edits never change topology (colour/scale/placement only), so a
 *   cached verdict stays true for its CID.
 */
import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { getAssetState } from "@arbesk/asset-core/domain/asset.js";
import { analyzePrintability } from "../utils/printability.ts";
import type { MeshGeometry, PrintabilityReport } from "../utils/printability.ts";
import { getRenderableMeshes } from "../engine/transforms.ts";
import { state as engineState } from "../engine/state.ts";
import { showToast } from "./toasts.ts";

const cache = new Map<string, PrintabilityReport>();

function btn(): HTMLButtonElement | null {
  return document.getElementById("printCheckBtn") as HTMLButtonElement | null;
}
function badge(): HTMLElement | null {
  return document.getElementById("printBadge");
}

/**
 * Pull positions/indices from the live scene.
 * @remarks The only Babylon-touching function in the module: `state.scene`
 *   is null until the engine boots. `"position"` is the literal value of
 *   Babylon's `VertexBuffer.PositionKind`, so the CDN global is never named.
 */
function collectGeometry(): MeshGeometry[] {
  const scene = engineState.scene;
  if (!scene) return [];
  return getRenderableMeshes(scene.meshes)
    .filter((m: any) => !m.metadata?.isViewportChrome)
    .map((m: any) => ({
      positions: m.getVerticesData("position"),
      indices: m.getIndices() ?? [],
    }))
    .filter((g: MeshGeometry) => g.positions && g.indices.length > 0);
}

function renderBadge(report: PrintabilityReport | null): void {
  const b = badge();
  if (!b) return;
  if (!report) {
    b.hidden = true;
    b.textContent = "";
    return;
  }
  b.hidden = false;
  b.classList.toggle("print-badge-ok", report.manifold);
  b.classList.toggle("print-badge-warn", !report.manifold);
  b.textContent = report.manifold
    ? "Print-ready"
    : `Not watertight · ${report.openEdges} open edges`;
}

function syncVisibility(): void {
  const hasAsset = !!getAssetState().activeAssetManifestCid;
  const b = btn();
  if (b) b.hidden = !hasAsset;
  const cid = getAssetState().activeAssetManifestCid;
  renderBadge((cid && cache.get(cid)) || null);
}

function runCheck(): void {
  const cid = getAssetState().activeAssetManifestCid;
  if (!cid) return;
  const report = analyzePrintability(collectGeometry());
  cache.set(cid, report);
  renderBadge(report);
  showToast({
    type: report.manifold ? "success" : "warning",
    title: report.manifold ? "Print-ready" : "Not watertight",
    message: report.manifold
      ? `${report.triangleCount.toLocaleString("en-US")} triangles, fully closed.`
      : `${report.openEdges} open edges across ${report.triangleCount.toLocaleString("en-US")} triangles.`,
  });
}

export function initPrintability(): void {
  btn()?.addEventListener("click", runCheck);
  on(EVENTS.ASSET_STATE_CHANGED, syncVisibility);
  on(EVENTS.SCENE_CLEARED, () => {
    cache.clear();
    renderBadge(null);
    syncVisibility();
  });
  syncVisibility();
}
```

- [ ] **Step 3b: Pug — button + badge in the Auto-detected block**

In `studio-main.pug`, inside the "Auto-detected" `<details>` after `#metadataComputedList`:

```pug
        div
          dl#metadataComputedList.metadata-list
          .metadata-print
            button#printCheckBtn.btn.btn-secondary.btn-sm(type="button" hidden) Check printability
            span#printBadge.print-badge(hidden aria-live="polite")
```

- [ ] **Step 3c: SCSS** (append to `_metadata-editor.scss`)

```scss
.metadata-print {
  display: flex;
  align-items: center;
  gap: var(--size-2);
  margin-top: var(--size-2);
}

.print-badge {
  font-size: var(--font-size-0);
  font-weight: var(--font-weight-6);
  padding: 1px var(--size-2);
  border-radius: var(--radius-round);

  &.print-badge-ok {
    color: var(--success);
    background: color-mix(in srgb, var(--success) 12%, transparent);
  }

  &.print-badge-warn {
    color: var(--warning);
    background: color-mix(in srgb, var(--warning) 12%, transparent);
  }
}
```

Both text pairs use `color-mix()` tints → add them to `DERIVED_TEXT_PAIRS` in `test/frontend/theme-contrast.test.js` (follow the existing entries' shape; foreground `--success`/`--warning`, background the 12% tint over the section background token used by the inspector — check what token that is and use it).

- [ ] **Step 3d: Wire init**

In `app-init.ts`, next to the other `init*` UI calls: `initPrintability();` (import from `./ui/printability.ts`).

- [ ] **Step 4: Build + tests**

Run: `cd frontend && bun run build && cd .. && bun scripts/run-tests.mjs test/frontend/printability-ui.test.js test/frontend/printability.test.js test/frontend/theme-contrast.test.js test/frontend/style-guards.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src test/frontend/printability-ui.test.js test/frontend/theme-contrast.test.js
git commit -m "feat(inspector): on-demand printability check with session badge"
```

---
### Task 6: Status-bar readout

**Files:**
- Create: `frontend/src/js/ui/bottombar-info.ts`
- Modify: `frontend/src/pug/includes/bottombar.pug`
- Modify: `frontend/src/js/app-init.ts` (call `initBottombarInfo()`)
- Test: `test/frontend/bottombar-info.test.js`

**Interfaces:**
- Consumes: `formatDimensions`, `formatCountCompact`, `readUnits` (Task 1); `getAssetState`, `getCurrentManifest` from `@arbesk/asset-core/domain/asset.js`; `getPendingAnnotations` from `services/asset-save/annotations.ts`; bus `on`/`EVENTS`.
- Produces: `initBottombarInfo(): void`; `#bottomBarAssetInfo` (`.bottombar-status-item.tabular`, hidden by default).

- [ ] **Step 1: Write the failing test**

Create `test/frontend/bottombar-info.test.js` (`// @test-env dom` first line; mock the asset domain module like Task 5 does):

```js
// @test-env dom
import { beforeAll, beforeEach, expect, mock, test } from "bun:test";

const state = { manifest: null, cid: null };
const annotations = { pending: null };

await mock.module("@arbesk/asset-core/domain/asset.js", () => ({
  getAssetState: () => ({ activeAssetManifestCid: state.cid }),
  getCurrentManifest: () => state.manifest,
}));
await mock.module(
  "../../frontend/src/js/services/asset-save/annotations.js",
  () => ({ getPendingAnnotations: () => annotations.pending })
);

let mod, bus;

beforeAll(async () => {
  mod = await import("../../frontend/src/js/ui/bottombar-info.js");
  bus = await import("@arbesk/asset-core/events/bus.js");
});

beforeEach(() => {
  state.manifest = null;
  state.cid = null;
  annotations.pending = null;
  document.body.innerHTML =
    '<span id="bottomBarAssetInfo" class="bottombar-status-item tabular" hidden></span>';
  mod.initBottombarInfo();
});

const el = () => document.getElementById("bottomBarAssetInfo");

function withAsset(manifest, pending = null) {
  state.cid = "bafyX";
  state.manifest = manifest;
  annotations.pending = pending;
  bus.emit(bus.EVENTS.ASSET_STATE_CHANGED, {});
}

test("hidden with no asset / no computed facts", () => {
  bus.emit(bus.EVENTS.ASSET_STATE_CHANGED, {});
  expect(el().hidden).toBe(true);
  withAsset({ metadata: {} });
  expect(el().hidden).toBe(true);
});

test("shows unit-aware dimensions and compact triangles", () => {
  withAsset({
    metadata: {
      computed: {
        dimensions: { width: 1.845, height: 0.62, depth: 0.5499, unit: "meters" },
        triangle_count: 12400,
      },
      annotations: {},
    },
  });
  expect(el().hidden).toBe(false);
  expect(el().textContent).toBe("1.85 × 0.62 × 0.55 m · 12.4k tris");
});

test("pending units annotation flips the display to mm", () => {
  withAsset(
    {
      metadata: {
        computed: {
          dimensions: { width: 0.085, height: 0.054, depth: 0.012, unit: "meters" },
          triangle_count: 500,
        },
        annotations: {},
      },
    },
    { units: "mm" }
  );
  expect(el().textContent).toBe("85 × 54 × 12 mm · 500 tris");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun scripts/run-tests.mjs test/frontend/bottombar-info.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3a: Implement `ui/bottombar-info.ts`**

```ts
/**
 * Bottom-bar asset facts: unit-aware dimensions + triangle count.
 * @remarks Renders from the baked `metadata.computed` (no recompute); the
 *   units annotation (pending edits win) drives display. Hidden for drafts
 *   that have never been saved.
 */
import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { getAssetState, getCurrentManifest } from "@arbesk/asset-core/domain/asset.js";
import { getPendingAnnotations } from "../services/asset-save/annotations.ts";
import { formatCountCompact, formatDimensions, readUnits } from "../utils/units.ts";

function render(): void {
  const el = document.getElementById("bottomBarAssetInfo");
  if (!el) return;
  const hasAsset = !!getAssetState().activeAssetManifestCid;
  const computed = (getCurrentManifest() as any)?.metadata?.computed;
  const dims = computed?.dimensions;
  const tris = computed?.triangle_count;
  if (!hasAsset || !dims || typeof tris !== "number") {
    el.hidden = true;
    return;
  }
  const manifest = getCurrentManifest() as any;
  const annotations =
    getPendingAnnotations() ?? manifest?.metadata?.annotations ?? {};
  el.textContent =
    `${formatDimensions(dims, readUnits(annotations))} · ` +
    `${formatCountCompact(tris)} tris`;
  el.hidden = false;
}

export function initBottombarInfo(): void {
  on(EVENTS.ASSET_STATE_CHANGED, render);
  on(EVENTS.SCENE_CLEARED, render);
  render();
}
```

- [ ] **Step 3b: Pug**

In `bottombar.pug`, after `span#bottomBarSelection…`:

```pug
    span#bottomBarAssetInfo.bottombar-status-item.tabular(hidden)
```

- [ ] **Step 3c: Wire init**

In `app-init.ts`, next to the other `init*` UI calls: `initBottombarInfo();` (import from `./ui/bottombar-info.ts`).

- [ ] **Step 4: Build + tests**

Run: `cd frontend && bun run build && cd .. && bun scripts/run-tests.mjs test/frontend/bottombar-info.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src test/frontend/bottombar-info.test.js
git commit -m "feat(bottombar): unit-aware dimensions + triangle count readout"
```

---
### Task 7: E2E sync + new assertions

**Files:**
- Modify: `e2e/helpers/studio-selectors.mjs`
- Modify: `e2e/specs/21-metadata-computed.spec.js`
- Modify: `e2e/README.md` (spec 21 section, if it mentions removed chips)

**Interfaces:**
- Consumes: everything from Tasks 1–6; existing helpers `connectStudio`, `generateToChatBubble`, `saveDraft`, `openInspector` (check it exists in `flows.mjs` — the Phase 2 plan referenced it; if missing, click the Inspector affordance the rail uses).
- Produces: selectors `printCheckBtn: "#printCheckBtn"`, `printBadge: "#printBadge"`, `bottomBarAssetInfo: "#bottomBarAssetInfo"`, `metaLicence: "#metaLicence"`, `metaUnits: "#metaUnits"`.

- [ ] **Step 1: Selectors**

Add to `e2e/helpers/studio-selectors.mjs`, in the metadata section block:

```js
  // Print & Provenance typed fields + printability
  metaLicence: "#metaLicence",
  metaUnits: "#metaUnits",
  printCheckBtn: "#printCheckBtn",
  printBadge: "#printBadge",
  bottomBarAssetInfo: "#bottomBarAssetInfo",
```

- [ ] **Step 2: Extend spec 21**

Append to `e2e/specs/21-metadata-computed.spec.js` inside the describe block. First check whether the E2E stack enables CAD mock generation (`grep -rn "CAD_MOCK" e2e/`); if it does, add the CAD test, otherwise keep it glTF-only:

```js
test("status bar shows unit-aware facts after save", async ({ page }) => {
  await connectStudio(page);
  const send = await generateToChatBubble(page, "cowboy");
  await send.click();
  await page.waitForURL(MANIFEST_URL_REGEX);
  await expect(page.locator(SELECTORS.assetBubbleSaved)).toHaveCount(1);

  // Mock glTF stats are meter-scale — the readout appears with an m suffix.
  await expect(page.locator(SELECTORS.bottomBarAssetInfo)).toBeVisible();
  await expect(page.locator(SELECTORS.bottomBarAssetInfo)).toContainText("m ·");
  await expect(page.locator(SELECTORS.bottomBarAssetInfo)).toContainText("tris");
});

test("printability check badges the mock model as print-ready", async ({ page }) => {
  await connectStudio(page);
  const send = await generateToChatBubble(page, "cowboy");
  await send.click();
  await page.waitForURL(MANIFEST_URL_REGEX);

  // Metadata section lives in Properties; open it if the inspector is hidden.
  const checkBtn = page.locator(SELECTORS.printCheckBtn);
  if (!(await checkBtn.isVisible())) await openInspector(page);
  await checkBtn.click();
  await expect(page.locator(SELECTORS.printBadge)).toHaveText("Print-ready");
});

test("typed metadata fields persist across save and reopen", async ({ page }) => {
  await connectStudio(page);
  const send = await generateToChatBubble(page, "cowboy");
  await send.click();
  await page.waitForURL(MANIFEST_URL_REGEX);
  await expect(page.locator(SELECTORS.assetBubbleSaved)).toHaveCount(1);

  const licence = page.locator(SELECTORS.metaLicence);
  if (!(await licence.isVisible())) await openInspector(page);
  await licence.fill("CC-BY-4.0");
  await page.locator(SELECTORS.metaUnits).selectOption("mm");

  await saveDraft(page, manifestCidFromUrl(page.url()));
  await page.reload();
  await page.waitForURL(MANIFEST_URL_REGEX);
  await expect(page.locator(SELECTORS.metaLicence)).toHaveValue("CC-BY-4.0");
  await expect(page.locator(SELECTORS.metaUnits)).toHaveValue("mm");
});
```

Notes for the implementer:
- The mock GLB (`mock-gltf-assets/`) is a closed box — expect `Print-ready`. If the pipeline's composed scene includes a ground/grid mesh that leaks into the analysis, the badge will read otherwise; that indicates `isViewportChrome` filtering is incomplete, not a wrong expectation.
- `saveDraft(page, prevCid)` in `flows.mjs` waits for the URL to flip — reuse it as-is.
- `openInspector(page)`: `grep -n "openInspector" e2e/helpers/flows.mjs` — if absent, the inspector toggle selector lives in `studio-selectors.mjs`; add the helper to `flows.mjs` next to `openCreate`.

- [ ] **Step 3: Run the affected specs**

Run: `bun run test:e2e -- --project=chromium e2e/specs/21-metadata-computed.spec.js`
Expected: PASS.

- [ ] **Step 4: Full E2E**

Run: `bun run test:e2e -- --project=chromium`
Expected: all green (57 + new tests). Known pre-existing order flakes on `main`: `18-chat-provenance`, `25-public-profile` — if only those fail, re-run them solo to confirm flakiness before investigating.

After the run: `git checkout -- blockchain/deployments`.

- [ ] **Step 5: Commit**

```bash
git add e2e
git commit -m "test(e2e): asset info readouts — status bar, printability, typed metadata"
```

---
### Task 8: Docs + full verification

**Files:**
- Modify: `docs/CURRENT_STATUS.md` (feature snapshot table)
- Modify: `docs/superpowers/specs/2026-10-04-ui-refresh-roadmap.md` (Phase 3 row)

- [ ] **Step 1: CURRENT_STATUS**

Add a feature-snapshot row after the Phase 2 row:

```markdown
| Asset Info Readouts (UI refresh Phase 3) | ✅ Complete | Unit-aware dimensions + triangle count in the status bar (`ui/bottombar-info.ts`, `utils/units.ts`); on-demand printability badge (`ui/printability.ts` + pure `utils/printability.ts` edge analysis, session-cached, never baked); CAD kernel stats (`metadata.cad.stats`) give 3MF roots real mm dimensions via `computeAssetStats`; "Print & Provenance" typed metadata fields (licence/material/units/print notes/source) over `metadata.annotations`. |
```

- [ ] **Step 2: Roadmap**

In `docs/superpowers/specs/2026-10-04-ui-refresh-roadmap.md`, Phase 3 row: replace `to write` with `` `2026-10-04-asset-info-readouts-design.md` — **done** ``.

- [ ] **Step 3: Full verification**

```bash
bun run test:frontend            # failing-file set must equal the 19-file baseline (compare sets, not totals)
npx tsc --noEmit -p frontend/tsconfig.json
npx eslint frontend/src/js/utils/units.ts frontend/src/js/utils/printability.ts frontend/src/js/ui/printability.ts frontend/src/js/ui/bottombar-info.ts frontend/src/js/ui/metadata-editor.ts
bun run test:e2e -- --project=chromium
```

- [ ] **Step 4: Commit**

```bash
git add docs
git commit -m "docs: asset info readouts status; Phase 3 row links spec"
```

- [ ] **Step 5: Push + PR**

```bash
git push -u origin feat/asset-info-readouts
gh pr create --base main --head feat/asset-info-readouts \
  --title "feat: asset info readouts — units, printability badge, Print & Provenance" \
  --body "…"   # what / spec link / verification incl. E2E result / 🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Closes #84. Merge with `gh pr merge --merge` after approval.

---

## Dependency map

```
Task 1 (units) ──────┬──────────────► Task 4 (metadata section)
                     └──────────────► Task 6 (status bar)
Task 2 (printability pure) ─────────► Task 5 (printability UI)
Task 3 (CAD stats) ────────────────► Task 6 (mm readouts end-to-end)
Tasks 1–6 ─────────────────────────► Task 7 (E2E) ──► Task 8 (docs)
```
