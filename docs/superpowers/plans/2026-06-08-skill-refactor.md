# Skill Refactor — Brief Entry Points Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor all 7 project skills so each `SKILL.md` is a 100–180 line brief entry point, with deep reference content moved to companion `.md` files in the same skill folder.

**Architecture:** Pure content reorganization. No code changes. Split existing `SKILL.md` content into a brief entry point + companion files. The `babylon-memory-leaks` skill is the model — it stays untouched.

**Tech Stack:** Markdown files only. No build step. No dependencies.

---

## File Structure

```
.agents/skills/
├── arbesk-asset-inspection/
│   ├── SKILL.md
│   ├── api-reference.md       (new)
│   ├── manifest-structure.md  (new)
│   └── deep-dive.md           (new)
├── arbesk-gltf-pipeline/
│   ├── SKILL.md
│   ├── deep-dive.md           (new)
│   └── troubleshooting.md     (new)
├── arbesk-ipfs-storage/
│   ├── SKILL.md
│   ├── deep-dive.md           (new)
│   ├── troubleshooting.md     (new)
│   ├── api-reference.md       (new)
│   └── docker-config.md       (new)
├── babylon-memory-leaks/
│   └── SKILL.md               (unchanged)
├── edit-ui/
│   ├── SKILL.md
│   ├── deep-dive.md           (new)
│   ├── checklists.md          (new)
│   ├── patterns.md            (new)
│   └── pitfalls.md            (new)
├── gnome-hig-audit/
│   ├── SKILL.md
│   ├── checklists.md          (new)
│   ├── report-template.md     (new)
│   └── quick-audit.md         (new)
└── solidity-smart-contracts/
    ├── SKILL.md
    ├── deep-dive.md           (new)
    ├── contract-deep-dive.md  (new)
    ├── deployment-pipeline.md (new)
    ├── debugging.md           (new)
    ├── checklists.md          (new)
    ├── smart-accounts.md      (new)
    ├── session-auth.md        (new)
    └── quick-reference.md     (new)
```

---

### Task 1: arbesk-asset-inspection — Create Companion Files

**Files:**
- Create: `.agents/skills/arbesk-asset-inspection/api-reference.md`
- Create: `.agents/skills/arbesk-asset-inspection/manifest-structure.md`
- Create: `.agents/skills/arbesk-asset-inspection/deep-dive.md`

- [ ] **Step 1: Read current SKILL.md**

Run: `cat .agents/skills/arbesk-asset-inspection/SKILL.md`
Expected: 238 lines. Confirm sections exist: `## Backend API: Fetching Assets`, `## Manifest Structure`, `## Node Types`, `## Counting Children`, `## Token Resolution (Frontend)`.

- [ ] **Step 2: Create `api-reference.md`**

Extract verbatim from the current `SKILL.md`:
- Everything from `## Backend API: Fetching Assets` through the end of `### Direct IPFS fetch (via the API test helper)`
- Include the `### Walk the manifest version chain` subsection
- Include the `### Direct IPFS fetch` subsection

Do NOT include `## Manifest Structure` or later sections.

Write to `.agents/skills/arbesk-asset-inspection/api-reference.md` with this header:
```markdown
# API Reference — Arbesk Asset Inspection

Full API endpoint documentation for asset inspection.
```

- [ ] **Step 3: Create `manifest-structure.md`**

Extract verbatim from the current `SKILL.md`:
- Everything from `## Manifest Structure` through the end of `### 2. Token Child Node (dynamic child world reference)`
- Include the manifest JSON example
- Include both node type JSON examples
- Include the paragraph after token child node: "**Key rule:** Token child nodes do NOT have..."
- Include `## Counting Children` (with the bash one-liner)

Write to `.agents/skills/arbesk-asset-inspection/manifest-structure.md` with this header:
```markdown
# Manifest Structure — Arbesk Asset Inspection

Full manifest schema and node type reference.
```

- [ ] **Step 4: Create `deep-dive.md`**

Extract verbatim from the current `SKILL.md`:
- Everything from `## Token Resolution (Frontend)` through the end of the file
- Include the RPC endpoints table
- Include the Key Files table
- Include Common Inspection Patterns
- Include the Dependency section

Write to `.agents/skills/arbesk-asset-inspection/deep-dive.md` with this header:
```markdown
# Deep Dive — Arbesk Asset Inspection

Token resolution, common patterns, and infrastructure dependencies.
```

---

### Task 2: arbesk-asset-inspection — Rewrite SKILL.md

**Files:**
- Modify: `.agents/skills/arbesk-asset-inspection/SKILL.md`

- [ ] **Step 1: Write the new brief SKILL.md**

Overwrite `.agents/skills/arbesk-asset-inspection/SKILL.md` with:

