# Semantic Asset Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add AI-readable semantic metadata to Arbesk asset + collection manifests: a deterministic system-computed map (model facts) and a free-form user/agent annotations map, with Studio/Library/MCP/CLI read+write surfaces.

**Architecture:** Two disjoint namespaces under the existing manifest metadata object — "computed" (pure, deterministic, recomputed every save) and "annotations" (free-form, carried forward). Extraction is a pure asset-core function over parsed glTF JSON, invoked client-side in the save path. Read/write surfaces share one besk metadata module for CLI↔MCP parity.

**Tech Stack:** TypeScript (erasable-only), zod, jest (TDD), @arbesk/asset-core SDK, Alpine/Pug/SCSS frontend, besk CLI + MCP (stdio).

**Spec:** docs/superpowers/specs/2026-08-30-semantic-asset-metadata-design.md

## Global Constraints

- Erasable TypeScript only: no enums/namespaces/parameter properties; use "import type" for type-only imports; relative imports inside packages/asset-core/src and src/ carry .ts extensions.
- Frontend import specifiers match the on-disk file (.ts for TS modules); SDK consumed by bare specifier with .js subpath (e.g. @arbesk/asset-core/formats/gltf/model-stats.js).
- "computed" is deterministic-only: no heuristics, no guessing (humanoid is an annotation, not computed). Every computed field is optional and omitted when a format cannot derive it.
- glTF units are meters (dimensions.unit = "meters").
- No new on-chain state; metadata is IPFS-only inside the existing manifest chain.
- CLI↔MCP parity is mandatory: every new MCP tool ships with a matching besk subcommand in the same change and vice versa.
- Backend log prefixes [TAG]; save-path logs use [SAVE]; console.error for exceptions only.
- Tests: TDD (write failing test first). asset-core changes need "npm run build:packages" before typecheck; jest maps @arbesk/*.js and frontend .js specifiers to .ts source, so tests run without a build.

---

## File Structure

- packages/asset-core/src/manifest/schema.ts — zod schema: add computedMetadataSchema + extend metadata.
- packages/asset-core/src/formats/gltf/model-stats.ts — NEW: computeModelStats pure extractor (reuses bounds.ts).
- packages/asset-core/src/manifest/utils.ts — already re-exports manifestSchema + validateManifest (no change).
- frontend/src/js/services/asset-save/metadata-extract.ts — NEW: computeAssetStats (fetch + parse source, call computeModelStats).
- frontend/src/js/services/asset-save/manifest-builder.ts — call computeAssetStats + bake pending annotations.
- frontend/src/js/services/asset-save/annotations.ts — NEW: pending-annotations store (get/set/clear).
- packages/besk/src/metadata.ts — NEW: shared CLI/MCP metadata operations (pure helpers + read/write ops).
- packages/besk/src/catalog.ts — add readAnnotations/writeAnnotations re-export helper (or reuse metadata.ts).
- packages/besk/src/mcp.ts — 6 new tools + asset_info enrichment.
- packages/besk/src/cli.ts — metadata + collection-meta commands.
- frontend/src/pug/includes/studio-main.pug — Inspector Metadata section.
- frontend/src/js/ui/metadata-editor.ts — NEW: Inspector metadata editor (computed read-only + annotations editor).
- frontend/src/pug/includes/library-view.pug — Library details Metadata section.
- frontend/src/js/ui/library-details.ts — render collection/asset annotations; edit collection annotations.
- frontend/src/js/ui/library-context-menu.ts — "Edit metadata…" action.

---

### Task 1: Manifest schema — add computed + annotations

**Files:**
- Modify: packages/asset-core/src/manifest/schema.ts
- Test: test/frontend/asset-core-manifest.test.js

**Interfaces:**
- Produces: manifestSchema.metadata now accepts "annotations" (z.record(z.unknown()).optional()) and "computed" (computedMetadataSchema.passthrough().optional()). Used by every later task via validateManifest / getManifest.

- [ ] **Step 1: Write the failing test**

Append to test/frontend/asset-core-manifest.test.js inside the existing describe block:

~~~js
  test("validateManifest preserves metadata.computed and metadata.annotations", () => {
    const m = {
      version: 1,
      metadata: {
        computed: { format: "glb", triangle_count: 10 },
        annotations: { character_name: "Knight", tags: ["hero"] },
      },
    };
    const r = validateManifest(m);
    expect(r.valid).toBe(true);
    expect(r.data.metadata.computed.format).toBe("glb");
    expect(r.data.metadata.computed.triangle_count).toBe(10);
    expect(r.data.metadata.annotations.character_name).toBe("Knight");
  });
~~~

- [ ] **Step 2: Run test to verify it fails**

Run: npx jest test/frontend/asset-core-manifest.test.js -t "preserves metadata.computed"
Expected: FAIL — r.data.metadata.computed is undefined (zod strips unknown keys).

- [ ] **Step 3: Implement schema**

In packages/asset-core/src/manifest/schema.ts, insert before "export const manifestSchema":

~~~ts
// System-computed model facts (deterministic only — no heuristics). Every
// field optional: a format that cannot derive a field simply omits it.
const computedMetadataSchema = z.object({
  format: z.enum(["glb", "gltf", "3mf"]).optional(),
  dimensions: z
    .object({
      width: z.number(),
      height: z.number(),
      depth: z.number(),
      unit: z.string().optional(),
    })
    .optional(),
  bounds: z
    .object({
      min: z.array(z.number()).length(3),
      max: z.array(z.number()).length(3),
    })
    .optional(),
  center: z.array(z.number()).length(3).optional(),
  origin: z.array(z.number()).length(3).optional(),
  animation_clips: z.array(z.string()).optional(),
  triangle_count: z.number().int().nonnegative().optional(),
  vertex_count: z.number().int().nonnegative().optional(),
  mesh_count: z.number().int().nonnegative().optional(),
  node_count: z.number().int().nonnegative().optional(),
  material_count: z.number().int().nonnegative().optional(),
  texture_count: z.number().int().nonnegative().optional(),
  rigged: z.boolean().optional(),
  bone_count: z.number().int().nonnegative().optional(),
});
~~~

Then replace the metadata field inside manifestSchema with:

~~~ts
  metadata: z
    .object({
      chat: z.array(chatProvenanceEntrySchema).optional(),
      annotations: z.record(z.unknown()).optional(),
      computed: computedMetadataSchema.passthrough().optional(),
    })
    .optional(),
~~~

- [ ] **Step 4: Run test to verify it passes**

Run: npx jest test/frontend/asset-core-manifest.test.js -t "preserves metadata.computed"
Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add packages/asset-core/src/manifest/schema.ts test/frontend/asset-core-manifest.test.js
git commit -m "feat(asset-core): add computed + annotations to manifest metadata schema"
~~~

---

### Task 2: computeModelStats extractor

**Files:**
- Create: packages/asset-core/src/formats/gltf/model-stats.ts
- Test: test/asset-core-model-stats.test.js

**Interfaces:**
- Produces: export function computeModelStats(gltfJson: any, opts?: { format?: "glb" | "gltf" | "3mf" }): ComputedMetadata — pure, over parsed glTF JSON; reuses computeGltfBounds from ./bounds.ts. ComputedMetadata has optional fields: format, dimensions {width,height,depth,unit}, bounds {min,max}, center, origin, animation_clips, triangle_count, vertex_count, mesh_count, node_count, material_count, texture_count, rigged, bone_count.
- Consumes: computeGltfBounds (existing, ./bounds.ts).

- [ ] **Step 1: Write the failing test**

Create test/asset-core-model-stats.test.js:

~~~js
import { jest } from "@jest/globals";

const { computeModelStats } = await import(
  "../packages/asset-core/src/formats/gltf/model-stats.ts"
);

describe("computeModelStats", () => {
  test("extracts bounds, dimensions, center, origin, counts, clips, rig", () => {
    const gltf = {
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ translation: [1, 2, 3] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [
        { count: 6, min: [0, 0, 0], max: [2, 4, 6] },
        { count: 6 },
      ],
      materials: [{}, {}],
      textures: [{}],
      animations: [{ name: "walk" }, {}],
      skins: [{ joints: [0, 1] }, { joints: [1, 2] }],
    };
    const s = computeModelStats(gltf, { format: "gltf" });
    expect(s.format).toBe("gltf");
    expect(s.dimensions).toEqual({ width: 2, height: 4, depth: 6, unit: "meters" });
    expect(s.bounds).toEqual({ min: [0, 0, 0], max: [2, 4, 6] });
    expect(s.center).toEqual([1, 2, 3]);
    expect(s.origin).toEqual([1, 2, 3]);
    expect(s.animation_clips).toEqual(["walk", "clip_1"]);
    expect(s.triangle_count).toBe(2);
    expect(s.vertex_count).toBe(6);
    expect(s.mesh_count).toBe(1);
    expect(s.material_count).toBe(2);
    expect(s.texture_count).toBe(1);
    expect(s.rigged).toBe(true);
    expect(s.bone_count).toBe(3);
  });

  test("omits bounds when there are no POSITION accessors", () => {
    const s = computeModelStats({ meshes: [{ primitives: [{}] }] }, { format: "glb" });
    expect(s.dimensions).toBeUndefined();
    expect(s.bounds).toBeUndefined();
    expect(s.center).toBeUndefined();
    expect(s.triangle_count).toBe(0);
  });

  test("3mf omits glTF-only fields", () => {
    const s = computeModelStats({}, { format: "3mf" });
    expect(s.format).toBe("3mf");
    expect(s.animation_clips).toBeUndefined();
    expect(s.origin).toBeUndefined();
    expect(s.rigged).toBeUndefined();
  });
});
~~~

- [ ] **Step 2: Run test to verify it fails**

Run: npx jest test/asset-core-model-stats.test.js
Expected: FAIL — Cannot find module ".../model-stats.ts".

- [ ] **Step 3: Implement the extractor**

Create packages/asset-core/src/formats/gltf/model-stats.ts:

~~~ts
/**
 * Deterministic model facts extracted from parsed glTF 2.0 JSON.
 * Pure functions — no buffer reads; counts come from accessor/mesh metadata.
 * No heuristics: only values derivable with exact accuracy are computed.
 */
