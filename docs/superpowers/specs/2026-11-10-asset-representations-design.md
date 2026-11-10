# Asset representations — design

Date: 2026-11-10 · Status: accepted (owner asked for full automation)

## Goal

One Arbesk asset, many files of the same design. A bracket is a Blender
`.blend` to edit, a 3MF to slice, an STL to share, a GLB to view, and the
G-code a slicer made for one printer. Today an asset holds one model; the
other files live elsewhere, lose their link to the model, and nobody can
tell a G-code sliced from last week's model from today's.

An asset manifest gains a list of **representations**: other files of the
same asset, each with a role, a format and what it was made from. Clients
(the Studio, `besk`, File Browser) show one asset and let the user pick the
file a task needs: Blender opens the `.blend`, a slicer the 3MF, a printer
gets the G-code.

Out of scope here: slicing, printing, a G-code viewer, editing
representations in the Studio UI. This spec defines the stored format, keeps
it through every save, and gives `besk` and asset-core what clients need.

## Decisions

**R1. A new top-level manifest field, `representations`.** An optional
array on asset manifests (not collections):

```json
"representations": [
  {
    "id": "source",
    "role": "source",
    "format": "blend",
    "name": "Bracket.blend",
    "cid": "bafy…",
    "bytes": 4812331,
    "encoding": "raw",
    "created_at": 1793900000000
  },
  {
    "id": "gcode-prusa-mk4-petg",
    "role": "machine",
    "format": "gcode",
    "name": "Bracket_0.2mm_PETG_MK4.gcode",
    "cid": "bafy…",
    "bytes": 812331,
    "encoding": "brotli",
    "derived_from": { "ref": "primary", "cid": "bafy…" },
    "tool": { "name": "PrusaSlicer", "version": "2.9.2" },
    "profile": { "printer": "Original Prusa MK4", "material": "PETG", "layer_mm": 0.2, "nozzle_mm": 0.4 },
    "stats": { "print_time_s": 7420, "filament_g": 38.5 },
    "created_at": 1793900000000
  }
]
```

- `id`: unique within the asset, `[a-z0-9-]{1,64}`; the key clients and
  `derived_from` use. `primary` is reserved for the asset's own model
  (`scene.nodes[0].source`), which stays where it is and is never in this
  list.
- `role`: `source` (editable original: `.blend`, `.step`, `.f3d`), `mesh`
  (`.stl`, `.obj`), `view` (`.glb`, `.gltf`, `.usdz`), `machine` (`.gcode`,
  `.bgcode`, `.3mf` with plates sliced), `other`.
- `format`: the lower-case extension without a dot.
- `name`: the file name to give the bytes when they are written out.
- `encoding`: `raw`, or `brotli` (asset-core's brotli frame, the one parts
  use). Text formats (`gcode`, `gltf`, `obj`, `step`) are stored brotli;
  binary ones raw.
- `derived_from` (optional): `ref` is `primary` or another representation's
  `id`; `cid` is that file's CID when this one was made.
- `tool`, `profile`, `stats` (optional): free-form, small (each at most 32
  keys, string or number values).

**R2. Stale is computed, never stored.** A representation is stale when its
`derived_from.cid` no longer equals the current CID of what it refers to (the
primary model's `scene.nodes[0].source.cid`, or the other representation's
`cid`). Every client computes the same answer from the same manifest;
asset-core exports `isStale(manifest, rep)`.

*Amended after review:* a rescale changes what a slicer prints without
changing the source CID, so an entry derived from `primary` also records node
0's `transform_matrix` (`derived_from.transform_matrix`, optional) and is
stale when it differs. `primary` is node 0 only: other nodes, child_refs and
their order are not compared, a live child_ref primary has no CID, and the
Studio's first save of a monolithic generation output decomposes it to a new
CID (a false "stale", the safe direction).

**R3. Every save carries the list forward.** Zod strips unknown keys, and
today's save paths build the next manifest from a parsed copy, so a field
that only one client knows would disappear on the next Studio save. So the
field is part of the canonical schema (`manifestSchema`), and every path that
builds an asset's next manifest from its previous one copies
`representations` unchanged unless that path is the one changing it:

- the Studio's save/publish (`services/asset-save/manifest-builder.ts` and
  the flows that call it),
- `besk`'s writes (`metadata.ts`, `link.ts`, `upload`, `rename`, `send`),
- asset-core's collection/asset helpers that copy manifests.

