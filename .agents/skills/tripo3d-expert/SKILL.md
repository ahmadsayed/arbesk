---
name: tripo3d-expert
description: Use when working with the Tripo3D API (v3) — generation, retopology/decimate, rigging, animation retarget, format conversion; debugging tiny/distorted/FBX-instead-of-GLB models, "not riggable" errors, code 1004/2010/1002, wrong output format, or building an adapter/driver for Tripo or another 3D generation provider.
---

# Tripo3D Expert (v3 API)

Reference and trap guide for the Tripo3D v3 API as integrated in Arbesk (`src/api/adapters/tripo3d-adapter.js`). Every rule below was verified against the official docs (developers.tripo3d.com) or reproduced live against the API — dates noted where behavior was observed to differ from docs.

## Quick Decision Table

| Symptom | Cause → fix |
|---------|-------------|
| Result is FBX, not GLB (web pipeline can't load it) | `quad: true` anywhere (generation, decimate, convert) **forces FBX output** — glTF cannot store quads. Use `quad: false` → rule 1 |
| Model arrives tiny in the viewport | `auto_size` defaults to `false` — models come in arbitrary units. Pass `auto_size: true` (meters) |
| Retopo'd model has melted eyes/face | Adaptive decimate is extremely aggressive (~1% of source polys). Pass explicit `face_limit` near the v2.0 max (20,000 tris) |
| Code 1004 on rig | Rig has its own model line; the retired default is rejected. Use `v1.0-20240301` (biped) or `v2.5-20260210` (creatures) → rule 4 |
| Code 2006 on refine | `refine_model` endpoint is dead. Use `POST /models/texture` (texture-only refine) |
| Code 1002 / 2010 | Auth failed (401) / insufficient credits (402) |
| "Not riggable" | Source isn't a clear full-body humanoid/creature. T-pose full-body rigs best; retopo first if mesh is chaotic |
| Rig has no fingers/face bones | Expected — Tripo auto-rig is a minimal skeleton (~26 joints). Production rigs need Blender (ARP/Rigify) → rule 6 |
| Download URL expires | Output URLs are signed (Policy/Signature/Expires). Download promptly; don't store URLs |

## API Essentials

- **Base URL**: `https://openapi.tripo3d.ai/v3` (global); `https://openapi.tripo3d.com/v3` (China). Auth: `Authorization: Bearer <key>` on every call.
- **Async pattern everywhere**: `POST <endpoint>` → `{code:0, data:{task_id}}` → poll `GET /tasks/{task_id}` → statuses `queued`/`running`/`success`/`failed`/`cancelled`/`banned`/`expired`. Error envelope: non-zero `code` + `message` + `suggestion`.
- Task IDs are UUIDs in practice (docs show `task_abc123` placeholders — don't pattern-match the prefix).
- Success output: `output.model_url` (fall back to `pbr_model`/`model`/`base_model`). Rig-check returns flags instead: `output.riggable` + `output.rig_type`.
- Credits: text/image-to-3D ~20–100 · rig-check 0 · rig 30 · retarget 20 · decimate v2.0 30 / v1.0 10.

## Model Versions

| Purpose | Version | Notes |
|---------|---------|-------|
| Generation (default) | `v3.1-20260211` | H3.1 "HD" — best quality, PBR by default |
| Generation (stable) | `v3.0-20250812` | |
| Generation (turbo) | `v2.5-20250123` | Faster, lighter; **lacks** `texture_quality`/`geometry_quality`/`auto_size`/`quad`/`smart_low_poly` (those need ≥ v3.0) |
| Rig — humanoid biped | `v1.0-20240301` | 90+ biped presets (`preset:biped:*`) |
| Rig — creatures | `v2.5-20260210` | quadruped/hexapod/octopod/serpentine/aquatic/avian + 11 generic biped presets (`preset:idle`…) |

## Hard Rules (the traps, all verified)

1. **`quad: true` forces FBX output — everywhere.** glTF only stores triangles, so generation, `mesh/decimate`, and `models/convert` all emit FBX when quad is on. A glTF/Babylon pipeline must use `quad: false`. The smart-retopo topology rebuild happens either way; quad is only the polygon encoding. (Reproduced live 2026-08-02: decimate quad=true → `.fbx` in `model_url`; quad=false → valid `.glb`.)
2. **`auto_size` defaults to `false`** — generation arrives in arbitrary units, often tiny. `auto_size: true` scales to estimated real-world meters. It's an AI estimate; misjudgments happen.
3. **Decimate `model: "v2.0"` (smart retopology) with omitted `face_limit` is adaptive and brutal** — observed 1.48M → 11.5K polys. Faces/eyes collapse first, then the texture bake smears over the simplified UVs. For faces, set `face_limit` explicitly (v2.0 triangle: 500–20,000; quad: 500–10,000). v1.0 is plain decimation (required `face_limit`, up to 2M tris) — preserves detail, doesn't rebuild topology.
4. **Rig has a separate model line from generation.** Docs (2026-08): `v1.0-20240301` = biped humanoid, recommended, 90+ presets; `v2.5-20260210` = non-humanoid creatures. The Arbesk adapter defaults to `v2.5-20260210` because the docs-default was rejected with code 1004 when verified 2026-08-02 — if humanoid rig quality matters, re-test `v1.0-20240301` (and switch presets to the `preset:biped:*` namespace).
5. **Retarget input is the RIG task id, not the generation task id** — and `input` is a **plain string**, not an object: `{"input": "<rig task_id>", "animations": [...], "out_format": "glb"}` (single preset: `animation` instead of `animations` — mutually exclusive). Chain: `rig-check(input=gen task)` → `rig(input=gen task, rig_type from check, spec, model)` → `retarget(input=rig task, …)`. To animate an already-rigged task, skip straight to retarget — no need to re-rig. Retarget extras: `bake_animation` (glb only), `export_with_geometry`, `animate_in_place`. v1.0 preset IDs are numbered: `preset:biped:dance_01`, `preset:biped:wave_goodbye_01`, `preset:biped:idle`, … (full list in the retarget docs).
6. **Auto-rigs are never production rigs.** Tripo's skeleton is minimal (no fingers, no toes, no face bones, no IK). For hero characters: generate → smart-retopo → rig for quick results, then finish in Blender (Auto-Rig Pro / Rigify) or re-rig via Mixamo/AccuRIG/Meshy.
7. **`refine_model` is dead (code 2006).** Texture-only refine = `POST /models/texture {input, text_prompt, texture:true, pbr:true}`.
8. **File-bearing endpoints** (`decimate`, `convert`, `rig`, `rig-check`) accept `task_id`, `file_token` (upload via `POST /files`), or a public URL. Max 150 MB; formats GLB/glTF/FBX/OBJ/STL (rig-check: GLB only). Choose exactly one input type.

## Generation Parameters That Matter

- `texture_quality`: `standard` | `detailed` | `extreme` (8K). Texture-only upgrade — does nothing for geometry/topology, so it does NOT help rigging; it does give the decimate bake a better source.
- `geometry_quality: "detailed"` — Ultra geometry (≥ v3.0).
- `face_limit` at generation: adaptive if omitted; table max 1.5M (v3.1). Game-ready target 50–100K.
- `smart_low_poly: true` — clean hand-crafted-style topology, fixed 500–20K faces; best for simple inputs.
- `model_seed` / `texture_seed` / `image_seed` — reproducibility; vary `texture_seed` alone for same mesh, new texture.
- `negative_prompt`, `export_uv`, `compress: "geometry"` (meshopt).
- Image-to-3D quality is dominated by the source image: prefer 3D-render/photographic look, even lighting, no outlines, plain background, full-body T/A-pose for characters. 2D stylization (line art, cel shading) becomes geometry artifacts that retopo then bakes in.

## Recipes

**Hero character for web animation:**
1. `generation/text-to-model` — `model: v3.1-20260211`, `texture: true`, `pbr: true`, `auto_size: true`, optionally `texture_quality: "detailed"`.
2. `mesh/decimate` — `model: "v2.0"`, `quad: false`, `bake: true`, explicit `face_limit` (≈20K for faces).
3. `animations/rig-check` → `animations/rig` — `spec: "mixamo"`, rig model per creature type (rule 4).
4. `animations/retarget` — `input: <rig task>`, `animations: [...]`, `out_format: "glb"`.

**Adapter/driver checklist (any provider):** async create+poll with terminal-state mapping · auth/credit errors mapped to 401/402 · provider model versions as env-overridable constants (providers retire versions) · validate output format AND magic bytes before handing to the renderer · BYOK keys transient per request, never logged.

## Key Files (Arbesk)

- `src/api/adapters/tripo3d-adapter.js` — the reference adapter (create/image/refine/decimate/rig/retarget/poll/download, `TripoApiError`)
- `src/api/assets/generate-node.js` — routes: BYOK gating, task registry, animate chain (rig-check → rig → retarget + retarget-only path), retopo route
- `src/api/schemas.js` — request validation (`ANIMATION_PRESETS` = the 11 v2.5 biped presets)
- Frontend: `services/api.js` (`generateAsset`), `ui/create-panel.js` (HQ checkbox, retopo/animate chips)

## References

- Generation: https://developers.tripo3d.com/en/docs/generation-text-to-model/standard
- Retopology: https://developers.tripo3d.com/en/docs/mesh-decimate
- Convert: https://developers.tripo3d.com/en/docs/models-convert
- Rig: https://developers.tripo3d.com/en/docs/animations-rig · rig-check: /animations-rig-check · retarget (full 90+ preset list): /animations-retarget