import { computeGltfBounds } from "./bounds.ts";
import type { GltfBounds } from "./bounds.ts";

export interface ComputedDimensions {
  width: number;
  height: number;
  depth: number;
  unit: string;
}

export interface ComputedMetadata {
  format?: "glb" | "gltf" | "3mf";
  dimensions?: ComputedDimensions;
  bounds?: { min: number[]; max: number[] };
  center?: number[];
  origin?: number[];
  animation_clips?: string[];
  triangle_count?: number;
  vertex_count?: number;
  mesh_count?: number;
  node_count?: number;
  material_count?: number;
  texture_count?: number;
  rigged?: boolean;
  bone_count?: number;
}

/** Root scene's first node translation, defaulting to [0,0,0]. */
function rootTranslation(gltf: any): number[] {
  const sceneIdx = gltf?.scene ?? 0;
  const rootNodeIdx = gltf?.scenes?.[sceneIdx]?.nodes?.[0];
  return gltf?.nodes?.[rootNodeIdx]?.translation ?? [0, 0, 0];
}

/** Sum of triangle counts across primitives (indexed → index.count/3, else POSITION.count/3). */
function triangleCount(gltf: any): number {
  let total = 0;
  for (const mesh of gltf?.meshes ?? []) {
    for (const prim of mesh?.primitives ?? []) {
      const idx = prim.indices;
      if (typeof idx === "number") {
        total += Math.floor((gltf.accessors?.[idx]?.count ?? 0) / 3);
      } else {
        const pos = prim.attributes?.POSITION;
        if (typeof pos === "number") {
          total += Math.floor((gltf.accessors?.[pos]?.count ?? 0) / 3);
        }
      }
    }
  }
  return total;
}

/** Sum of vertex counts across primitives (POSITION accessor count). */
function vertexCount(gltf: any): number {
  let total = 0;
  for (const mesh of gltf?.meshes ?? []) {
    for (const prim of mesh?.primitives ?? []) {
      const pos = prim.attributes?.POSITION;
      if (typeof pos === "number") total += gltf.accessors?.[pos]?.count ?? 0;
    }
  }
  return total;
}

/** Count of unique joint node indices across all skins. */
function boneCount(gltf: any): number {
  const joints = new Set<number>();
  for (const skin of gltf?.skins ?? []) {
    for (const j of skin?.joints ?? []) joints.add(j);
  }
  return joints.size;
}

/** glTF animations → clip names (unnamed get a stable "clip_<i>"). */
function animationClips(gltf: any): string[] {
  return (gltf?.animations ?? []).map((a: any, i: number) => a?.name || "clip_" + i);
}

