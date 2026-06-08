# Skill Refactoring Design — Brief Entry Points with Reference Lists

**Date:** 2026-06-08
**Scope:** All 7 project skills in `.agents/skills/`
**Goal:** Reduce SKILL.md files to 100–180 line brief entry points; move deep reference content to companion `.md` files in the same skill folder.

---

## Problem Statement

The 7 project skills vary wildly in length (139–913 lines). The longest skills (`solidity-smart-contracts` at 913 lines, `gnome-hig-audit` at 592 lines, `edit-ui` at 512 lines) are encyclopedic reference documents that inline API endpoints, full checklists, step-by-step procedures, code examples, and troubleshooting guides. When an agent loads one of these skills, the entire content is injected into its context window — consuming tokens for detail the agent may never need.

The one well-sized skill (`babylon-memory-leaks` at 139 lines) works because it follows a tight pattern:
- Trigger conditions → Key insight → Diagnostic table → Correct patterns → What NOT to do → File map → Verification checklist

All other skills should follow this pattern.

---

## Solution: Brief Entry Point + Companion Files

Every skill folder contains:
- `SKILL.md` — the brief entry point (100–180 lines)
- `*.md` companion files — deep reference content, linked from SKILL.md

The SKILL.md is the only file the agent framework loads automatically. Agents read companions on demand when directed by SKILL.md links.

---

## Standard SKILL.md Template

```markdown
---
name: <skill-name>
description: <one-line when-to-use trigger>
---

# <Skill Title>

Use this skill when you need to:
- Specific trigger condition 1
- Specific trigger condition 2
- Specific trigger condition 3

## Quick Decision

| Question | Action |
|----------|--------|
| Q1? | Do X. See [→ X Guide](./x-guide.md) |
| Q2? | Do Y. See [→ Y Guide](./y-guide.md) |

## Key Rules

1. **Rule name** — One-sentence explanation.
2. **Rule name** — One-sentence explanation.
3. **Rule name** — One-sentence explanation.

## File Map

| File | Role | Deep Dive |
|------|------|-----------|
| `path/to/file.js` | Brief role description | [→ Guide](./file-guide.md) |

## Deep Reference

| Topic | File |
|-------|------|
| Architecture / Pipeline | [→ Deep Dive](./deep-dive.md) |
| Troubleshooting | [→ Troubleshooting](./troubleshooting.md) |
| Checklists / Audit | [→ Checklists](./checklists.md) |
| API Reference | [→ API Reference](./api-reference.md) |
| Quick Reference Card | [→ Quick Reference](./quick-reference.md) |
```

### Template rules

- **No inline code examples longer than 3 lines** in SKILL.md. Link to the companion file.
- **No exhaustive tables** in SKILL.md. A quick-reference table (≤ 8 rows) is okay; a 50-row inventory goes to a companion.
- **No step-by-step procedures** in SKILL.md. A numbered procedure with > 3 steps goes to a companion.
- **File map must include relative links** to companion files so agents know where to go.
- **Keep the front-matter `description`** — this is what the agent framework displays in skill listings.

---

## Companion File Taxonomy

Use these standard names across all skills:

| Companion File | Contents |
|----------------|----------|
| `deep-dive.md` | Architectural overview, pipeline details, format explanations, code walkthroughs |
| `troubleshooting.md` | Symptom/cause/fix tables, debugging procedures, common error patterns |
| `checklists.md` | Exhaustive audit checklists, verification steps, scoring rubrics |
| `api-reference.md` | API endpoints, request/response examples, curl commands, error codes |
| `quick-reference.md` | Cheat-sheet style content: quick ref cards, command summaries, tier tables |
| `patterns.md` | Reusable UI patterns, code patterns, empty states, loading states |
| `pitfalls.md` | "What NOT to do" lists, anti-patterns, common mistakes |

Not every skill needs every companion. Only create companions for content that would push SKILL.md above ~180 lines.

---

## Per-Skill Migration Plan

### `babylon-memory-leaks` — 139 lines ✅

**Action:** No changes. This is the model.

---

### `arbesk-asset-inspection` — 238 lines → ~120 lines

**Content to move out:**
- Full API endpoint documentation (`GET /api/v1/tokens/:tokenId/manifest`, `GET /api/v1/manifests/:cid/history`) with request/response examples → `api-reference.md`
- Detailed manifest structure JSON schema → `manifest-structure.md`
- Token resolution frontend details (cache, contract call, URI normalization, RPC endpoints) → `deep-dive.md`

**Content to keep in SKILL.md:**
- Trigger conditions
- Quick decision table (4 patterns)
- Node types summary (2 types, brief JSON snippets ≤ 8 lines each)
- Counting children (1 bash one-liner)
- File map with links

**New companion files:**
- `api-reference.md`
- `manifest-structure.md`
- `deep-dive.md`

---

