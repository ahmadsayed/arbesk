---
name: arbesk-add-command
description: Use when implementing a feature marked TODO for the besk CLI in the README Studio-vs-CLI comparison table — picking the next CLI gap, porting a Studio capability to `packages/besk/`, adding any CLI subcommand or MCP tool (CLI↔MCP parity rule), or deciding between deduplicating logic into an existing @arbesk/* SDK versus creating a new package.
---

# Adding besk CLI Commands

The README table "Studio vs `besk` CLI vs MCP" is the CLI roadmap: each **TODO** row is a candidate. Close one row per run.

**Two fixed rules**

- **The CLI is a thin consumer of the SDKs.** If a feature would copy more than about 100 lines of Studio logic, that logic moves to a shared layer, and the **user** chooses where.
- **CLI ↔ MCP parity.** Every subcommand ships with its MCP tool in the same change, and every MCP tool is reachable as a subcommand. Feature logic lives in its own module (`send.ts`, `show.ts`, …); `cli.ts` (prompts, exit codes) and `mcp.ts` (tool definition, throwing handler) are adapters over it. Only inherently interactive commands (`login`) are exempt.

## Workflow

1. **Pick one TODO row.** If the user named none, ask which, offering 2–4 rows. "Not doable" rows need the 3D viewer and are out of scope.
2. **Read both sides**: the Studio implementation (`frontend/src/js/ui|services|blockchain/`) and the CLI (`packages/besk/src/`). Check whether the relay (`src/api/routes/wallet-relay.ts`) already supports the operation; most writes do.
3. **Count the duplication**: net lines the CLI would copy after reusing what the SDKs already export. Put the number in the plan.
4. **Gate.**
   - About 100 lines or fewer: implement in `packages/besk/src/` as a thin module over `relay()` and the SDKs.
   - More: stop and ask the user to choose between an existing SDK (`asset-core` for manifest and domain logic, `wallet` for chain and auth, `authz` for access policy, `ai-asset-gen` for generation; say which and why) and a new package under `packages/`. Write no code before the answer.
   - Any change to a shared SDK, whatever its size, makes `bun run test:frontend` mandatory.
5. **Tests first.**
   - CLI behaviour: a `test/besk-*.test.js` suite in the style of `test/besk-catalog-write.test.js` (`mock.module` on `relay.ts` and `adapters.ts`).
   - Parity: add the tool name to `EXPECTED_TOOLS` in `test/besk-mcp.test.js` plus one `callTool` test. Tests never open a browser or prompt.
6. **Implement.**
   - Environment-bound code (fetch, viem reads, session file) goes in `adapters.ts`. On-chain writes go through the relay; the CLI never signs.
   - MCP tool: snake_case name mirroring the subcommand (`show` → `show_asset`), JSON-schema `inputSchema`, a handler that calls the same module and **throws** on error.
   - An MCP handler never prompts, reads the TTY, sets `process.exitCode` or prints to stdout (stdout is the JSON-RPC channel; log through `debug.ts`). Interactive inputs become arguments: a picker becomes a required enum, a typed confirmation a `confirm` field, a browser open an `open` flag.
7. **Green**: `bun run test`, `bun run typecheck`, `bun run lint`, and `bun run test:frontend` when step 4 says so.
8. **Docs, only after green**: flip the README row to ✅ in both the CLI and MCP columns (command, tool name, caveats), add the command to `help()` in `cli.ts` and to the README command list, and update the MCP tool count in the README.