export function computeModelStats(
  gltfJson: any,
  opts: { format?: "glb" | "gltf" | "3mf" } = {},
): ComputedMetadata {
  const format = opts.format ?? "gltf";
  const bounds: GltfBounds | null = computeGltfBounds(gltfJson);
  const stats: ComputedMetadata = { format };

  if (bounds) {
    stats.dimensions = {
      width: bounds.size[0],
      height: bounds.size[1],
      depth: bounds.size[2],
      unit: "meters",
    };
    stats.bounds = { min: bounds.min, max: bounds.max };
    stats.center = bounds.min.map((v, k) => (v + bounds.max[k]) / 2);
  }

  // 3MF has no glTF scenes/nodes/animations/skins — bounds + format only.
  if (format !== "3mf") {
    stats.origin = rootTranslation(gltfJson);
    stats.animation_clips = animationClips(gltfJson);
    stats.triangle_count = triangleCount(gltfJson);
    stats.vertex_count = vertexCount(gltfJson);
    stats.mesh_count = gltfJson?.meshes?.length ?? 0;
    stats.node_count = gltfJson?.nodes?.length ?? 0;
    stats.material_count = gltfJson?.materials?.length ?? 0;
    stats.texture_count = gltfJson?.textures?.length ?? 0;
    stats.rigged = (gltfJson?.skins?.length ?? 0) > 0;
    stats.bone_count = boneCount(gltfJson);
  }

  return stats;
}
~~~

- [ ] **Step 4: Run test to verify it passes**

Run: npx jest test/asset-core-model-stats.test.js
Expected: PASS (3 tests).

- [ ] **Step 5: Build + commit**

~~~bash
npm run build:packages
git add packages/asset-core/src/formats/gltf/model-stats.ts test/asset-core-model-stats.test.js
git commit -m "feat(asset-core): add deterministic computeModelStats extractor"
~~~

---

### Task 3: Save-path recompute computed + carry-forward

**Files:**
- Create: frontend/src/js/services/asset-save/metadata-extract.ts
- Modify: frontend/src/js/services/asset-save/manifest-builder.ts
- Test: test/frontend/asset-save-metadata.test.js

**Interfaces:**
- Produces: export async function computeAssetStats(manifest: any, readJson?: (cid: string) => Promise<any>): Promise<Record<string, any> | null>. readJson defaults to getFromRemoteIPFS; injected for tests.
- Consumes: computeModelStats from @arbesk/asset-core/formats/gltf/model-stats.js; getFromRemoteIPFS from ../../ipfs/remote-ipfs.ts; warn from ../../utils/log.ts.

- [ ] **Step 1: Write the failing test**

Create test/frontend/asset-save-metadata.test.js:

~~~js
/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";

const { computeAssetStats } = await import(
  "../../frontend/src/js/services/asset-save/metadata-extract.js"
);

describe("computeAssetStats", () => {
  test("extracts stats from the root source node's composite glTF JSON", async () => {
    const manifest = {
      scene: {
        nodes: [
          {
            node_id: "root",
            source: { cid: "bafyComposite", format: "gltf" },
          },
        ],
      },
    };
    const readJson = async () => ({
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [
        { count: 6, min: [0, 0, 0], max: [2, 4, 6] },
        { count: 6 },
      ],
      materials: [{}],
      textures: [],
      animations: [{ name: "idle" }],
      skins: [],
      nodes: [],
    });
    const stats = await computeAssetStats(manifest, readJson);
    expect(stats.format).toBe("gltf");
    expect(stats.dimensions).toEqual({ width: 2, height: 4, depth: 6, unit: "meters" });
    expect(stats.triangle_count).toBe(2);
  });

  test("returns format-only for 3mf sources", async () => {
    const manifest = {
      scene: { nodes: [{ node_id: "r", source: { cid: "x", format: "3mf" } }] },
    };
    const readJson = async () => { throw new Error("should not fetch"); };
    const stats = await computeAssetStats(manifest, readJson);
    expect(stats).toEqual({ format: "3mf" });
  });

  test("returns null when there is no root source node", async () => {
    const stats = await computeAssetStats({ scene: { nodes: [] } }, async () => ({}));
    expect(stats).toBeNull();
  });
});
~~~

- [ ] **Step 2: Run test to verify it fails**

Run: npx jest test/frontend/asset-save-metadata.test.js
Expected: FAIL — Cannot find module ".../metadata-extract.js".

- [ ] **Step 3: Implement computeAssetStats**

Create frontend/src/js/services/asset-save/metadata-extract.ts:

~~~ts
/**
 * Compute the "computed" metadata map for an asset manifest from its root
 * source node. Pure over the parsed composite glTF JSON (post-decompose the
 * source format is "gltf"); 3MF and other formats return format-only (all
 * computed fields are optional).
 */
import { getFromRemoteIPFS } from "../../ipfs/remote-ipfs.ts";
import { computeModelStats } from "@arbesk/asset-core/formats/gltf/model-stats.js";
import { warn } from "../../utils/log.ts";

export async function computeAssetStats(
  manifest: any,
  readJson: (cid: string) => Promise<any> = getFromRemoteIPFS,
): Promise<Record<string, any> | null> {
  const root = (manifest?.scene?.nodes ?? []).find(
    (n: any) => n.source?.cid && !n.child_ref,
  );
  if (!root?.source?.cid) return null;
  const { cid, format } = root.source;
  if (format === "3mf") return { format: "3mf" };
  if (format !== "gltf") return { format };
  try {
    const json = await readJson(cid);
    return computeModelStats(json, { format: "gltf" });
  } catch (err) {
    warn("[SAVE] metadata extraction failed | cid=" + cid + ":", (err as Error).message);
    return null;
  }
}
~~~

- [ ] **Step 4: Run test to verify it passes**

Run: npx jest test/frontend/asset-save-metadata.test.js
Expected: PASS (3 tests).

- [ ] **Step 5: Wire into the save path**

In frontend/src/js/services/asset-save/manifest-builder.ts:
1. Add import near the top:
~~~ts
import { computeAssetStats } from "./metadata-extract.ts";
~~~
2. In prepareManifestForWrite, after the decomposeManifestNodes block and before finalizeVersionAndChat, insert:
~~~ts
  // Recompute deterministic model facts (metadata.computed) from the root
  // source. Best-effort: a failure must never block the save.
  const computedStats = await computeAssetStats(manifest);
  if (computedStats) {
    manifest.metadata ||= {};
    manifest.metadata.computed = computedStats;
  }
~~~
3. Add a carry-forward test (Step 6) and verify existing save tests still pass.

- [ ] **Step 6: Add a carry-forward test**

Append to test/frontend/asset-save-metadata.test.js:

~~~js
  test("computeAssetStats does not disturb existing annotations (carry-forward)", async () => {
    const manifest = {
      metadata: { annotations: { character_name: "Knight" } },
      scene: { nodes: [{ node_id: "r", source: { cid: "bafy", format: "gltf" } }] },
    };
    const readJson = async () => ({ meshes: [], nodes: [], animations: [], skins: [] });
    await computeAssetStats(manifest, readJson);
    expect(manifest.metadata.annotations).toEqual({ character_name: "Knight" });
  });
~~~

This pins that extraction only sets metadata.computed and never clobbers annotations, so annotations carry forward version to version. (The full two-save carry-forward is covered by E2E in the final gate.)