### `arbesk-gltf-pipeline` — 390 lines → ~150 lines

**Content to move out:**
- Architecture overview diagram and full GLB vs glTF comparison → `deep-dive.md`
- The three URI formats (legacy, monolithic, composite) with detailed explanations → `deep-dive.md`
- Compose/decompose pipeline walkthroughs with ASCII diagrams → `deep-dive.md`
- Scene graph loading (`loadAsset`, `loadNode`, `attachMetadata`) code walkthroughs → `deep-dive.md`
- Post-processor system (pending edits, save flow, runtime color, mesh overrides) → `deep-dive.md`
- Material editing full property table and commit model → `deep-dive.md`
- Save & publish flow step-by-step → `deep-dive.md`
- Common operations (add new material property, add new 3D format, debug loading failure, debug colors, force re-decomposition) → `troubleshooting.md`
- Golden Rules (8 rules) → keep in SKILL.md (they're short)

**Content to keep in SKILL.md:**
- Trigger conditions
- Quick decision table
- Key Files Reference table (≤ 12 rows)
- Golden Rules (8 items, 1 line each)
- Deep Reference links

**New companion files:**
- `deep-dive.md`
- `troubleshooting.md`

---

### `arbesk-ipfs-storage` — 356 lines → ~140 lines

**Content to move out:**
- Architecture overview with Docker Compose diagram → `deep-dive.md`
- IPFS client library details (backend vs frontend) → `deep-dive.md`
- Pinning semantics deep dive (GC watermark, unpin-on-burn lifecycle) → `deep-dive.md`
- All IPFS write paths table (6 entries with line numbers) → `deep-dive.md`
- Manifest chain storage model diagram → `deep-dive.md`
- Unpin endpoint full request/response spec → `api-reference.md`
- Docker IPFS configuration (entrypoint.sh config values, storage volume) → `docker-config.md`
- Rules for IPFS code changes (10 rules) → keep in SKILL.md (short)
- Common operations (manual unpin, list pins, trigger GC, check repo, add file) → `troubleshooting.md`
- Troubleshooting table (7 symptoms) → `troubleshooting.md`
- Content addressing vs deletion concepts → `deep-dive.md`

**Content to keep in SKILL.md:**
- Trigger conditions
- Node isolation summary (bullets, not paragraphs)
- Pinning semantics summary (2 paragraphs)
- Key Files Reference table
- Rules for IPFS code changes (10 short rules)
- Deep Reference links

**New companion files:**
- `deep-dive.md`
- `troubleshooting.md`
- `api-reference.md`
- `docker-config.md`

---

### `edit-ui` — 512 lines → ~160 lines

**Content to move out:**
- Full project UI architecture (stack table, directory map with 30+ entries) → `deep-dive.md`
- Studio shell ASCII diagram and layout CSS details → `deep-dive.md`
- GNOME HIG Principles Applied (6 principles with paragraphs each) → `deep-dive.md`
- State Management Pattern (full state object, 20 fields) → `deep-dive.md`
- Event Flow table (10 events with dispatched by / listened by / purpose) → `deep-dive.md`
- Babylon.js Integration Patterns (engine options, mesh hierarchy, viewport chrome, selection detection, ortho mode gotcha, view presets) → `deep-dive.md`
- SCSS Conventions (`@use` pattern, CSS variables table, viewport canvas) → `deep-dive.md`
- Keyboard Shortcut Checklist (6 steps for adding new shortcuts) → `checklists.md`
- Common UI Patterns to Reuse (empty state, drop zone, spinner — full code blocks) → `patterns.md`
- Pitfalls to Avoid (12 items with code blocks) → `pitfalls.md`
- Adding a New Panel checklist (7 steps) → `checklists.md`
- Key Files Quick Reference table (12 rows) → keep in SKILL.md
- GNOME HIG Reference principles list → keep in SKILL.md (short)

**Content to keep in SKILL.md:**
- Trigger conditions
- Studio shell one-line summary
- Keyboard shortcuts quick table (≤ 10 rows)
- CSS variables quick table (≤ 10 rows)
- Key Files Quick Reference table
- GNOME HIG principles summary (8 bullets)
- Deep Reference links

**New companion files:**
- `deep-dive.md`
- `checklists.md`
- `patterns.md`
- `pitfalls.md`

---

### `gnome-hig-audit` — 592 lines → ~130 lines

**Content to move out:**
- Audit Scope table (13 surfaces with files audited) → `checklists.md`
- Audit Categories & Scoring (10 categories with weights, score interpretation table) → `checklists.md`
- How to Run the Audit (5 steps) → `checklists.md`
- Category A–J checklists (all 10 categories, ~350 lines of checkbox items) → `checklists.md`
- Report Template (full markdown template with tables) → `report-template.md`
- Quick Audit 5-Minute Triage (7 items) → `quick-audit.md`
- Known HIG Patterns to Compare Against (5 apps) → `checklists.md`

**Content to keep in SKILL.md:**
- Trigger conditions
- Priority context paragraph (web app vs native GTK)
- Audit scope one-line summary
- Category list (A–J, names only, no checkboxes)
- Score interpretation table (5 ranges)
- Quick Audit 7-item list (names only, no detailed checks)
- Deep Reference links

**New companion files:**
- `checklists.md`
- `report-template.md`
- `quick-audit.md`

---

### `solidity-smart-contracts` — 913 lines → ~180 lines

**Content to move out:**
- General Solidity Expertise (architecture principles table, common patterns with code blocks, OZ v5 breaking changes, gas optimization) → `deep-dive.md`
- Arbesk Contract Deep Dive (inheritance chain, storage layout table, complete function inventory ~15 functions, event signatures, tier pricing, MockUSDC) → `contract-deep-dive.md`
- Deployment Pipeline & Address Alignment (pipeline diagram, 3 sources of truth, address flow diagram, deployment commands, address alignment verification script) → `deployment-pipeline.md`
- Debugging Smart Contracts (Hardhat console, console.log, event log decoding, common scenarios table, on-chain state inspection, test execution, integrity suite) → `debugging.md`
- Integration Verification Checklist (5 phases, ~25 checkboxes) → `checklists.md`
- Multi-Network Deployment (network configs, Base Sepolia specifics, adding a new network) → `deployment-pipeline.md`
- Smart Accounts & Proxy Validation (problem, solution code, MetaMask settings, detecting smart account txs, Brave Wallet note) → `smart-accounts.md`
- Session Authentication Pitfalls (session flow table, case-sensitive address bug, implementation rules, backend store, SIWE chain ID support) → `session-auth.md`
- Quick Reference Card (ASCII card with all constants) → `quick-reference.md`

**Content to keep in SKILL.md:**
- Trigger conditions
- Contract overview (file, Solidity version, dependencies, test file)
- Storage layout summary (key variables, brief)
- Function inventory summary (categories only, no per-function tables)
- Event signatures (keccak256 hashes — keep inline, agents search these)
- Tier pricing table (4 rows)
- Quick deployment commands (3 commands)
- Address alignment one-liner
- Deep Reference links

**New companion files:**
- `deep-dive.md`
- `contract-deep-dive.md`
- `deployment-pipeline.md`
- `debugging.md`
- `checklists.md`
- `smart-accounts.md`
- `session-auth.md`
- `quick-reference.md`

---

## File Structure After Refactor

```
.agents/skills/
├── arbesk-asset-inspection/
│   ├── SKILL.md              (~120 lines)
│   ├── api-reference.md
│   ├── manifest-structure.md
│   └── deep-dive.md
├── arbesk-gltf-pipeline/
│   ├── SKILL.md              (~150 lines)
│   ├── deep-dive.md
│   └── troubleshooting.md
├── arbesk-ipfs-storage/
│   ├── SKILL.md              (~140 lines)
│   ├── deep-dive.md
│   ├── troubleshooting.md
│   ├── api-reference.md
│   └── docker-config.md
├── babylon-memory-leaks/
│   └── SKILL.md              (unchanged, 139 lines)
├── edit-ui/
│   ├── SKILL.md              (~160 lines)
│   ├── deep-dive.md
│   ├── checklists.md
│   ├── patterns.md
│   └── pitfalls.md
├── gnome-hig-audit/
│   ├── SKILL.md              (~130 lines)
│   ├── checklists.md
│   ├── report-template.md
│   └── quick-audit.md
└── solidity-smart-contracts/
    ├── SKILL.md              (~180 lines)
    ├── deep-dive.md
    ├── contract-deep-dive.md
    ├── deployment-pipeline.md
    ├── debugging.md
    ├── checklists.md
    ├── smart-accounts.md
    ├── session-auth.md
    └── quick-reference.md
```

---

## Success Criteria

1. Every `SKILL.md` is between 100–180 lines.
2. Every `SKILL.md` has a `## Deep Reference` section with working relative links.
3. No content is lost during migration — all current information exists in either SKILL.md or a companion file.
4. Companion files are pure reference content with no trigger conditions or "when to use" paragraphs.
5. The `babylon-memory-leaks` skill is untouched (it already follows the pattern).
6. All relative links in SKILL.md point to files that exist in the same folder.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Agents don't follow links to companions | SKILL.md must contain enough context (key rules, quick decisions, file map) for agents to act without reading companions. Companions are for edge cases. |
| Broken relative links | Verify every link after migration by grepping for `](./` and checking file existence. |
| Content duplication | Extract content verbatim — don't rewrite. Split, don't duplicate. |
| SKILL.md becomes too brief to be useful | Minimum content: triggers, quick decisions, key rules, file map, deep links. If a skill falls below 80 lines, it's too thin. |