```markdown
---
name: arbesk-asset-inspection
description: Fetch and inspect Arbesk assets (by token ID, manifest CID, or IPFS CID), walk the manifest version chain, count child nodes, and understand the fractal manifest structure. Use when asked to "get asset X", "inspect token Y", "how many children", "show manifest", or "walk the version chain" for any Arbesk asset.
---

# Arbesk Asset Inspection

Use this skill when you need to:
- Inspect an asset by its **token ID** (numeric, e.g. `172409538`)
- Fetch a manifest by its **IPFS CID** (e.g. `Qmcuae4gCFFJ9Nkyyz7AyxATW1jSK63EvbtgzzXBWxt4gg`)
- Walk the **manifest version chain** (backward-linked IPFS history)
- Count or list **child worlds** embedded in a manifest
- Understand the **fractal manifest structure**

## Quick Decision

| Question | Action |
|----------|--------|
| "Get asset X" where X is a number? | `GET /api/v1/tokens/X/manifest`. See [→ API Reference](./api-reference.md) |
| "How many children in asset X?" | Fetch manifest, count nodes with `child_ref` or `child_manifest_id`. See [→ Manifest Structure](./manifest-structure.md) |
| "Show version history of asset X" | Get manifest CID, then `GET /api/v1/manifests/:cid/history`. See [→ API Reference](./api-reference.md) |
| "What's in the manifest at CID X?" | `curl` via token endpoint, or `ipfs cat` directly. See [→ API Reference](./api-reference.md) |

## Key Rules

1. **Token child nodes have no local history** — the referenced token's manifest owns the history. The parent only owns `transform_matrix` (placement).
2. **A node is a child if it has `child_ref` or `child_manifest_id`** — nodes with only `.source` are self-contained GLTF assets, not children.
3. **Backend must be running** for `/api/v1/tokens/` and `/api/v1/manifests/` endpoints. If `Connection refused`, run `npm start`.

## File Map

| File | Role | Details |
|------|------|---------|
| `src/api/index.js` | Token manifest + history routes | [→ Deep Dive](./deep-dive.md) |
| `src/api/ipfs-utils.js` | `catManifest()` — IPFS read with timeout | [→ Deep Dive](./deep-dive.md) |
| `src/api/manifest-utils.js` | `getSceneNodes()`, `bumpManifestVersion()` | [→ Deep Dive](./deep-dive.md) |
| `frontend/src/js/blockchain/token-resolver.js` | `resolveChildRef()` — frontend token → CID | [→ Deep Dive](./deep-dive.md) |
| `frontend/src/js/blockchain/uri-utils.js` | `normalizeTokenURI()` — CID extraction | [→ Deep Dive](./deep-dive.md) |
| `blockchain/contracts/ArbeskAsset.sol` | `tokenURI(uint256)` — on-chain CID lookup | [→ Deep Dive](./deep-dive.md) |

## Deep Reference

| Topic | File |
|-------|------|
| API Endpoints (curl, responses, errors) | [→ API Reference](./api-reference.md) |
| Manifest Schema & Node Types | [→ Manifest Structure](./manifest-structure.md) |
| Token Resolution, Patterns, Dependencies | [→ Deep Dive](./deep-dive.md) |
```

- [ ] **Step 2: Verify line count**