- [ ] **Step 7: Run the full save suite**

Run: npx jest test/frontend/asset-save.test.js test/frontend/asset-save-metadata.test.js
Expected: PASS (no regressions; existing mocks still resolve — metadata-extract imports getFromRemoteIPFS, already mocked in the asset-save suite).

- [ ] **Step 8: Commit**

~~~bash
git add frontend/src/js/services/asset-save/metadata-extract.ts frontend/src/js/services/asset-save/manifest-builder.ts test/frontend/asset-save-metadata.test.js
git commit -m "feat(save): recompute metadata.computed on save"
~~~

---

### Task 4: Shared metadata module + read surfaces (MCP/CLI)

**Files:**
- Create: packages/besk/src/metadata.ts
- Modify: packages/besk/src/mcp.ts
- Modify: packages/besk/src/cli.ts

**Interfaces:**
- Produces (from packages/besk/src/metadata.ts): getComputed(manifest), getAnnotations(manifest), setAnnotations(manifest, patch), unsetAnnotations(manifest, keys), parseJsonValue(raw), patchFromPairs(keys, values), getAssetMetadata(session, cid), getCollectionMetadata(session, tokenId).
- Consumes: getManifest / getCollectionManifest / writeManifest / updateCollection from ./catalog.ts.

- [ ] **Step 1: Write the failing test**

Create test/asset-core-metadata-helpers.test.js (root, .ts-relative import like the glb-parser test):

~~~js
import { jest } from "@jest/globals";

const { setAnnotations, unsetAnnotations, getComputed, getAnnotations, parseJsonValue, patchFromPairs } =
  await import("../packages/besk/src/metadata.ts");

describe("metadata helpers", () => {
  test("setAnnotations merges into metadata.annotations", () => {
    const m = { metadata: { annotations: { a: 1 } } };
    setAnnotations(m, { b: 2, a: 3 });
    expect(m.metadata.annotations).toEqual({ a: 3, b: 2 });
  });
  test("unsetAnnotations deletes keys", () => {
    const m = { metadata: { annotations: { a: 1, b: 2 } } };
    unsetAnnotations(m, ["a"]);
    expect(m.metadata.annotations).toEqual({ b: 2 });
  });
  test("getComputed/getAnnotations default safely", () => {
    expect(getComputed({})).toBeNull();
    expect(getAnnotations({})).toEqual({});
  });
  test("parseJsonValue parses JSON, falls back to string", () => {
    expect(parseJsonValue("42")).toBe(42);
    expect(parseJsonValue('["a"]')).toEqual(["a"]);
    expect(parseJsonValue("plain")).toBe("plain");
  });
  test("patchFromPairs zips keys and values", () => {
    expect(patchFromPairs(["role", "tags"], ["hero", '["npc"]'])).toEqual({
      role: "hero",
      tags: ["npc"],
    });
  });
});
~~~

Note: packages/besk/src/metadata.ts imports ./catalog.ts (for the read/write ops). To keep the pure helpers importable in a plain jest run without the besk adapters, split the module: keep pure helpers at the top (no catalog import) and import catalog lazily inside the op functions via dynamic import. Use this split so the test above only pulls pure helpers.

- [ ] **Step 2: Run test to verify it fails**

Run: npx jest test/asset-core-metadata-helpers.test.js
Expected: FAIL — Cannot find module ".../metadata.ts".

- [ ] **Step 3: Implement metadata.ts**

Create packages/besk/src/metadata.ts:

~~~ts
/**
 * Shared CLI/MCP metadata operations. Pure helpers (no imports) + read/write
 * ops that reach catalog lazily so tests can import the pure half in isolation.
 */
import type { Session } from "./session.ts";

/* ---- pure helpers ---- */

