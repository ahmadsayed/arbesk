# Update Docs for Asset-Core SDK

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline docs sweep)

**Goal:** Update project documentation and skill references to reflect the new `frontend/src/js/asset-core` SDK, its port-based architecture, facade, and correct stale file paths.

**Architecture:** Asset-core is now a platform-agnostic library under `frontend/src/js/asset-core/`. Consumers use `createArbeskCore(...)` with injected ports (`IpfsReadPort`, `IpfsWritePort`, `CredentialPort`, `ChainPort`, `HashPort`, `StoragePort`, `ExecutorPort`). Browser adapters live in `frontend/src/js/asset-core-init.ts`, `services/`, `ipfs/`, `blockchain/`, `workers/`. Backend adapters live in `src/api/`.

**Tech Stack:** TypeScript, Node type-stripping, glTF/GLB, IPFS, Merkle editor proofs.

**Spec:** User request + existing `docs/ASSET_CORE_SDK.md`.

## Global Constraints
- Do not change code behavior; this is documentation-only.
- Keep edits minimal and targeted.
- Preserve existing formatting and section ordering.
- Commit as a single docs sweep commit.

## Task 1: Read Current Documentation and Skill Files

**Files:**
- Read: `docs/ARCHITECTURE.md`
- Read: `docs/CURRENT_STATUS.md`
- Read: `docs/MERKLE_IMPLEMENTATION.md`
- Read: `docs/MEGAETH_ANALYSIS.md`
- Read: `.agents/skills/arbesk-gltf-pipeline/SKILL.md`
- Read: `.agents/skills/arbesk-gltf-pipeline/references/deep-dive.md`
- Read: `.agents/skills/arbesk-gltf-pipeline/references/troubleshooting.md`
- Read: `.agents/skills/arbesk-ipfs-storage/SKILL.md`
- Read: `.agents/skills/arbesk-ipfs-storage/references/pinata-mode.md`
- Read: `.agents/skills/edit-ui/references/deep-dive.md`

**Interfaces:**
- Consumes: `docs/ASSET_CORE_SDK.md` (already written)
- Produces: List of stale paths and sections needing updates.

- [ ] **Step 1: Read all target files in parallel**
- [ ] **Step 2: Note every stale path reference (`frontend/src/js/gltf/...`, `frontend/src/js/domain/...`, etc.)**

## Task 2: Update `docs/ARCHITECTURE.md`

**Files:**
- Modify: `docs/ARCHITECTURE.md`

**Interfaces:**
- Consumes: Current ARCHITECTURE.md, ASSET_CORE_SDK.md
- Produces: Updated section describing asset-core SDK, ports, facade, and adapter boundaries.

- [ ] **Step 1: Add or update a section on the asset-core SDK under the frontend/backend architecture description**
- [ ] **Step 2: List the core ports and their responsibilities**
- [ ] **Step 3: Mention `createArbeskCore` as the primary facade and link to `docs/ASSET_CORE_SDK.md`**

## Task 3: Update `docs/CURRENT_STATUS.md`

**Files:**
- Modify: `docs/CURRENT_STATUS.md`

**Interfaces:**
- Consumes: Current CURRENT_STATUS.md
- Produces: Status marking asset-core externalization as complete.

- [ ] **Step 1: Mark asset-core SDK externalization complete in the appropriate section**
- [ ] **Step 2: Link to `docs/ASSET_CORE_SDK.md`**

## Task 4: Update `docs/MERKLE_IMPLEMENTATION.md`

**Files:**
- Modify: `docs/MERKLE_IMPLEMENTATION.md`

**Interfaces:**
- Consumes: Grep results showing stale paths
- Produces: Corrected paths pointing to `frontend/src/js/asset-core/gltf/...` and `frontend/src/js/asset-core/domain/...`.

- [ ] **Step 1: Update all moved file paths**
- [ ] **Step 2: Verify `merkle-editors.ts` path points to `frontend/src/js/asset-core/gltf/merkle-editors.ts`**

## Task 5: Update `docs/MEGAETH_ANALYSIS.md`

**Files:**
- Modify: `docs/MEGAETH_ANALYSIS.md`

**Interfaces:**
- Consumes: Grep results showing stale paths
- Produces: Corrected paths pointing to `frontend/src/js/asset-core/...`.

- [ ] **Step 1: Update all moved file paths**

## Task 6: Update Skill Files

**Files:**
- Modify: `.agents/skills/arbesk-gltf-pipeline/SKILL.md`
- Modify: `.agents/skills/arbesk-gltf-pipeline/references/deep-dive.md`
- Modify: `.agents/skills/arbesk-gltf-pipeline/references/troubleshooting.md`
- Modify: `.agents/skills/arbesk-ipfs-storage/SKILL.md`
- Modify: `.agents/skills/arbesk-ipfs-storage/references/pinata-mode.md`
- Modify: `.agents/skills/edit-ui/references/deep-dive.md`

**Interfaces:**
- Consumes: Grep results showing stale paths
- Produces: Skill files with correct paths and brief SDK/facade note where relevant.

- [ ] **Step 1: Replace `frontend/src/js/gltf/` with `frontend/src/js/asset-core/gltf/`**
- [ ] **Step 2: Replace `frontend/src/js/domain/` with `frontend/src/js/asset-core/domain/`**
- [ ] **Step 3: Replace `frontend/src/js/gltf/async-gltf.ts` with `frontend/src/js/asset-core/gltf/async-gltf.ts`**
- [ ] **Step 4: Add a one-line note referencing `docs/ASSET_CORE_SDK.md` in relevant skill files**

## Task 7: Verify and Commit

**Files:**
- All modified docs and skill files.

**Interfaces:**
- Consumes: Edited files
- Produces: Single docs commit.

- [ ] **Step 1: Run `npm run lint` to ensure no markdown lint issues**
- [ ] **Step 2: Run git diff to review changes**
- [ ] **Step 3: Commit with message `docs: update ARCHITECTURE, CURRENT_STATUS, and skills for asset-core SDK`**
