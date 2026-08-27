# @arbesk/ai-asset-gen — 3D model generation SDK

Capability-gated facade over the **mock** and **Tripo3D** providers.

## Purpose

One facade for 3D-model generation and its follow-up pipeline, regardless of
which backend drives it. Providers declare a **capability set** (text-to-3D,
image-to-3D, multiview-to-3D, retexture, retopo, rig-check, rig, animate,
balance) and every method is gated on it — callers branch on *capability*,
never on provider kind.

## Boundary

- **Backend-only**: uses Node globals (Buffer, fs, path, fetch, FormData,
  AbortSignal). Not imported by the browser.
- No imports from frontend/, src/api/, or constants/.
- No in-repo package deps — independent of the wallet/authz/asset-core packages.
- Follow-up ops take a **SourceRef** (fileToken | buffer | cid); the cid kind is
  resolved by an injected **sourceResolver** port, so IPFS reads and glTF
  composition stay in the backend.

## Facade

createGenerationProvider(config) → GenerationProvider:

- config.id: "mock" | "tripo3d"
- config.apiKey: BYOK key (Tripo3D only)
- config.sourceResolver: (cid) => Uint8Array (follow-ups)
- config.capabilities: declared capability set

Uniform lifecycle: start (each capability method) → poll →
download(taskIdOrUrl) / cancel. Mock collapses to "immediately success".

## Reference

Tripo3D API details: the **tripo3d-expert** skill. Raw adapter:
src/providers/tripo.ts (moved from src/api/adapters/tripo3d-adapter.ts).