export function parseJsonValue(raw: string): unknown {
  const t = raw.trim();
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

export function patchFromPairs(keys: string[], values: string[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const n = Math.min(keys.length, values.length);
  for (let i = 0; i < n; i++) patch[keys[i]] = parseJsonValue(values[i]);
  return patch;
}

export function getComputed(manifest: any): Record<string, unknown> | null {
  return (manifest?.metadata?.computed ?? null) as Record<string, unknown> | null;
}

export function getAnnotations(manifest: any): Record<string, unknown> {
  return (manifest?.metadata?.annotations ?? {}) as Record<string, unknown>;
}

export function setAnnotations(manifest: any, patch: Record<string, unknown>): void {
  manifest.metadata ??= {};
  manifest.metadata.annotations = { ...(manifest.metadata.annotations ?? {}), ...patch };
}

export function unsetAnnotations(manifest: any, keys: string[]): void {
  if (!manifest?.metadata?.annotations) return;
  for (const k of keys) delete manifest.metadata.annotations[k];
}

/* ---- read/write ops (lazy catalog import) ---- */

export async function getAssetMetadata(session: Session, cid: string) {
  const { getManifest } = await import("./catalog.ts");
  const m = (await getManifest(cid)) as Record<string, any>;
  return { computed: getComputed(m), annotations: getAnnotations(m) };
}

export async function getCollectionMetadata(session: Session, tokenId: string) {
  const { getCollectionManifest } = await import("./catalog.ts");
  const { manifest } = await getCollectionManifest(tokenId);
  return { annotations: getAnnotations(manifest) };
}

export async function setAssetMetadata(
  session: Session,
  tokenId: string,
  assetID: string,
  cid: string,
  patch: Record<string, unknown>,
): Promise<string> {
  const { getManifest, writeManifest, updateCollection } = await import("./catalog.ts");
  const m = (await getManifest(cid)) as Record<string, any>;
  setAnnotations(m, patch);
  const newCid = await writeManifest(m);
  await updateCollection(session, tokenId, (draft: Record<string, any>) => {
    draft.assets[assetID] = newCid;
  });
  return newCid;
}

export async function unsetAssetMetadata(
  session: Session,
  tokenId: string,
  assetID: string,
  cid: string,
  keys: string[],
): Promise<string> {
  const { getManifest, writeManifest, updateCollection } = await import("./catalog.ts");
  const m = (await getManifest(cid)) as Record<string, any>;
  unsetAnnotations(m, keys);
  const newCid = await writeManifest(m);
  await updateCollection(session, tokenId, (draft: Record<string, any>) => {
    draft.assets[assetID] = newCid;
  });
  return newCid;
}

export async function setCollectionMetadata(
  session: Session,
  tokenId: string,
  patch: Record<string, unknown>,
): Promise<string> {
  const { updateCollection } = await import("./catalog.ts");
  return updateCollection(session, tokenId, (draft: Record<string, any>) =>
    setAnnotations(draft, patch),
  );
}

export async function unsetCollectionMetadata(
  session: Session,
  tokenId: string,
  keys: string[],
): Promise<string> {
  const { updateCollection } = await import("./catalog.ts");
  return updateCollection(session, tokenId, (draft: Record<string, any>) =>
    unsetAnnotations(draft, keys),
  );
}
~~~

- [ ] **Step 4: Run test to verify it passes**

Run: npx jest test/asset-core-metadata-helpers.test.js
Expected: PASS (5 tests).

- [ ] **Step 5: Add MCP read handlers + asset_info enrichment**

In packages/besk/src/mcp.ts:
1. Add import:
~~~ts
import { getAssetMetadata, getCollectionMetadata } from "./metadata.ts";
~~~
2. Enrich hAssetInfo — add after "previous" in the returned object:
~~~ts
    computed: m?.metadata?.computed ?? null,
    annotations: m?.metadata?.annotations ?? {},
~~~
3. Add handlers:
~~~ts
async function hGetAssetMetadata(s: Session, args: Args): Promise<unknown> {
  const hit = await assetFor(s, args);
  return getAssetMetadata(s, hit.cid);
}

async function hGetCollectionMetadata(s: Session, args: Args): Promise<unknown> {
  return getCollectionMetadata(s, await tokenIdFor(s, args));
}
~~~
4. Register tools (add to TOOLS array before provider_balance):
~~~ts
  tool("get_asset_metadata", "Return an asset's computed facts and user/agent annotations.", { ...NAME, ...COLLECTION }, ["name"], hGetAssetMetadata),
  tool("get_collection_metadata", "Return a collection's user/agent annotations.", { ...COLLECTION }, [], hGetCollectionMetadata),
~~~

- [ ] **Step 6: Add CLI read commands (get only)**

In packages/besk/src/cli.ts:
1. Add import:
~~~ts
import { getAssetMetadata, getCollectionMetadata } from "./metadata.ts";
~~~
2. Add handlers:
~~~ts
async function cmdMetadataGet(name?: string): Promise<void> {
  const ctx = await requireNamedAsset(name, "Usage: besk metadata get <name>");
  if (!ctx) return;
  const meta = await getAssetMetadata(ctx.s, ctx.hit.cid);
  console.log(JSON.stringify(meta, null, 2));
}

async function cmdCollectionMetaGet(): Promise<void> {
  const s = requireSession();
  if (!s) return;
  const tokenId = await currentCollectionTokenId(s);
  const meta = await getCollectionMetadata(s, tokenId);
  console.log(JSON.stringify(meta, null, 2));
}
~~~
3. Add read-only dispatchers (set/unset are added in Task 5):
~~~ts
async function cmdMetadata(argv: string[]): Promise<void> {
  const sub = argv[0];
  if (sub === "get") return cmdMetadataGet(argv[1]);
  console.error("Usage: besk metadata get <name>");
  process.exitCode = 2;
}

async function cmdCollectionMeta(argv: string[]): Promise<void> {
  const sub = argv[0];
  if (sub === "get") return cmdCollectionMetaGet();
  console.error("Usage: besk collection-meta get");
  process.exitCode = 2;
}
~~~
4. Register in COMMANDS:
~~~ts
  metadata: () => cmdMetadata(args.slice(1)),
  "collection-meta": () => cmdCollectionMeta(args.slice(1)),
~~~
5. Update help() with the read commands:
~~~ts
  console.log("  metadata get <name>   show an asset's computed facts + annotations");
  console.log("  collection-meta get   show the active collection's annotations");
~~~

- [ ] **Step 7: Typecheck + commit**

~~~bash
npm run typecheck
git add packages/besk/src/metadata.ts packages/besk/src/mcp.ts packages/besk/src/cli.ts test/asset-core-metadata-helpers.test.js
git commit -m "feat(besk): metadata read tools (MCP + CLI) with asset_info enrichment"
~~~

---

### Task 5: Write surfaces (MCP + CLI set/unset)

**Files:**
- Modify: packages/besk/src/mcp.ts
- Modify: packages/besk/src/cli.ts
- Test: test/asset-core-metadata-helpers.test.js (pure helpers already covered) — add a thin MCP handler test if the harness allows (see Step 4).

**Interfaces:**
- Consumes: setAssetMetadata / unsetAssetMetadata / setCollectionMetadata / unsetCollectionMetadata from ./metadata.ts (Task 4).

- [ ] **Step 1: Add MCP write handlers**

In packages/besk/src/mcp.ts, add imports and handlers:
~~~ts
import {
  getAssetMetadata,
  getCollectionMetadata,
  setAssetMetadata,
  unsetAssetMetadata,
  setCollectionMetadata,
  unsetCollectionMetadata,
} from "./metadata.ts";

function requirePatch(args: Args): Record<string, unknown> {
  const p = args.patch;
  if (!p || typeof p !== "object" || Array.isArray(p)) {
    throw new Error("patch must be an object of key→value");
  }
  return p as Record<string, unknown>;
}

function requireKeys(args: Args): string[] {
  const keys = args.keys;
  if (!Array.isArray(keys) || keys.some((k) => typeof k !== "string" || !k)) {
    throw new Error("keys must be a non-empty array of strings");
  }
  return keys as string[];
}

async function hSetAssetMetadata(s: Session, args: Args): Promise<unknown> {
  const hit = await assetFor(s, args);
  const patch = requirePatch(args);
  const cid = await setAssetMetadata(s, hit.tokenId, hit.assetID, hit.cid, patch);
  return { set: Object.keys(patch), cid };
}

async function hDeleteAssetMetadata(s: Session, args: Args): Promise<unknown> {
  const hit = await assetFor(s, args);
  const keys = requireKeys(args);
  const cid = await unsetAssetMetadata(s, hit.tokenId, hit.assetID, hit.cid, keys);
  return { unset: keys, cid };
}

async function hSetCollectionMetadata(s: Session, args: Args): Promise<unknown> {
  const cid = await setCollectionMetadata(s, await tokenIdFor(s, args), requirePatch(args));
  return { set: Object.keys(requirePatch(args)), cid };
}

async function hDeleteCollectionMetadata(s: Session, args: Args): Promise<unknown> {
  const cid = await unsetCollectionMetadata(s, await tokenIdFor(s, args), requireKeys(args));
  return { unset: requireKeys(args), cid };
}
~~~

Register tools in TOOLS:
~~~ts
  tool("set_asset_metadata", "Merge key/value pairs into an asset's annotations (writes a new manifest version).", { ...NAME, patch: { type: "object", description: "key→value map to merge" }, ...COLLECTION }, ["name", "patch"], hSetAssetMetadata),
  tool("delete_asset_metadata", "Remove keys from an asset's annotations (writes a new manifest version).", { ...NAME, keys: { type: "array", items: { type: "string" }, description: "keys to remove" }, ...COLLECTION }, ["name", "keys"], hDeleteAssetMetadata),
  tool("set_collection_metadata", "Merge key/value pairs into a collection's annotations.", { patch: { type: "object", description: "key→value map to merge" }, ...COLLECTION }, ["patch"], hSetCollectionMetadata),
  tool("delete_collection_metadata", "Remove keys from a collection's annotations.", { keys: { type: "array", items: { type: "string" }, description: "keys to remove" }, ...COLLECTION }, ["keys"], hDeleteCollectionMetadata),
~~~

- [ ] **Step 2: Add CLI write commands**

In packages/besk/src/cli.ts, add the set/unset handlers referenced in Task 4 (and import the write ops):
~~~ts
import {
  getAssetMetadata, getCollectionMetadata,
  setAssetMetadata, unsetAssetMetadata,
  setCollectionMetadata, unsetCollectionMetadata,
  patchFromPairs,
} from "./metadata.ts";
~~~

~~~ts
function keyValueFlags(flags: Record<string, string[]>): { keys: string[]; values: string[] } {
  const keys = flags["--key"] ?? [];
  const values = flags["--value"] ?? [];
  if (keys.length === 0) return { keys: [], values: [] };
  if (values.length !== keys.length) {
    console.error("Every --key needs a matching --value.");
    process.exitCode = 2;
    return { keys: [], values: [] };
  }
  return { keys, values };
}

async function cmdMetadataSet(name?: string, rest?: string[]): Promise<void> {
  const ctx = await requireNamedAsset(name, "Usage: besk metadata set <name> --key k --value v [--key k2 --value v2 ...]");
  if (!ctx) return;
  const { flags } = parseFlags(rest ?? []);
  const { keys, values } = keyValueFlags(flags);
  if (keys.length === 0) return;
  const cid = await setAssetMetadata(ctx.s, ctx.tokenId, ctx.hit.assetID, ctx.hit.cid, patchFromPairs(keys, values));
  console.log("Set " + keys.join(", ") + " (cid " + cid + ")");
}

async function cmdMetadataUnset(name?: string, rest?: string[]): Promise<void> {
  const ctx = await requireNamedAsset(name, "Usage: besk metadata unset <name> --key k [--key k2 ...]");
  if (!ctx) return;
  const { flags } = parseFlags(rest ?? []);
  const keys = flags["--key"] ?? [];
  if (keys.length === 0) return;
  const cid = await unsetAssetMetadata(ctx.s, ctx.tokenId, ctx.hit.assetID, ctx.hit.cid, keys);
  console.log("Unset " + keys.join(", ") + " (cid " + cid + ")");
}

async function cmdCollectionMetaSet(rest: string[]): Promise<void> {
  const s = requireSession();
  if (!s) return;
  const { flags } = parseFlags(rest);
  const { keys, values } = keyValueFlags(flags);
  if (keys.length === 0) return;
  const tokenId = await currentCollectionTokenId(s);
  const cid = await setCollectionMetadata(s, tokenId, patchFromPairs(keys, values));
  console.log("Set " + keys.join(", ") + " (cid " + cid + ")");
}

async function cmdCollectionMetaUnset(rest: string[]): Promise<void> {
  const s = requireSession();
  if (!s) return;
  const { flags } = parseFlags(rest);
  const keys = flags["--key"] ?? [];
  if (keys.length === 0) return;
  const tokenId = await currentCollectionTokenId(s);
  const cid = await unsetCollectionMetadata(s, tokenId, keys);
  console.log("Unset " + keys.join(", ") + " (cid " + cid + ")");
}
~~~

- [ ] **Step 3: Extend the dispatchers + help**

Replace the Task 4 read-only dispatchers with the full versions:
~~~ts
async function cmdMetadata(argv: string[]): Promise<void> {
  const sub = argv[0];
  if (sub === "get") return cmdMetadataGet(argv[1]);
  if (sub === "set") return cmdMetadataSet(argv[1], argv.slice(2));
  if (sub === "unset") return cmdMetadataUnset(argv[1], argv.slice(2));
  console.error("Usage: besk metadata <get|set|unset> <name> ...");
  process.exitCode = 2;
}

async function cmdCollectionMeta(argv: string[]): Promise<void> {
  const sub = argv[0];
  if (sub === "get") return cmdCollectionMetaGet();
  if (sub === "set") return cmdCollectionMetaSet(argv.slice(1));
  if (sub === "unset") return cmdCollectionMetaUnset(argv.slice(1));
  console.error("Usage: besk collection-meta <get|set|unset> ...");
  process.exitCode = 2;
}
~~~

Update help() — replace the two read-only lines added in Task 4 with:
~~~ts
  console.log("  metadata get <name>      show an asset's computed facts + annotations");
  console.log("  metadata set <name> --key k --value v [...]   set asset annotations");
  console.log("  metadata unset <name> --key k [...]            remove asset annotations");
  console.log("  collection-meta get|set|unset                  active collection annotations");
~~~
COMMANDS registration is unchanged (Task 4 already wired metadata and collection-meta).

- [ ] **Step 4: Test**

Run: npx jest test/asset-core-metadata-helpers.test.js
Expected: PASS (pure helpers). The write ops are thin wrappers over updateCollection (already covered by asset-core collection-write tests); note in the commit that full write round-trip is covered by E2E (save→set→get via MCP).

- [ ] **Step 5: Typecheck + commit**

~~~bash
npm run typecheck
git add packages/besk/src/mcp.ts packages/besk/src/cli.ts
git commit -m "feat(besk): metadata write tools (MCP + CLI set/unset)"
~~~

---

### Task 6: Pending-annotations store + Studio Inspector editor

**Files:**
- Create: frontend/src/js/services/asset-save/annotations.ts
- Modify: frontend/src/js/services/asset-save/manifest-builder.ts
- Modify: frontend/src/pug/includes/studio-main.pug
- Create: frontend/src/js/ui/metadata-editor.ts
- Modify: frontend/src/js/app-init.ts (or the module that calls init functions — register initMetadataEditor)
- Test: test/frontend/metadata-editor.test.js

**Interfaces:**
- Produces (annotations.ts): getPendingAnnotations(): Record<string, unknown> | null; setPendingAnnotations(a: Record<string, unknown> | null): void; clearPendingAnnotations(): void.
- Produces (metadata-editor.ts): initMetadataEditor(): void; renders computed (read-only) + annotations (editable) into #metadataSection and writes edits to the pending store.
- Consumes: getAssetState from @arbesk/asset-core/domain/asset.js; on/EVENTS from @arbesk/asset-core/events/bus.js; getCurrentManifest from @arbesk/asset-core/domain/asset.js.

- [ ] **Step 1: Write the failing test for the pending store**

Create test/frontend/metadata-editor.test.js:

~~~js
/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";

const { getPendingAnnotations, setPendingAnnotations, clearPendingAnnotations } =
  await import("../../frontend/src/js/services/asset-save/annotations.js");

describe("pending annotations store", () => {
  beforeEach(() => clearPendingAnnotations());

  test("starts null and round-trips", () => {
    expect(getPendingAnnotations()).toBeNull();
    setPendingAnnotations({ character_name: "Knight" });
    expect(getPendingAnnotations()).toEqual({ character_name: "Knight" });
    clearPendingAnnotations();
    expect(getPendingAnnotations()).toBeNull();
  });
});
~~~

- [ ] **Step 2: Run test to verify it fails**

Run: npx jest test/frontend/metadata-editor.test.js
Expected: FAIL — Cannot find module ".../annotations.js".

- [ ] **Step 3: Implement the pending store**

Create frontend/src/js/services/asset-save/annotations.ts:

~~~ts
/**
 * Pending-annotations store for the Inspector metadata editor. Holds the FULL
 * annotations map (prior + edits); baked into the manifest on save.
 */
let pending: Record<string, unknown> | null = null;

export function getPendingAnnotations(): Record<string, unknown> | null {
  return pending;
}

export function setPendingAnnotations(a: Record<string, unknown> | null): void {
  pending = a;
}

export function clearPendingAnnotations(): void {
  pending = null;
}
~~~

- [ ] **Step 4: Run test to verify it passes**

Run: npx jest test/frontend/metadata-editor.test.js
Expected: PASS.

- [ ] **Step 5: Bake pending annotations in the save path**

In frontend/src/js/services/asset-save/manifest-builder.ts:
1. Import:
~~~ts
import { getPendingAnnotations, clearPendingAnnotations } from "./annotations.ts";
~~~
2. In prepareManifestForWrite, right before the computed-stats block (Task 3), insert:
~~~ts
  // Bake pending annotations (Inspector metadata editor) into the manifest.
  const pendingAnnotations = getPendingAnnotations();
  if (pendingAnnotations !== null) {
    manifest.metadata ||= {};
    manifest.metadata.annotations = pendingAnnotations;
  }
~~~
3. In saveAssetDraftCore, add clearPendingAnnotations() to BOTH the no-changes branch (next to the other clear* calls) and the success branch (next to clearPendingSourceOverrides()).

- [ ] **Step 6: Add the Inspector Pug section**

In frontend/src/pug/includes/studio-main.pug, insert between the parametricEditor section and the commentsSection:

~~~pug
    section#metadataSection.inspector-section.metadata-section(hidden)
      details(open)
        summary.inspector-section-title Metadata
        div
          .metadata-computed
            h6.metadata-block-title Auto-detected
            dl#metadataComputedList.metadata-list
          .metadata-annotations
            h6.metadata-block-title Notes for the AI
            #metadataAnnotationsList.metadata-kv
            .metadata-actions
              button#metadataAddBtn.btn.btn-secondary.btn-sm(type="button") + Add field
            .metadata-quick-add
              span.metadata-quick-label Quick add:
              button.metadata-chip(type="button" data-key="character_name") character_name
              button.metadata-chip(type="button" data-key="role") role
              button.metadata-chip(type="button" data-key="species") species
              button.metadata-chip(type="button" data-key="tags") tags
              button.metadata-chip(type="button" data-key="lore") lore
              button.metadata-chip(type="button" data-key="pivot") pivot
~~~

- [ ] **Step 7: Implement the editor**

Create frontend/src/js/ui/metadata-editor.ts:

~~~ts
/**
 * Inspector "Metadata" section: read-only computed facts + editable
 * annotations. Edits write to the pending-annotations store (persisted on
 * save). Renders on ASSET_STATE_CHANGED and SCENE_CLEARED.
 */
import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { getAssetState, getCurrentManifest } from "@arbesk/asset-core/domain/asset.js";
import { getPendingAnnotations, setPendingAnnotations, clearPendingAnnotations } from "../services/asset-save/annotations.ts";

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function readAnnotations(): Record<string, unknown> {
  return getPendingAnnotations() ?? (getCurrentManifest()?.metadata?.annotations as Record<string, unknown>) ?? {};
}

function writeAnnotations(a: Record<string, unknown>): void {
  setPendingAnnotations(a);
}

function renderComputed(computed: Record<string, unknown> | null | undefined): void {
  const list = el("metadataComputedList");
  if (!list) return;
  list.textContent = "";
  if (!computed || Object.keys(computed).length === 0) {
    const empty = document.createElement("div");
    empty.className = "metadata-empty";
    empty.textContent = "No auto-detected facts yet — save the asset to compute them.";
    list.appendChild(empty);
    return;
  }
  for (const [k, v] of Object.entries(computed)) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = typeof v === "string" ? v : JSON.stringify(v);
    list.append(dt, dd);
  }
}

function rowHtml(key: string, value: unknown): HTMLElement {
  const row = document.createElement("div");
  row.className = "metadata-kv-row";

  const keyInput = document.createElement("input");
  keyInput.className = "form-input metadata-kv-key";
  keyInput.placeholder = "key";
  keyInput.value = key;
  keyInput.setAttribute("aria-label", "Metadata key");

  const valueInput = document.createElement("input");
  valueInput.className = "form-input metadata-kv-value";
  valueInput.placeholder = "value (JSON allowed)";
  valueInput.value = typeof value === "string" ? value : JSON.stringify(value);
  valueInput.setAttribute("aria-label", "Metadata value");

  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn btn-icon btn-sm metadata-kv-del";
  del.setAttribute("aria-label", "Remove field");
  del.textContent = "×";

  del.addEventListener("click", () => {
    row.remove();
    collect();
  });
  keyInput.addEventListener("input", collect);
  valueInput.addEventListener("input", collect);

  row.append(keyInput, valueInput, del);
  return row;
}

function collect(): void {
  const list = el("metadataAnnotationsList");
  if (!list) return;
  const out: Record<string, unknown> = {};
  list.querySelectorAll(".metadata-kv-row").forEach((row) => {
    const key = (row.querySelector(".metadata-kv-key") as HTMLInputElement).value.trim();
    const raw = (row.querySelector(".metadata-kv-value") as HTMLInputElement).value;
    if (!key) return;
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* keep raw string */
    }
    out[key] = parsed;
  });
  writeAnnotations(out);
}

