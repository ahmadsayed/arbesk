# Semantic Asset Metadata — AI-readable annotations + computed model facts

- **Status:** Draft for review
- **Date:** 2026-08-30
- **Areas touched:** `@arbesk/asset-core` (manifest schema + a pure extractor) · Studio save/publish + Inspector UI · Library details pane · `besk` CLI + MCP

---

## 1. Problem

Arbesk stores rich, content-addressed 3D assets, but nothing an AI agent (via `besk mcp`) can read to understand **what** a model is or **how** to place/use it. Today `asset_info` returns only identity, format, version, and node count. The goal is to let an agent designing a game scene or generating a follow-up model read — and humans/agents write — semantic guidance, per asset and per collection.

## 2. Goals

1. A free-form, arbitrary-data **annotations** map on asset + collection manifests (the k8s "annotations" role).
2. A **computed** map of model facts that are induced from the model itself at save time (the k8s "system label" role).
3. Both travel with the manifest (content-addressed, versioned on IPFS), so any consumer — Studio, Library, `besk` CLI, or an MCP agent — sees the same data.
4. Read/write surfaces: Studio Inspector (asset), Library details pane (collection), and MCP + CLI tools (both).

## 3. Non-goals

- No new on-chain state — metadata is IPFS-only, inside the existing manifest chain (same as `name`, `metadata.chat`, thumbnails).
- No semantic indexing/search in the token indexer (future work).
- No image/texture analysis; `computed` is derived from glTF JSON only (no buffer reads beyond what the existing bounds helper already avoids).
- No auto-description/narration of what a model "is" (that's `annotations`, supplied by humans/agents).

## 4. Data model

Everything new lives **inside the existing `metadata` object**. No new top-level keys.

### 4.1 Asset manifest

```jsonc
{
  "type": "asset",
  "metadata": {
    "chat": [ /* unchanged */ ],

    // SYSTEM: recomputed on every save; read-only to users.
    "computed": {
      "format": "glb",                       // "glb" | "gltf" | "3mf"
      "dimensions": { "width": 0.8, "height": 1.9, "depth": 0.4, "unit": "meters" },
      "bounds": { "min": [0, 0, 0], "max": [0.8, 1.9, 0.4] },
      "center": [0.4, 0.95, 0.2],            // (min+max)/2
      "origin": [0, 0, 0],                   // root node translation (glTF "origin")
      "animation_clips": ["walk", "run", "sit", "slash"],
      "triangle_count": 12480,
      "vertex_count": 8320,
      "mesh_count": 1,
      "node_count": 12,
      "material_count": 3,
      "texture_count": 5,
      "rigged": true,                        // skins.length > 0
      "bone_count": 32,
    },

    // USER/AGENT: free-form, carried forward across versions.
    "annotations": {
      "character_name": "Sir Aldric",
      "role": "protagonist",
      "species": "human",
      "humanoid": true,
      "pivot": [0, 0.95, 0],                 // semantic pivot (glTF has none)
      "lore": "Last of the Dawn Guard",
      "tags": ["npc", "hero", "plate-armor"]
    }
  }
}
```

### 4.2 Collection manifest

```jsonc
{
  "type": "collection",
  "name": "Village Props",
  "assets": { /* unchanged */ },
  "metadata": {
    "annotations": {
      "game": "untitled-rpg",
      "art_style": "stylized-low-poly",
      "theme": "medieval-fantasy",
      "notes": "keep faces under 20k for mobile"
    }
    // collections have no "computed" — nothing model-derived to extract
  }
}
```

## 5. Two namespaces, disjoint (no shadow/merge)

- **`computed`** — strictly model-derivable, deterministic facts. Recomputed wholesale on every save; the user never edits it, so there is **no override collision**.
- **`annotations`** — arbitrary JSON values under arbitrary keys. Carried forward version to version (the save builder already loads the prior manifest as its base; nothing strips `annotations`).

**Deterministic-only rule:** `computed` holds only values derivable with deterministic accuracy from the model. Anything uncertain — whether a character is humanoid, or a semantic "pivot" — is left to `annotations`, so the agent is never misled by a guess presented as fact. `rigged`/`bone_count` stay computed because they are exact (`skins`/`joints` presence), not inferred.

### 5.1 Why `pivot` is an annotation, not computed

glTF 2.0 has **no pivot concept** — a node has `translation`/`rotation`/`scale`, and rotation happens about the node's origin. The honest derivable value is `computed.origin` (root node translation, default `[0,0,0]`). "Pivot" as game tools mean it (the rotation center) is a convention the human/agent asserts, so it lives in `annotations.pivot`. The Inspector can pre-fill a *suggestion* from `computed.origin`, but it is stored only when the user confirms.

## 6. Auto-extraction

New pure, environment-agnostic module in `@arbesk/asset-core`, e.g. `packages/asset-core/src/formats/gltf/model-stats.ts`:

- `computeModelStats(gltfJson, { format }) → ComputedMetadata` — a pure function over parsed glTF JSON (no buffer reads).
- Reuses `computeGltfBounds` from `formats/gltf/bounds.ts` (already JSON-only, reads POSITION accessor `min`/`max`).

### 6.1 Field → glTF source map

| `computed` field | Source in glTF 2.0 JSON |
|---|---|
| `format` | `detectFormat()` |
| `dimensions` / `bounds` | `computeGltfBounds()` → `size`, `min`/`max` |
| `center` | `(min+max)/2` |
| `origin` | root scene node `translation` (default `[0,0,0]`) |
| `animation_clips` | `animations[].name` (unnamed → `"clip_<i>"`) |
| `triangle_count` | Σ primitives: indexed → `index` accessor `count/3`; non-indexed → `POSITION` accessor `count/3` |
| `vertex_count` | Σ `POSITION` accessor `count` |
| `mesh_count` / `node_count` / `material_count` / `texture_count` | `meshes` / `nodes` / `materials` / `textures` array lengths |
| `rigged` | `skins.length > 0` |
| `bone_count` | `skins[].joints` — count of unique joint indices across all skins |

**Units:** glTF 1 unit = 1 meter, so `dimensions.unit = "meters"`.

**Optionality:** every `computed` field is optional and omitted when a format cannot derive it. 3MF has no glTF `animations`/`skins`, so its `computed` carries only `format` + `dimensions`/`bounds`/`center`.

### 6.2 Where extraction runs

- **Studio:** client-side, in `manifest-builder.ts` `prepareManifestForWrite()`, **after** `decomposeManifestNodes()` (which guarantees `node.source.cid` points to a composite glTF JSON that keeps `animations/skins/meshes/nodes/accessors/materials/textures` inline — confirmed in `decomposer.ts`). Fetch/parse the root source (composite glTF JSON, or GLB JSON-chunk parse) and call `computeModelStats`, then write `manifest.metadata.computed = stats`.
- **CLI (`besk upload`):** deferred — the CLI upload path stores the raw composite with **no asset-manifest wrapper** (`assets[assetID]` → composite CID directly, per `catalog.ts uploadAsset`), so there is no manifest to attach `computed` to. Auto-extraction for CLI uploads lands only if/when uploads are wrapped in a manifest (see §12).

## 7. Save/publish integration

1. **Pending annotations** — the Inspector metadata editor writes to a pending-annotations store (same pattern as `pendingTransformEdits` / `pendingSourceColorEdits` in `scene-graph.ts` / `parametric-preview.ts`): `getPendingAnnotations` / `setPendingAnnotations` / `clearPendingAnnotations`, plus a dirty flag so a metadata-only edit is detected as a change by `manifestsSemanticallyEqual`.
2. **Bake order** in `prepareManifestForWrite()`:
   - apply pending annotations → `manifest.metadata.annotations = { ...prior, ...pending }` (carry forward + merge edits).
   - run `decomposeManifestNodes()`.
   - run `computeModelStats()` → overwrite `manifest.metadata.computed`.
   - `finalizeVersionAndChat()` (existing) preserves non-`chat` metadata keys via its spread, so `computed`/`annotations` survive untouched.
3. **No-change detection** — the existing `manifestsSemanticallyEqual` strip already removes `timestamp`/`version`/`prev_asset_manifest_cid`; `computed`/`annotations` differences (incl. a recomputed `computed` changing between saves, e.g. after a retopo) correctly count as changes.

## 8. Collection metadata

- Collection manifests already update via `applyCollectionMutation()` (version bump + `prev_asset_manifest_cid`). Metadata edits go through the same path.
- No `computed` on collections.

## 9. UI

### 9.1 Studio Inspector (asset) — new "Metadata" section

In `frontend/src/pug/includes/studio-main.pug` `#inspector`, add a collapsible `<section class="inspector-section" id="metadataSection">` between **Color** and **Comments**:

- **"Auto-detected" block** (read-only, system badge) — renders `computed` (format, dimensions, bounds, center, animation_clips, counts, rigged, bone_count). Grayed, no controls. The existing `#animationsSection` dropdown can be populated from `computed.animation_clips`.
- **"Notes for the AI" block** (editable) — key/value list over `annotations`:
  - each row: key (text) + value (text; JSON-parsed when it looks like JSON → numbers/booleans/arrays/objects work).
  - `+ Add field` button, per-row delete.
  - quick-add chips for `character_name`, `role`, `species`, `tags`, `lore`, `pivot`.
  - edits write to the pending-annotations store; persisted on next Save/Publish.

### 9.2 Library details pane (collection) — "Metadata" section + context menu

In `frontend/src/pug/includes/library-view.pug` details pane (rendered by `library-details.ts`), add a `Metadata` section for `annotations`. Collection edits write immediately via the existing `updateCollection()` mutation path (no "save" step in Library). Add a right-click context-menu entry "Edit metadata…" on collections that focuses/expands the section.

## 10. MCP + CLI (parity mandatory)

New tools (each ships with a matching `besk` subcommand, per the CLI↔MCP parity rule):

| MCP tool | CLI | Behavior |
|---|---|---|
| `get_asset_metadata` | `besk metadata get <name>` | returns `computed` + `annotations` |
| `set_asset_metadata` | `besk metadata set <name> --key k --value v` (repeatable) | merge into `annotations`, write new manifest version + update collection `assets[assetID]` (mirrors `rename_asset`) |
| `delete_asset_metadata` | `besk metadata unset <name> --key k` | remove key, write new version |
| `get_collection_metadata` | `besk collection metadata get` | returns `annotations` |
| `set_collection_metadata` | `besk collection metadata set --key k --value v` | mutate via `updateCollection()` |
| `delete_collection_metadata` | `besk collection metadata unset --key k` | mutate via `updateCollection()` |

- Enrich `asset_info` to include `computed` + `annotations`.
- `list_assets` optionally surfaces `annotations.character_name`/`role` as a friendly display (optional; not blocking).
- `catalog.ts` gains a small `readAnnotations(manifest)` / `writeAnnotations(manifest, patch)` helper both MCP and CLI call.

## 11. Schema & validation

Update `packages/asset-core/src/manifest/schema.ts` — today `metadata` only allows `chat`, and zod **strips unknown keys** on `validateManifest()`, so the new maps would be silently dropped by any validating reader:

```ts
metadata: z.object({
  chat: z.array(chatProvenanceEntrySchema).optional(),
  annotations: z.record(z.unknown()).optional(),       // free-form, arbitrary JSON
  computed: computedMetadataSchema.passthrough().optional(), // system facts, future-proof
}).optional(),
```

where `computedMetadataSchema` enumerates the §6.1 fields (all optional), and `.passthrough()` keeps the schema tolerant of newly-added computed fields without a breaking release.

## 12. Error handling & edge cases

- **No POSITION accessors / degenerate model** → `computeGltfBounds` returns `null` → omit `dimensions`/`bounds`/`center` (best-effort; never fail the save).
- **GLB vs composite glTF** → extractor takes parsed glTF JSON; callers parse GLB's JSON chunk (reuse the GLB header logic already in `boundsFromGlbBytes`).
- **Unnamed animations** → deterministic `"clip_<i>"` names so `animation_clips` is never empty-but-ambiguous.
- **Non-indexed primitives** → triangle count falls back to `POSITION.count/3`.
- **No skeleton** → `rigged: false`, `bone_count: 0`.
- **Extraction failure** → log `[SAVE]` warning, omit `computed` (or keep prior), and continue — extraction must never block a save (same resilience as thumbnail capture).
- **Metadata-only change with identical model** → still detected as a change via the dirty flag + semantic diff.
- **Manifest-less assets (CLI `besk upload`)** → `assets[assetID]` points at a raw composite, not an asset manifest, so `metadata` set/get on those is undefined until uploads are wrapped in a manifest. Studio-created assets always have manifests; scope P1 set/get tools to manifest-backed assets and return a clear error otherwise.

## 13. Testing

| Suite | Covers |
|---|---|
| asset-core unit | `computeModelStats` against fixture glTFs: GLB + composite, indexed/non-indexed, rigged/static, empty meshes |
| asset-core unit | `validateManifest` preserves `computed`/`annotations` (regression vs the zod strip) |
| frontend | manifest-builder bakes pending annotations + recomputes `computed`; carry-forward across two saves; no-change detection |
| frontend | Inspector metadata editor key/value add/remove, JSON-typed values |
| api / e2e | save → open → annotations + computed present; Library collection metadata edit persists |
| MCP/CLI | `set/get/delete` metadata round-trip + parity between `besk` and MCP tools |

E2E required (manifest schema + save/publish + Studio UI + Library changes per `AGENTS.md` §10).

## 14. Phasing

1. **P1 — Data model + extraction:** schema change, `computeModelStats`, save-path integration (Studio).
2. **P2 — Read surfaces:** enrich `asset_info` + `get_*_metadata` MCP/CLI tools.
3. **P3 — Write surfaces:** Inspector metadata editor + Library details pane editor + `set/delete_*_metadata` tools.

P1 and P2 are prerequisites for any agent use; P3 completes the human loop.

## 15. Open questions (to confirm before implementation)

1. Whether `list_assets` should surface a friendly annotation name (P3 nicety).