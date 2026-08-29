---
name: arbesk-add-command
description: Use when implementing a feature marked TODO for the besk CLI in the README Studio-vs-CLI comparison table — picking the next CLI gap, porting a Studio capability to `packages/besk/`, adding any CLI subcommand or MCP tool (CLI↔MCP parity rule), or deciding between deduplicating logic into an existing @arbesk/* SDK versus creating a new package.
---

# arbesk-add-command — Adding besk CLI Commands (and Closing CLI Gaps)

## Overview

The README "Studio vs `besk` CLI" table is the CLI roadmap: every **TODO** row is a candidate feature. This skill is the end-to-end loop for closing one gap: study both clients, gate on duplication cost, let the user decide the dedup target, plan, test, implement, and flip the table row.

**Core principle:** the CLI is a thin consumer of the SDKs. New logic belongs in a shared layer once duplicating it would cost more than ~100 lines — and where that shared layer lives is the *user's* decision, not yours.

**CLI ↔ MCP parity (hard rule):** the MCP server (`mcp.ts`) and the interactive CLI are two interchangeable front-ends over the same modules. Every new CLI subcommand ships with its matching MCP tool in the same change, and every new MCP tool is reachable as a CLI subcommand. The feature logic lives in a focused module (`send.ts`, `show.ts`, …); `cli.ts` (`cmd*`, prompts, exit codes) and `mcp.ts` (tool def + throwing handler) are both thin adapters over it. The only exempt commands are inherently interactive ones (`login`'s browser/OTP flow); `mcp.ts` handlers never prompt — required input becomes required tool args (`provider`, `confirm`, …).

## Workflow

Follow the steps in order. Do not skip the decision gate (step 4).

1. **Pick one TODO row** from the README table ("Studio vs `besk` CLI" section). If the user didn't name the feature, ask which one via AskUserQuestion (offer 2–4 concrete TODO rows). Never implement more than one row per run.
2. **Study both sides.** Read the Studio implementation (typically `frontend/src/js/ui/`, `frontend/src/js/services/`, `frontend/src/js/blockchain/`) and the CLI's current state (`packages/besk/src/cli.ts`, `catalog.ts`, `relay.ts`, `adapters.ts`, `mcp.ts`). Check whether the backend relay (`src/api/routes/wallet-relay.ts`) already supports the op — most writes do.
3. **Assess duplication cost.** Estimate the **net** lines of Studio/frontend logic the CLI would have to copy *after reusing what the SDKs already provide* — if the dedup already happened (e.g. `asset-core/domain/editors.ts` mirrors `team.ts`), the duplicated cost is ~0. State the number in your plan.
4. **Decision gate:**
   - **≤ ~100 net lines duplicated** → implement directly in `packages/besk/src/` as a thin module over `relay()` and the SDKs, following existing patterns. No user prompt needed for placement.
   - **> ~100 net lines duplicated** → the logic must move to a shared layer. **Ask the user with AskUserQuestion:**
     - **Option A** — deduplicate into an existing SDK (`@arbesk/asset-core` for manifest/domain logic, `@arbesk/wallet` for chain/auth, `@arbesk/authz` for access policy, `@arbesk/ai-asset-gen` for generation). State which one and why.
     - **Option B** — create a new SDK package under `packages/`.
     Wait for the explicit choice before writing any code.
   - Either way: if the plan adds or changes code in a shared SDK (even under the gate), say so explicitly in the plan and mark frontend regression tests as mandatory (step 6).
5. **Plan.** Write the implementation plan (use the writing-plans skill for large features). The plan must name: CLI module(s), SDK changes (if any), relay/adapter changes, and the README row being closed.
6. **Tests first** (REQUIRED SUB-SKILL: test-driven-development):
   - New CLI behavior → new `test/besk-*.test.js` suite following `test/besk-catalog-write.test.js` (`jest.unstable_mockModule` on `relay.ts`/`adapters.ts`).
   - MCP parity → update `test/besk-mcp.test.js`: add the tool name to `EXPECTED_TOOLS` and at least one `callTool` dispatch test (use `open: false`-style flags so tests never launch browsers or prompt).
   - If the dedup touched a shared SDK or frontend code → also run/update `npm run test:frontend` (deployment integrity included); E2E (`e2e/`) only if Studio UI behavior changed.
7. **Implement.** Keep the CLI module thin; environment-bound pieces (Node fetch, viem reads, session file) go in `adapters.ts`, never domain logic. Then add the matching MCP tool in `mcp.ts` in the same change: snake_case name mirroring the subcommand (`show` → `show_asset`), a JSON-schema `inputSchema`, and a handler that calls the same module and THROWS on error (never prompts, never sets `process.exitCode`). Interactive inputs become explicit args: pickers → required enums, typed confirmations → a `confirm` field, browser opens → an `open` flag defaulting to true. Nothing reachable from `mcp.ts` may print to stdout (stdio is the JSON-RPC channel — log via `debug.ts`, which writes to stderr).
8. **Run and fix until green:** `npm test`, `npm run typecheck`, `npm run lint` — plus `npm run test:frontend` when step 6 says so. No row is done while anything is red.
9. **Update the docs, then report:**
   - Flip the README table row from **TODO** to **✅** with the command name and any caveat (e.g. owner-only, best-effort unpin).
   - Add the command to `cli.ts` `help()` and the README intro command list.
   - The MCP tool count appears in the README ("AI agents" row + `besk mcp` section) — bump it when a tool is added or removed.
   - Touch `docs/CURRENT_STATUS.md` only if it documents the affected area.

## Red Flags — STOP

- Deciding the dedup target (existing SDK vs new package) without asking the user
- Estimating duplication as "~0 because the SDK exists" while still writing new SDK code — the estimate covers only copied lines; any shared-SDK change still triggers frontend regression tests
- Copying frontend logic into the CLI past the ~100-line gate
- Adding a CLI subcommand without its MCP tool, or an MCP tool without its subcommand — parity is part of "done"
- An `mcp.ts` handler that prompts, reads TTY state, sets `process.exitCode`, or prints to stdout
- Flipping the README row to ✅ before tests pass
- Changing a shared SDK without running `npm run test:frontend`
- Implementing a "Not doable" row (those require the 3D viewer — out of CLI scope by definition)

## Common Mistakes

| Mistake | Fix |
|---|---|
| Writing contract/signing code in the CLI | All on-chain writes go through the backend relay — extend `relay.ts` params, never sign locally |
| New domain logic inside `cli.ts` | `cli.ts` is dispatch + prompts; logic lives in a focused module (`collections.ts`, `burn.ts`, …) |
| Logic duplicated between a `cmd*` handler and an `mcp.ts` handler | Both are adapters — move the shared logic into the feature module and call it from each |
| Backend route changes when the relay already supports the op | Check `wallet-relay.ts` op list first; prefer extending the CLI's relay params |
| Updating only `help()` | The README row flip + MCP tool + tool-count bump are the closing steps of the workflow — all are required |