function renderAnnotations(): void {
  const list = el("metadataAnnotationsList");
  if (!list) return;
  list.textContent = "";
  const annotations = readAnnotations();
  for (const [k, v] of Object.entries(annotations)) {
    list.appendChild(rowHtml(k, v));
  }
}

function render(): void {
  const section = el("metadataSection");
  const s = getAssetState();
  const hasAsset = !!s.activeAssetManifestCid;
  if (section) section.hidden = !hasAsset;
  if (!hasAsset) return;
  const manifest = getCurrentManifest() as any;
  renderComputed(manifest?.metadata?.computed);
  renderAnnotations();
}

export function initMetadataEditor(): void {
  el("metadataAddBtn")?.addEventListener("click", () => {
    el("metadataAnnotationsList")?.appendChild(rowHtml("", ""));
  });
  document.querySelectorAll(".metadata-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const key = (chip as HTMLElement).dataset.key || "";
      el("metadataAnnotationsList")?.appendChild(rowHtml(key, ""));
      collect();
    });
  });
  on(EVENTS.ASSET_STATE_CHANGED, render);
  on(EVENTS.SCENE_CLEARED, () => {
    clearPendingAnnotations();
    const section = el("metadataSection");
    if (section) section.hidden = true;
  });
  render();
}
~~~

