# CLAUDE.md

This project's agent guide is **`AGENTS.md`** — the single source of truth for conventions, commands, testing, and infrastructure. Read it first.

Load these on demand, not upfront:

- `docs/ARCHITECTURE.md` — system design, client/server split (§1.5), fractal manifest schema (§4)
- `docs/CURRENT_STATUS.md` — definitive feature/status snapshot, env var reference (§8)
- `docs/API_SPEC.md` — REST/WebSocket API, authentication flow
- `packages/*/AGENTS.md` — the three SDK packages (`@arbesk/asset-core`, `@arbesk/wallet`, `@arbesk/authz`) and their boundary rules
- `.agents/skills/` — domain skills (glTF pipeline, IPFS storage, Babylon engine, CDP wallet, Solidity, UI editing, HIG audit, worktrees, asset inspection). Read the relevant one before working in its area.