A test per path saves an asset with representations and asserts the next
manifest still has them. A model change does not drop them either: they
become stale (R2), which is the point.

*Amended after review:* carrying the list needs the real previous version.
The Studio's save takes the collection entry as the chain tip when it
descends from the version the Studio opened (a `besk attach` made while the
Studio was open), and refuses to save when the tip cannot be read rather than
fall back to its base. A generation follow-up refuses to build on a previous
version it cannot read. Library Rename writes the next version (version + 1,
prev link) from the current entry. Every write replaces the collection entry
only while it still names the CID it built from (compare-and-swap in the
collection mutator); otherwise it fails and asks to retry. Older clients
(before this release) drop the field; the version before keeps it, so it is
recoverable by re-attaching.

**R4. Adding one is a new version.** Attaching, replacing or removing a
representation writes the next asset manifest (version + 1,
`prev_asset_manifest_cid` → the current one) and updates the collection, like
any save. History shows "Added G-code (Original Prusa MK4, PETG)". An
earlier version keeps its own representations, so stepping back shows which
G-code went with which model.

**R5. asset-core owns the format; clients don't hand-roll it.** asset-core
gains, in `manifest/representations.ts` and exported from the package:
`representationSchema`, `listRepresentations(manifest)`,
`isStale(manifest, rep)`, `withRepresentation(manifest, rep)` (add or replace
by `id`, returns a new manifest), `withoutRepresentation(manifest, id)`,
`encodeRepresentation(bytes, format)` / `decodeRepresentation(bytes, rep)`
(brotli frame or raw), and `representationId(role, format, profile?)` (a
stable slug, e.g. `gcode-original-prusa-mk4-petg`). Each is pure and tested.
The encode/decode pair lives in `manifest/representation-codec.ts`, so the
rest stays worker-safe (no fflate or brotli-wasm); `hasRoomFor` and
`derivedFromOf` were added for the pre-upload checks.

**R6. `besk` can attach and fetch them.** Following the CLI↔MCP parity
rule:

- `besk attach <asset> <file> [--role R] [--id ID] [--from primary|ID]
  [--printer …] [--material …] [--layer …] [--nozzle …]` (MCP
  `attach_representation`): uploads the file, records it as R1 with
  `derived_from` the current CID of `--from` (default `primary` for `machine`
  and `mesh`, none for `source`), writes the next version.
- `besk detach <asset> <id>` (MCP `detach_representation`).
- `besk history` and MCP `asset_history` name each version's
  representation changes (added, replaced, removed).
- `besk info` lists representations with a stale marker; `besk download
  <asset> --rep <id>` (MCP `download_asset` gains `representation`) writes
  that file instead of the model.

**R7. Limits.** One asset holds at most 32 representations; one file at most
256 MB (G-code for a long print is large; it compresses well). Everything on
IPFS is public: `besk attach` says so before uploading a `source` file, which
can carry more than the model (other scenes, embedded images).

**R8. No contract or backend route change.** Representations are uploaded
with the existing upload URLs and saved with the existing collection update;
the indexer never reads them.

*Amended after review:* the backend's IPFS GC must. It unpins every pinned
CID its chain walker does not reach once the grace period ends, so the walker
(`src/api/manifest-chain-walker.ts`) counts each listed `cid` as reachable
and shared: a live asset's files stay pinned, a burned one's are reclaimed by
GC once no live chain lists them.

## Testing

- asset-core: schema accepts and rejects (ids, roles, encodings, sizes,
  limits); every helper in R5; `isStale` for primary and chained refs;
  brotli round trip.
- Carry-forward (R3): one test per save path.
- `besk`: attach / detach / download / info against the in-memory test
  storage, and the MCP tools' parity.
- E2E: a Studio save of an asset with representations keeps them
  (`e2e/specs`), per AGENTS.md's rule for manifest-schema changes.

## Files

`packages/asset-core/src/manifest/schema.ts`,
`packages/asset-core/src/manifest/representations.ts` (new),
`packages/asset-core/src/index.ts`, `docs/ASSET_CORE_SDK.md`,
`docs/ARCHITECTURE.md` §4 (manifest schema),
`frontend/src/js/services/asset-save/manifest-builder.ts` and the paths R3
names, `packages/besk/src/` (cli, mcp, metadata, a new `representations.ts`),
tests beside each.