- [ ] **Step 8: Register init + rebuild frontend**

Find where other UI modules are initialized (grep initSidebar / initLibraryDetails in frontend/src/js/app-init.ts) and add:
~~~ts
import { initMetadataEditor } from "./ui/metadata-editor.ts";
// inside the boot sequence, after initSidebar/initLibraryDetails:
initMetadataEditor();
~~~
Add minimal SCSS in frontend/src/scss for .metadata-section, .metadata-list, .metadata-kv-row, .metadata-chip, .metadata-block-title (match the inspector-section design tokens).

Rebuild: npm run build:frontend

- [ ] **Step 9: Run tests**

Run: npx jest test/frontend/metadata-editor.test.js
Expected: PASS. Also run npx jest test/frontend/asset-save.test.js test/frontend/asset-save-metadata.test.js — PASS.

- [ ] **Step 10: Commit**

~~~bash
git add frontend/src/js/services/asset-save/annotations.ts frontend/src/js/services/asset-save/manifest-builder.ts frontend/src/pug/includes/studio-main.pug frontend/src/js/ui/metadata-editor.ts frontend/src/js/app-init.ts frontend/src/scss test/frontend/metadata-editor.test.js
git commit -m "feat(ui): Inspector metadata editor (computed read-only + annotations)"
~~~