Run: `wc -l .agents/skills/arbesk-asset-inspection/SKILL.md`
Expected: ~55 lines. (The target was 120, but this skill's content is naturally compact — 55 is fine as long as it has triggers, decisions, rules, file map, and links.)

---

### Task 3: arbesk-gltf-pipeline — Create Companion Files

**Files:**
- Create: `.agents/skills/arbesk-gltf-pipeline/deep-dive.md`
- Create: `.agents/skills/arbesk-gltf-pipeline/troubleshooting.md`

- [ ] **Step 1: Read current SKILL.md**

Run: `cat .agents/skills/arbesk-gltf-pipeline/SKILL.md`
Expected: 390 lines.

- [ ] **Step 2: Create `deep-dive.md`**

Extract verbatim from the current `SKILL.md`:
- `## 1. Architecture Overview` through `## 9. Format Detection`
- This includes: Architecture Overview, Key Files Reference table, The Three URI Formats, Compose/Decompose Pipeline, Scene Graph Loading, Post-Processor System, Material Editing, Save & Publish Flow, Format Detection
- Include the Golden Rules section (`## 11. Golden Rules`) at the end

Write to `.agents/skills/arbesk-gltf-pipeline/deep-dive.md` with this header:
```markdown
# Deep Dive — Arbesk glTF 2.0 / GLB Pipeline

Full architectural overview: compose/decompose, scene graph loading, post-processor system, material editing, save flow, and golden rules.
```

- [ ] **Step 3: Create `troubleshooting.md`**

Extract verbatim from the current `SKILL.md`:
- `## 10. Common Operations` through the end of `### 10.5 Force Re-decomposition`

Write to `.agents/skills/arbesk-gltf-pipeline/troubleshooting.md` with this header:
```markdown
# Troubleshooting — Arbesk glTF 2.0 / GLB Pipeline

Common operations, debugging guides, and force re-decomposition.
```

---

### Task 4: arbesk-gltf-pipeline — Rewrite SKILL.md

**Files:**
- Modify: `.agents/skills/arbesk-gltf-pipeline/SKILL.md`

- [ ] **Step 1: Write the new brief SKILL.md**

Overwrite `.agents/skills/arbesk-gltf-pipeline/SKILL.md` with:

```markdown
---
name: arbesk-gltf-pipeline
description: Expert guidance on the Arbesk glTF 2.0 / GLB pipeline — compose/decompose, material editing, IPFS content-addressing, buffer/image URI formats, scene graph loading, post_processor handling, and save/publish persistence. Use when asked to "fix glTF loading", "change material colors", "understand the glTF pipeline", "add a mesh override", "debug composite/decompose", "edit glTF buffers/images", "add format support (OBJ/FBX)", or any glTF/GLB question in this codebase.
---

# Arbesk glTF 2.0 / GLB Pipeline

Use this skill when working with any glTF or GLB-related code in the Arbesk project — the compose/decompose pipeline, material editing, buffer/image URI formats, scene graph loading, post-processing, or data persistence.

## Quick Decision

| Question | Action |
|----------|--------|
| glTF loading failure? | Check composite → monolithic → legacy CID-prefix → valid CID. See [→ Troubleshooting](./troubleshooting.md) |
| Colors not applying after save? | Check if node is decomposed (`source.path === "composite.gltf"`). See [→ Troubleshooting](./troubleshooting.md) |
| Need to add a new material property? | Add setter in `material-editor.js`, wire to inspector, update save flow. See [→ Deep Dive](./deep-dive.md) |
| Need to add OBJ/FBX support? | Update `detectAssetFormat()`, `loadAsset()`, and save flow. See [→ Deep Dive](./deep-dive.md) |

## Key Rules

1. **GLB is never decomposed** — loads as raw binary blob. All edits go through `post_processor` overlays.
2. **glTF converts to composite on first save** — one-way door. Once decomposed, it stays composite.
3. **Material edits = new composite CID only** — buffers and images stay at their original CIDs.
4. **Scale is always `post_processor`** — even for decomposed nodes, it's a geometry transform, not a material property.
5. **The composer deep-clones** — `composeGlTF()` uses `JSON.parse(JSON.stringify())` before modifying.
6. **All IPFS reads go through the gateway** — browser: `127.0.0.1:8080`; backend: `127.0.0.1:5001`.
7. **`uri_to_cid.js` is legacy** — new code uses composer/decomposer.
8. **Token child nodes have no glTF source** — they skip `loadAsset()` entirely.

## File Map

| File | Role | Details |
|------|------|---------|
| `frontend/src/js/gltf/composer.js` | Resolves `ipfs://` URIs → base64 for Babylon.js | [→ Deep Dive](./deep-dive.md) |
| `frontend/src/js/gltf/decomposer.js` | Extracts data URIs → stores on IPFS | [→ Deep Dive](./deep-dive.md) |
| `frontend/src/js/gltf/material-editor.js` | Modifies PBR props, commits new CID | [→ Deep Dive](./deep-dive.md) |
| `frontend/src/js/engine/scene-graph.js` | `loadAsset()` dispatcher, `loadNode()` orchestration | [→ Deep Dive](./deep-dive.md) |
| `frontend/src/js/engine/time-travel.js` | `applyColor()`, `applyScale()` runtime overlays | [→ Deep Dive](./deep-dive.md) |
| `frontend/src/js/engine/parametric-preview.js` | Inspector UI for color/scale/mesh overrides | [→ Deep Dive](./deep-dive.md) |
| `frontend/src/js/ui/asset-save.js` | `prepareManifestForWrite()` — save flow | [→ Deep Dive](./deep-dive.md) |
| `frontend/src/js/ipfs/write-to-ipfs.js` | Browser-side IPFS write | [→ Deep Dive](./deep-dive.md) |
| `frontend/src/js/ipfs/remote-ipfs.js` | Browser-side IPFS read | [→ Deep Dive](./deep-dive.md) |

## Deep Reference

| Topic | File |
|-------|------|
| Architecture, URI Formats, Compose/Decompose, Scene Graph, Post-Processor, Materials, Save Flow | [→ Deep Dive](./deep-dive.md) |
| Debug Loading, Debug Colors, Add Properties, Add Formats, Force Re-decomposition | [→ Troubleshooting](./troubleshooting.md) |
```

- [ ] **Step 2: Verify line count**

Run: `wc -l .agents/skills/arbesk-gltf-pipeline/SKILL.md`
Expected: ~70 lines.

---

### Task 5: arbesk-ipfs-storage — Create Companion Files

**Files:**
- Create: `.agents/skills/arbesk-ipfs-storage/deep-dive.md`
- Create: `.agents/skills/arbesk-ipfs-storage/troubleshooting.md`
- Create: `.agents/skills/arbesk-ipfs-storage/api-reference.md`
- Create: `.agents/skills/arbesk-ipfs-storage/docker-config.md`

- [ ] **Step 1: Read current SKILL.md**

Run: `cat .agents/skills/arbesk-ipfs-storage/SKILL.md`
Expected: 356 lines.

- [ ] **Step 2: Create `deep-dive.md`**

Extract verbatim from the current `SKILL.md`:
- `## 1. Architecture Overview` through `## 7. Manifest Chain Storage Model`
- This includes: Architecture Overview, IPFS Client Libraries, Pinning Semantics, All IPFS Write Paths, All IPFS Read Paths, Frontend IPFS Cache, Manifest Chain Storage Model
- Include `## 14. Content Addressing vs. Deletion` at the end

Write to `.agents/skills/arbesk-ipfs-storage/deep-dive.md` with this header:
```markdown
# Deep Dive — Arbesk IPFS & Storage

Architecture, client libraries, pinning semantics, write/read paths, cache, manifest chain model, and content addressing concepts.
```

- [ ] **Step 3: Create `api-reference.md`**

Extract verbatim from the current `SKILL.md`:
- `## 8. The Unpin Endpoint` (`POST /api/v1/ipfs/unpin`)

Write to `.agents/skills/arbesk-ipfs-storage/api-reference.md` with this header:
```markdown
# API Reference — Arbesk IPFS & Storage

Unpin endpoint specification.
```

- [ ] **Step 4: Create `docker-config.md`**

Extract verbatim from the current `SKILL.md`:
- `## 9. Docker IPFS Configuration`

Write to `.agents/skills/arbesk-ipfs-storage/docker-config.md` with this header:
```markdown
# Docker IPFS Configuration — Arbesk IPFS & Storage

Kubo container setup, isolation config, and storage volumes.
```

- [ ] **Step 5: Create `troubleshooting.md`**

Extract verbatim from the current `SKILL.md`:
- `## 12. Common Operations` through `## 13. Troubleshooting`

Write to `.agents/skills/arbesk-ipfs-storage/troubleshooting.md` with this header:
```markdown
# Troubleshooting — Arbesk IPFS & Storage

Manual CLI operations and symptom/cause/fix reference.
```

---

### Task 6: arbesk-ipfs-storage — Rewrite SKILL.md

**Files:**
- Modify: `.agents/skills/arbesk-ipfs-storage/SKILL.md`

- [ ] **Step 1: Write the new brief SKILL.md**

Overwrite `.agents/skills/arbesk-ipfs-storage/SKILL.md` with:

```markdown
---
name: arbesk-ipfs-storage
description: IPFS storage expertise for the Arbesk project. Covers the private Kubo Docker node, pin/unpin semantics, add/pin/rm API flows, manifest chain storage model, garbage collection, browser-side writes, read cache, and the unpin-on-burn lifecycle. Use when asked about IPFS pinning, unpinning, GC, storage limits, CID resolution, or any IPFS read/write operation across backend or frontend.
---

# Arbesk IPFS & Storage

Use this skill when working with any IPFS-related code in the Arbesk project — reads, writes, pinning, unpinning, garbage collection, Docker configuration, or storage lifecycle questions.

## Quick Decision

| Question | Action |
|----------|--------|
| Content not found after `ipfs.add()`? | Check if node initialized, repo corrupted, or `StorageMax` too low. See [→ Troubleshooting](./troubleshooting.md) |
| Frontend IPFS writes fail with CORS? | CORS headers set in entrypoint. See [→ Docker Config](./docker-config.md) |
| `WRONG_CONTRACT` with smart account? | Validate events, not `receipt.to`. See `solidity-smart-contracts` skill |
| Need to manually unpin after burn? | `POST /api/v1/ipfs/unpin` with manifest CID. See [→ API Reference](./api-reference.md) |

## Key Rules

1. **Every `ipfs.add()` must be followed by explicit `ipfs.pin.add()`** — defense-in-depth.
2. **Pin calls are wrapped in try/catch** — a pin failure is non-fatal; log and continue.
3. **Use `catManifest()` for all backend manifest reads** — consistent timeout + chunk decoding.
4. **Never unpin content belonging to other tokens** — `child_ref` CIDs are excluded from unpin-on-burn.
5. **Do NOT add prefetching to the frontend cache** — on-demand by design.
6. **Do NOT expose IPFS ports beyond `127.0.0.1`** — node must remain private.
7. **Log IPFS operations with `[IPFS]` tag** — per project logging conventions.
8. **Storage cap is 100 GB** — adjust `Datastore.StorageMax` if needed.
9. **Unpin before running GC** — never run `ipfs repo gc` without unpinning first.
10. **Test IPFS changes with backend running** — `npm start` + `docker-compose up -d ipfs`.

## File Map

| File | Role | Details |
|------|------|---------|
| `src/api/index.js` | Backend routes: save, publish, unpin, chain, token resolver | [→ Deep Dive](./deep-dive.md) |
| `src/api/ipfs-utils.js` | `catManifest()` — IPFS read with timeout | [→ Deep Dive](./deep-dive.md) |
| `src/api/assets/generate-node.js` | Generation pipeline: add asset, build manifest, pin | [→ Deep Dive](./deep-dive.md) |
| `frontend/src/js/ipfs/write-to-ipfs.js` | Browser-side IPFS writer | [→ Deep Dive](./deep-dive.md) |
| `frontend/src/js/ipfs/remote-ipfs.js` | Browser-side IPFS reader with cache | [→ Deep Dive](./deep-dive.md) |
| `docker/Dockerfile` | Kubo IPFS container image | [→ Docker Config](./docker-config.md) |
| `docker/entrypoint.sh` | IPFS node init and isolation config | [→ Docker Config](./docker-config.md) |
| `docker-compose.yml` | Orchestration: IPFS + Hardhat | [→ Docker Config](./docker-config.md) |

## Deep Reference

| Topic | File |
|-------|------|
| Architecture, Pinning, Write/Read Paths, Cache, Chain Model | [→ Deep Dive](./deep-dive.md) |
| Unpin Endpoint Spec | [→ API Reference](./api-reference.md) |
| Docker Config, Isolation, Volumes | [→ Docker Config](./docker-config.md) |
| Manual Operations, Symptom/Cause/Fix | [→ Troubleshooting](./troubleshooting.md) |
```

- [ ] **Step 2: Verify line count**

Run: `wc -l .agents/skills/arbesk-ipfs-storage/SKILL.md`
Expected: ~75 lines.

---

### Task 7: edit-ui — Create Companion Files

**Files:**
- Create: `.agents/skills/edit-ui/deep-dive.md`
- Create: `.agents/skills/edit-ui/checklists.md`
- Create: `.agents/skills/edit-ui/patterns.md`
- Create: `.agents/skills/edit-ui/pitfalls.md`

- [ ] **Step 1: Read current SKILL.md**

Run: `cat .agents/skills/edit-ui/SKILL.md`
Expected: 512 lines.

- [ ] **Step 2: Create `deep-dive.md`**

Extract verbatim from the current `SKILL.md`:
- `## 1. Project UI Architecture at a Glance` through `## 7. SCSS Conventions`
- This includes: Stack table, Directory Map, Build & Verify Workflow, Studio Shell ASCII diagram, Layout CSS, Header Bar Conventions, GNOME HIG Principles Applied, State Management Pattern, Event Flow table, Babylon.js Integration Patterns, SCSS Conventions

Write to `.agents/skills/edit-ui/deep-dive.md` with this header:
```markdown
# Deep Dive — Arbesk Studio UI / UX

Full UI architecture: stack, directory map, studio shell, GNOME HIG principles, state management, event flow, Babylon.js integration, and SCSS conventions.
```

- [ ] **Step 3: Create `checklists.md`**

Extract verbatim from the current `SKILL.md`:
- `## 8. Keyboard Shortcut Checklist`
- `## 11. Adding a New Panel or Component — Checklist`

Write to `.agents/skills/edit-ui/checklists.md` with this header:
```markdown
# Checklists — Arbesk Studio UI / UX

Keyboard shortcut checklist and new panel/component checklist.
```

- [ ] **Step 4: Create `patterns.md`**

Extract verbatim from the current `SKILL.md`:
- `## 9. Common UI Patterns to Reuse` (empty state, drop zone, spinner)

Write to `.agents/skills/edit-ui/patterns.md` with this header:
```markdown
# Patterns — Arbesk Studio UI / UX

Reusable UI patterns: empty states, drop zones, and spinners.
```

- [ ] **Step 5: Create `pitfalls.md`**

Extract verbatim from the current `SKILL.md`:
- `## 10. Pitfalls to Avoid`

Write to `.agents/skills/edit-ui/pitfalls.md` with this header:
```markdown
# Pitfalls — Arbesk Studio UI / UX

Common mistakes and anti-patterns to avoid.
```

---

### Task 8: edit-ui — Rewrite SKILL.md

**Files:**
- Modify: `.agents/skills/edit-ui/SKILL.md`

- [ ] **Step 1: Write the new brief SKILL.md**

Overwrite `.agents/skills/edit-ui/SKILL.md` with:

```markdown
---
name: edit-ui
description: Modify or extend the Arbesk Studio frontend (Pug/SCSS/JS) following GNOME Human Interface Guidelines. Use when adding new UI components, panels, controls, keyboard shortcuts, or visual feedback to the 3D viewport — and when the change must feel consistent with the existing minimalist, keyboard-driven studio shell.
---

# Arbesk Studio UI / UX — GNOME HIG

Use this skill when working on the Arbesk Studio frontend (`frontend/src/`, `frontend/scripts/`) and the change touches user-facing UI: panels, buttons, controls, the 3D viewport, keyboard shortcuts, selection feedback, drag/drop targets, or empty states.

The goal of every change: **make the interface feel like a native GNOME application** — minimal chrome, keyboard-driven, immediately responsive, no surprises.

## Quick Decision

| Question | Action |
|----------|--------|
| Adding a new panel? | Follow the 7-step checklist. See [→ Checklists](./checklists.md) |
| Adding a keyboard shortcut? | Add to `scene-graph.js` keydown switch with form-field guard. See [→ Checklists](./checklists.md) |
| Need a reusable pattern? | Empty state, drop zone, or spinner. See [→ Patterns](./patterns.md) |
| Something feels off? | Check ortho frustum, HighlightLayer stencil, mesh disposal, form guards. See [→ Pitfalls](./pitfalls.md) |

## Key Rules

1. **Minimal chrome** — no in-scene axes, no view cube, no toolbar overlay. Only grid, gizmo, drop indicator.
2. **Every action has a key** — Blender conventions (`1/3/7` for views, `F` for frame, `Esc` to deselect).
3. **Form fields steal keystrokes** — always guard `document.activeElement` in global `keydown` handlers.
4. **Selection feedback is HighlightLayer** (amber `#D4A017`). Camera framing uses 300ms animation.
5. **All viewport chrome has `metadata.isViewportChrome = true`** so `clearScene()` preserves it.
6. **Rebuild after every change** — `npm run build:frontend`. Backend serves `dist/`, not `src/`.
7. **Babylon.js is a CDN global** — never `import` it. The studio HTML loads it via `<script>`.
8. **Pug has no includes** — everything is in `studio.pug`.
9. **SCSS components need `@use` in `styles.scss`** — a new file won't be built unless imported.
10. **Use CSS variables, not raw px** — spacing, colors, radii, durations all from tokens.

## File Map

| File | Role | Details |
|------|------|---------|
| `frontend/src/pug/studio.pug` | The **only** Pug file | [→ Deep Dive](./deep-dive.md) |
| `frontend/src/scss/styles.scss` | Imports all component files | [→ Deep Dive](./deep-dive.md) |
| `frontend/src/js/engine/scene-graph.js` | Babylon engine, camera, selection, keyboard | [→ Deep Dive](./deep-dive.md) |
| `frontend/src/js/engine/state.js` | Shared mutable `state` object | [→ Deep Dive](./deep-dive.md) |
| `frontend/src/js/engine/parametric-preview.js` | Inspector live editing | [→ Deep Dive](./deep-dive.md) |
| `frontend/src/js/ui/asset-library.js` | Gallery of saved assets | [→ Deep Dive](./deep-dive.md) |
| `frontend/src/js/ui/asset-drop-zone.js` | Drop target for dragged cards | [→ Deep Dive](./deep-dive.md) |
| `frontend/src/js/ui/asset-save.js` | Save Draft / Publish wiring | [→ Deep Dive](./deep-dive.md) |
| `frontend/src/js/ui/outliner.js` | Scene graph tree | [→ Deep Dive](./deep-dive.md) |

## Deep Reference

| Topic | File |
|-------|------|
| Architecture, Shell, HIG Principles, State, Events, Babylon, SCSS | [→ Deep Dive](./deep-dive.md) |
| Keyboard Shortcuts, New Panel Checklist | [→ Checklists](./checklists.md) |
| Empty State, Drop Zone, Spinner Patterns | [→ Patterns](./patterns.md) |
| Common Mistakes & Anti-Patterns | [→ Pitfalls](./pitfalls.md) |
```

- [ ] **Step 2: Verify line count**

Run: `wc -l .agents/skills/edit-ui/SKILL.md`
Expected: ~75 lines.

---

### Task 9: gnome-hig-audit — Create Companion Files

**Files:**
- Create: `.agents/skills/gnome-hig-audit/checklists.md`
- Create: `.agents/skills/gnome-hig-audit/report-template.md`
- Create: `.agents/skills/gnome-hig-audit/quick-audit.md`

- [ ] **Step 1: Read current SKILL.md**

Run: `cat .agents/skills/gnome-hig-audit/SKILL.md`
Expected: 592 lines.

- [ ] **Step 2: Create `checklists.md`**

Extract verbatim from the current `SKILL.md`:
- `## 2. Audit Categories & Scoring` through the end of `## 13. Category J: Empty States & Feedback Audit Checklist`
- This includes: Categories & Scoring table, Score interpretation, How to Run the Audit, and all 10 category checklists (A through J)

Write to `.agents/skills/gnome-hig-audit/checklists.md` with this header:
```markdown
# Checklists — GNOME HIG UI/UX Audit

Full 10-category audit checklists (A–J), scoring rubric, and step-by-step audit procedure.
```

- [ ] **Step 3: Create `report-template.md`**

Extract verbatim from the current `SKILL.md`:
- `## 14. Report Template`

Write to `.agents/skills/gnome-hig-audit/report-template.md` with this header:
```markdown
# Report Template — GNOME HIG UI/UX Audit

Markdown template for producing scored audit reports.
```

- [ ] **Step 4: Create `quick-audit.md`**

Extract verbatim from the current `SKILL.md`:
- `## 15. Quick Audit (5-Minute Triage)`
- `## 16. Known HIG Patterns to Compare Against`

Write to `.agents/skills/gnome-hig-audit/quick-audit.md` with this header:
```markdown
# Quick Audit — GNOME HIG UI/UX Audit

5-minute triage checklist and GNOME reference application comparisons.
```

---

### Task 10: gnome-hig-audit — Rewrite SKILL.md

**Files:**
- Modify: `.agents/skills/gnome-hig-audit/SKILL.md`

- [ ] **Step 1: Write the new brief SKILL.md**

Overwrite `.agents/skills/gnome-hig-audit/SKILL.md` with:

```markdown
---
name: gnome-hig-audit
description: Evaluate Arbesk Studio UI/UX against GNOME Human Interface Guidelines. Audits color themes (contrast ratios, dark/light mode), layout (panel sizing, spacing), typography, keyboard navigation, accessibility (ARIA, focus, reduced motion), responsive breakpoints, and interaction patterns. Use when asked to "audit the UI", "check GNOME HIG compliance", "evaluate UX", "review color themes", or "assess accessibility".
---

# GNOME HIG UI/UX Audit — Arbesk Studio

Use this skill when asked to audit, evaluate, or review the Arbesk Studio frontend against GNOME Human Interface Guidelines (HIG). The audit produces a scored report with specific, actionable recommendations per violation.

> **Priority Context**: Arbesk Studio is a **Web 3.0 application** running in a browser, not a native desktop GTK app. GNOME HIG is used as a **design reference and inspiration**, but **WCAG 2.1 is the primary accessibility standard**. Where GNOME HIG and WCAG conflict, WCAG wins.

## Quick Decision

| Question | Action |
|----------|--------|
| Full audit requested? | Run all 10 categories (A–J). See [→ Checklists](./checklists.md) |
| Quick triage only? | Check the 7 high-signal items. See [→ Quick Audit](./quick-audit.md) |
| Need to write a report? | Use the scored report template. See [→ Report Template](./report-template.md) |
| Which app to compare against? | **GNOME Builder** for IDE-like layout; **Nautilus** for sidebar; **GNOME Text Editor** for header bar. See [→ Quick Audit](./quick-audit.md) |

## Audit Categories

| # | Category | Weight | What it covers |
|---|----------|--------|----------------|
| A | Color & Theming | 1.0 | Contrast ratios, dark/light parity, semantic color |
| B | Typography | 0.8 | Font hierarchy, line heights, heading levels |
| C | Layout & Spacing | 1.0 | Panel sizing, spacing scale, grid alignment |
| D | Buttons & Controls | 1.0 | Touch targets, states, variants, icon-only |
| E | Keyboard Navigation | 1.2 | Shortcuts, discoverability, focus order, guards |
| F | Accessibility | 1.2 | WCAG 2.1 AA/AAA, ARIA, focus rings, reduced motion |
| G | Forms & Input | 0.8 | Labels, placeholders, errors, help text |
| H | Dialogs & Modals | 0.8 | Focus trap, Escape dismiss, backdrop, animation |
| I | Responsive Design | 0.8 | Breakpoints, touch targets, overflow |
| J | Empty States & Feedback | 0.6 | Welcome, loading, error, idle states |

### Score interpretation

| Range | Rating | Action |
|-------|--------|--------|
| 90–100 | ✅ Excellent | Minor polish only |
| 80–89 | 👍 Good | A few improvements recommended |
| 65–79 | ⚠️ Fair | Several violations need attention |
| 50–64 | 🔶 Poor | Significant HIG gaps |
| <50 | 🔴 Critical | Major rework needed |

## Deep Reference

| Topic | File |
|-------|------|
| Full 10-Category Checklists (A–J), Scoring, How to Run | [→ Checklists](./checklists.md) |
| Scored Report Markdown Template | [→ Report Template](./report-template.md) |
| 5-Minute Triage & GNOME Reference Apps | [→ Quick Audit](./quick-audit.md) |
```

- [ ] **Step 2: Verify line count**

Run: `wc -l .agents/skills/gnome-hig-audit/SKILL.md`
Expected: ~70 lines.

---

### Task 11: solidity-smart-contracts — Create Companion Files

**Files:**
- Create: `.agents/skills/solidity-smart-contracts/deep-dive.md`
- Create: `.agents/skills/solidity-smart-contracts/contract-deep-dive.md`
- Create: `.agents/skills/solidity-smart-contracts/deployment-pipeline.md`
- Create: `.agents/skills/solidity-smart-contracts/debugging.md`
- Create: `.agents/skills/solidity-smart-contracts/checklists.md`
- Create: `.agents/skills/solidity-smart-contracts/smart-accounts.md`
- Create: `.agents/skills/solidity-smart-contracts/session-auth.md`
- Create: `.agents/skills/solidity-smart-contracts/quick-reference.md`

- [ ] **Step 1: Read current SKILL.md**

Run: `cat .agents/skills/solidity-smart-contracts/SKILL.md`
Expected: 913 lines.

- [ ] **Step 2: Create `deep-dive.md`**

Extract verbatim from the current `SKILL.md`:
- `## 1. General Solidity Expertise` (through the end of `### Gas Optimization Checklist`)

Write to `.agents/skills/solidity-smart-contracts/deep-dive.md` with this header:
```markdown
# Deep Dive — Solidity Smart Contracts

General Solidity expertise: architecture principles, common patterns, OpenZeppelin v5 changes, and gas optimization.
```

- [ ] **Step 3: Create `contract-deep-dive.md`**

Extract verbatim from the current `SKILL.md`:
- `## 2. Arbesk Contract Deep Dive (Reference Implementation)` through the end of `### MockUSDC (Local Testing)`

Write to `.agents/skills/solidity-smart-contracts/contract-deep-dive.md` with this header:
```markdown
# Contract Deep Dive — ArbeskAsset.sol

Full Arbesk contract reference: inheritance, storage layout, function inventory, event signatures, tier pricing, and MockUSDC.
```

- [ ] **Step 4: Create `deployment-pipeline.md`**

Extract verbatim from the current `SKILL.md`:
- `## 3. Deployment Pipeline & Address Alignment`
- `## 8. Multi-Network Deployment (Hardhat Local + Base Sepolia)`
- Include `## 7. Adding a New Function to the Contract` (the deployment steps at the end)

Write to `.agents/skills/solidity-smart-contracts/deployment-pipeline.md` with this header:
```markdown
# Deployment Pipeline — Solidity Smart Contracts

Compile → deploy → address alignment → multi-network config. Adding new networks and new contract functions.
```

- [ ] **Step 5: Create `debugging.md`**

Extract verbatim from the current `SKILL.md`:
- `## 4. Debugging Smart Contracts`

Write to `.agents/skills/solidity-smart-contracts/debugging.md` with this header:
```markdown
# Debugging — Solidity Smart Contracts

Hardhat console, inline `console.log`, event decoding, common scenarios, on-chain inspection, and test execution.
```

- [ ] **Step 6: Create `checklists.md`**

Extract verbatim from the current `SKILL.md`:
- `## 5. Integration Verification Checklist`

Write to `.agents/skills/solidity-smart-contracts/checklists.md` with this header:
```markdown
# Checklists — Solidity Smart Contracts

5-phase integration verification: compile, deploy, address alignment, on-chain, functional.
```

- [ ] **Step 7: Create `smart-accounts.md`**

Extract verbatim from the current `SKILL.md`:
- `## 9. Smart Accounts (ERC-4337) & Proxy Contract Validation`

Write to `.agents/skills/solidity-smart-contracts/smart-accounts.md` with this header:
```markdown
# Smart Accounts (ERC-4337) — Solidity Smart Contracts

Proxy/bundler validation, event-based proof, MetaMask Smart Transactions, and Brave Wallet notes.
```

- [ ] **Step 8: Create `session-auth.md`**

Extract verbatim from the current `SKILL.md`:
- `## 10. Session Authentication Pitfalls`

Write to `.agents/skills/solidity-smart-contracts/session-auth.md` with this header:
```markdown
# Session Authentication Pitfalls — Solidity Smart Contracts

SIWE session flow, case-sensitive address bug, caching rules, backend store, and chain ID support.
```

- [ ] **Step 9: Create `quick-reference.md`**

Extract verbatim from the current `SKILL.md`:
- `## 11. Quick Reference Card`

Write to `.agents/skills/solidity-smart-contracts/quick-reference.md` with this header:
```markdown
# Quick Reference Card — ArbeskAsset

ASCII cheat sheet with all constants, commands, and endpoints.
```

---

### Task 12: solidity-smart-contracts — Rewrite SKILL.md

**Files:**
- Modify: `.agents/skills/solidity-smart-contracts/SKILL.md`

- [ ] **Step 1: Write the new brief SKILL.md**

Overwrite `.agents/skills/solidity-smart-contracts/SKILL.md` with:

```markdown
---
name: solidity-smart-contracts
description: Expert guidance on Solidity smart contract architecture, deployment, debugging, and address alignment verification. Covers ERC721 NFTs, PayGo payment patterns, OpenZeppelin v5, Hardhat tooling, multi-network deployment, smart account (ERC-4337) proxy validation, session auth debugging, and the full compile→deploy→verify→integrate pipeline. Use when asked to "debug the contract", "check contract address alignment", "deploy contracts", "audit the contract", "add a function to the contract", "explain the payment flow", "smart account", "proxy contract", "session auth", or any Solidity/smart-contract question.
---

# Solidity Smart Contract Expertise

Use this skill for any task involving Solidity smart contracts: architecture review, function implementation, deployment, debugging, address alignment, event verification, smart account proxy handling, session authentication debugging, test coverage, or security audit.

## Quick Decision

| Question | Action |
|----------|--------|
| `c.methods.X is not a function`? | Stale ABI. Recompile: `docker-compose run --rm hardhat npx hardhat compile`. See [→ Deployment Pipeline](./deployment-pipeline.md) |
| `Transaction reverted` / `WRONG_CONTRACT`? | Address mismatch. Check root `.env` vs `blockchain/.env`. See [→ Deployment Pipeline](./deployment-pipeline.md) |
| `WRONG_CONTRACT` with MetaMask? | Smart account proxy. Validate events, not `receipt.to`. See [→ Smart Accounts](./smart-accounts.md) |
| Session signing every request? | Case-sensitive address bug in localStorage. See [→ Session Auth](./session-auth.md) |
| Need to add a contract function? | Write Solidity → add tests → add to `REQUIRED_ABI_FUNCTIONS` → recompile → redeploy → sync `.env`. See [→ Deployment Pipeline](./deployment-pipeline.md) |
| Debugging a failed generation tx? | Check `[GEN]` logs, validate receipt, decode events. See [→ Debugging](./debugging.md) |

## Contract Overview

**File:** `blockchain/contracts/ArbeskAsset.sol`
**Solidity:** `^0.8.20` (compiled 0.8.24, Cancun EVM)
**Dependencies:** OpenZeppelin v5 — ERC721Enumerable, Ownable, ReentrancyGuard, Pausable
**Test file:** `blockchain/test/ArbeskAsset.test.js` (~856 lines, 30+ test cases)
**Security audit:** `blockchain/SECURITY.md` (6 documented findings)

### Storage Layout (key variables)

| Variable | Type | Notes |
|----------|------|-------|
| `costPerGeneration` | `uint256` | 0.01 ether default |
| `tierCosts` | `mapping(Tier => uint256)` | 4 tiers, 6-decimal USDC |
| `usdcToken` | `IERC20` | address(0) = disabled |
| `developerTreasuryWallet` | `address` | All payments go here |
| `usedPayments` | `mapping(bytes32 => bool)` | Per-block replay guard |

### Function Categories

- **Payment — Native:** `payForGeneration(bytes32,string)` — payable, nonReentrant
- **Payment — USDC:** `payForGenerationWithUSDC(bytes32,string,uint8)` — tiered ERC-20
- **NFT Minting:** `publishAsset(string,uint256)`, `tokenURI(uint256)`, `totalSupply()`
- **Collaboration:** `updateAssetURI`, `addEditor`, `removeEditor`, `listEditors`, `listTokens`
- **Admin:** `setCost`, `setTreasury`, `setUsdcToken`, `setTierCost`, `pause`, `unpause`, `withdraw`

### Tier Pricing (6-decimal USDC)

| Tier | Value | Default Cost | USD |
|------|-------|-------------|-----|
| Basic | 0 | 750,000 | $0.75 |
| Standard | 1 | 1,250,000 | $1.25 |
| Premium | 2 | 1,750,000 | $1.75 |
| Pro | 3 | 2,500,000 | $2.50 |

### Event Signatures (keccak256 topic[0])

```
AssetGenerationPaid(address,bytes32,string,uint256,uint256)
AssetGenerationPaidUSDC(address,bytes32,string,uint256,uint256,uint8)
AssetPublished(address,uint256,string)
EditorAdded(uint256,address)
EditorRemoved(uint256,address)
AssetURIUpdated(uint256,string)
```

## Key Rules

1. **Lowercase ALL addresses** in storage and comparison — prevents case-mismatch session bugs.
2. **Every state-changing function emits an event** — required for smart account proxy validation.
3. **Validate `log.address`, not `receipt.to`** — proxy transactions route through bundlers.
4. **Always run `npm run test:frontend`** after any `.sol` change — catches ABI staleness and address misalignment.
5. **Sync `CONTRACT_ADDRESS`** from `blockchain/.env` → root `.env` after every deploy.
6. **OZ v5 breaking change:** override `_update`, not `_beforeTokenTransfer`.
7. **Gas:** use `immutable` for constructor values, `calldata` for params, pack storage slots.

## File Map

| File | Role | Details |
|------|------|---------|
| `blockchain/contracts/ArbeskAsset.sol` | Main contract | [→ Contract Deep Dive](./contract-deep-dive.md) |
| `blockchain/contracts/mock/MockUSDC.sol` | Local testing USDC | [→ Contract Deep Dive](./contract-deep-dive.md) |
| `blockchain/hardhat.config.js` | Hardhat config | [→ Deployment Pipeline](./deployment-pipeline.md) |
| `blockchain/scripts/deploy.js` | Deploy script | [→ Deployment Pipeline](./deployment-pipeline.md) |
| `blockchain/scripts/verify.js` | Block explorer verify | [→ Deployment Pipeline](./deployment-pipeline.md) |
| `blockchain/test/ArbeskAsset.test.js` | Contract test suite | [→ Debugging](./debugging.md) |
| `test/frontend/deployment-integrity.test.js` | Address + ABI integrity | [→ Checklists](./checklists.md) |
| `src/api/assets/generate-node.js` | Tx validation backend | [→ Smart Accounts](./smart-accounts.md) |
| `src/api/sessions.js` | Session store | [→ Session Auth](./session-auth.md) |
| `frontend/src/js/blockchain/wallet.js` | Web3Modal, contract init | [→ Session Auth](./session-auth.md) |

## Deep Reference

| Topic | File |
|-------|------|
| General Solidity, OZ v5, Patterns, Gas | [→ Deep Dive](./deep-dive.md) |
| Arbesk Contract: Storage, Functions, Events, Tiers | [→ Contract Deep Dive](./contract-deep-dive.md) |
| Compile → Deploy → Address Sync → Multi-Network | [→ Deployment Pipeline](./deployment-pipeline.md) |
| Hardhat Console, Event Decoding, Common Scenarios | [→ Debugging](./debugging.md) |
| 5-Phase Integration Verification | [→ Checklists](./checklists.md) |
| ERC-4337 Proxy / Smart Account Validation | [→ Smart Accounts](./smart-accounts.md) |
| SIWE Sessions, Case-Sensitive Address Bug | [→ Session Auth](./session-auth.md) |
| ASCII Quick Reference Card | [→ Quick Reference](./quick-reference.md) |
```

- [ ] **Step 2: Verify line count**

Run: `wc -l .agents/skills/solidity-smart-contracts/SKILL.md`
Expected: ~130 lines.

---

### Task 13: Verify All Relative Links

**Files:**
- Test: All `.agents/skills/*/SKILL.md`

- [ ] **Step 1: Find all relative links in SKILL.md files**

Run:
```bash
grep -rhn '\[.*\](\./' .agents/skills/*/SKILL.md
```
Expected: A list of all `](./filename.md)` links across all 6 modified skills.

- [ ] **Step 2: Verify each linked file exists**

Run:
```bash
for skill in .agents/skills/*/; do
  echo "=== $(basename $skill) ==="
  grep -oP '\[→[^\]]+\]\(\K[^)]+' "$skill/SKILL.md" | while read link; do
    if [ -f "$skill$link" ]; then
      echo "  ✓ $link"
    else
      echo "  ✗ MISSING: $link"
    fi
  done
done
```
Expected: All links show `✓`. Zero `✗ MISSING`.

- [ ] **Step 3: Verify no SKILL.md exceeds 200 lines**

Run:
```bash
for f in .agents/skills/*/SKILL.md; do
  lines=$(wc -l < "$f")
  skill=$(dirname "$f" | xargs basename)
  if [ "$lines" -gt 200 ]; then
    echo "  ✗ TOO LONG ($lines): $skill"
  else
    echo "  ✓ $lines lines: $skill"
  fi
done
```
Expected: All skills show `✓` with ≤200 lines. `babylon-memory-leaks` unchanged at 139.

- [ ] **Step 4: Verify no content was accidentally deleted**

Run:
```bash
# Total lines across all SKILL.md + companions should be >= original total
total_skills=$(find .agents/skills -name '*.md' | xargs wc -l | tail -1 | awk '{print $1}')
echo "Total markdown lines across all skills: $total_skills"
```
Expected: Total should be at least 3000+ lines (original 7 skills = 3340 lines; companions add headers, so total should be slightly higher).

- [ ] **Step 5: Commit**

```bash
git add .agents/skills/
git status
git commit -m "refactor(skills): brief entry points with companion reference files

- Split 6 overloaded SKILL.md files into brief entry points (55-130 lines)
- Move deep content to companion .md files in same skill folders
- Standardize template: triggers → quick decisions → key rules → file map → deep links
- Keep babylon-memory-leaks untouched (already follows pattern)
- Add verification: all relative links resolve, no SKILL.md > 200 lines"
```

---

## Plan Self-Review

**Spec coverage:** Every skill in the design doc has a corresponding task. `babylon-memory-leaks` is explicitly untouched. Every companion file from the design doc is created in a step.

**Placeholder scan:** No TBD, TODO, "implement later", or vague instructions. Every step specifies exact file paths. SKILL.md rewrites include exact content. Companion file creation specifies exact section headers to extract.

**Type consistency:** All companion file names use kebab-case. All SKILL.md files use the same template structure. All relative links use `./filename.md` format.

**Link integrity:** Task 13 is a dedicated verification task that checks every relative link resolves to an existing file.