---

### Task 7: Library details pane metadata + context menu

**Files:**
- Modify: frontend/src/pug/includes/library-view.pug
- Modify: frontend/src/js/ui/library-details.ts
- Modify: frontend/src/js/ui/library-context-menu.ts
- Test: test/frontend/library-details-metadata.test.js (or extend an existing library-details test if present)

**Interfaces:**
- Consumes: getAnnotations from @arbesk/asset-core (or a small local read of manifest.metadata.annotations via getFromRemoteIPFS, already fetched in library-details renderManifestDetails).
- Produces: a Metadata section in the details pane; collection annotations are editable and write immediately via the existing updateCollection mutation path.

- [ ] **Step 1: Add the Pug section**

In frontend/src/pug/includes/library-view.pug, inside #libraryDetailsExtra (the "More details" disclosure), after the Format row and before the Anchor row, insert:

~~~pug
            .library-details-row#libraryDetailsMetadataRow
              span.k Metadata
              span#libraryDetailsMetadata.v —
~~~

- [ ] **Step 2: Render annotations in library-details.ts**

In frontend/src/js/ui/library-details.ts:
1. Add a render helper:
~~~ts
function renderMetadata(manifest: any, isCollection: boolean): void {
  const target = el("libraryDetailsMetadata");
  if (!target) return;
  const annotations = (manifest?.metadata?.annotations ?? {}) as Record<string, unknown>;
  const keys = Object.keys(annotations);
  if (keys.length === 0) {
    target.textContent = "—";
    return;
  }
  target.textContent = keys.map((k) => k + ": " + JSON.stringify(annotations[k])).join(" · ");
}
~~~
2. Call it from both renderCollectionDetails and renderAssetDetails (pass the manifest):
~~~ts
  renderMetadata(manifest, item.type === "collection");
~~~

- [ ] **Step 3: Editable collection annotations**

Add an "Edit" affordance for collections. In renderCollectionDetails, after renderMetadata, set a button state if one exists:
~~~ts
  const editBtn = el("libraryDetailsEditMetadataBtn");
  if (editBtn) editBtn.hidden = false;
~~~
Add the button to the Pug (inside #libraryDetailsExtra, after the metadata row):
~~~pug
            .library-details-row
              button#libraryDetailsEditMetadataBtn.btn.btn-secondary.btn-sm(type="button" hidden) Edit metadata…
~~~
Wire it in initLibraryDetails to open a small inline editor (or focus a prompt-less key/value editor). For the minimal v1, wire it to a dialog-based editor reusing the existing dialog.ts pattern; the editor writes via updateCollection (import from services/asset-save/collection-publish or a dedicated helper). Keep the write path identical to the CLI/MCP set_collection_metadata (call setCollectionMetadata from packages/besk is NOT available in-browser — instead use the frontend updateCollection equivalent; see note).

Note (important): the browser Library writes collections via the existing frontend collection-write path (services/asset-save/collection-publish.ts + the asset-core applyCollectionMutation), NOT packages/besk. Implement the in-browser edit by mutating draft.metadata.annotations through the SAME updateCollection seam the library already uses for rename/delete, so the version chain stays walkable.

- [ ] **Step 4: Context-menu entry**

In frontend/src/js/ui/library-context-menu.ts, add a "Edit metadata…" item for collections that triggers the same edit flow as Step 3 (or focuses the details pane Metadata section). Follow the existing menu-item pattern in that file.

- [ ] **Step 5: Test**

Write test/frontend/library-details-metadata.test.js asserting renderMetadata flattens annotations into "key: value · key: value" and renders "—" when empty (jsdom, mock getFromRemoteIPFS as the existing library-details tests do). Run:
~~~bash
npx jest test/frontend/library-details-metadata.test.js
~~~
Expected: PASS.

- [ ] **Step 6: Rebuild + E2E**

~~~bash
npm run build:frontend
npm run test:e2e -- --project=chromium
~~~

- [ ] **Step 7: Commit**

~~~bash
git add frontend/src/pug/includes/library-view.pug frontend/src/js/ui/library-details.ts frontend/src/js/ui/library-context-menu.ts test/frontend/library-details-metadata.test.js
git commit -m "feat(ui): Library details metadata + collection annotations editor"
~~~

---

## Final verification

After all tasks, run the full gate:

~~~bash
npm run lint
npm run typecheck
npm run typecheck:frontend
npm test
npm run test:e2e -- --project=chromium
~~~
