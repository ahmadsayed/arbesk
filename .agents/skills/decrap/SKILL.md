---
name: decrap
description: Use when reducing CRAP score, cyclomatic complexity, or change-risk of existing code — "this function is too complex", "high CRAP score", "refactor this for testability", before extracting or simplifying any long/branchy function in the repo
---

# Decrap — Lowering CRAP Score Safely

## Overview

CRAP (Change Risk Anti-Patterns) = `CC² × (1 − cov/100)³ + CC`. It flags functions that are **complex AND untested** — the riskiest code to change. Lowering it means extracting complexity into small testable units, never rewriting.

**Iron Law:** Characterization tests BEFORE any code move. Tests written against already-refactored code prove nothing about parity with the original — baseline runs show agents then catch behavior drift by luck, not by test.

## The Process

### 0. Measure and rank
```bash
npx fallow health
```
Pick the top offender by score. Don't guess what's crappy.

### 1. Library check — should this code exist at all?
Before refactoring, check whether a maintained library already does the job. Verify it covers the **exact** cases (e.g. `file-type` lacked KTX2 → rejected). Swap if yes; if no, record why in a comment. (Repo rule: out-of-the-box first, AGENTS.md §5.)

### 2. Read and map the branches
Read the whole function and its callees. List decision points, group them into cohesive jobs (validation, payload building, error mapping, I/O). Those job boundaries are the extraction seams.

### 3. Characterization tests — pin current behavior
- Test through the public seam (DOM events, argv, injected ports — not internals)
- Cover every mapped branch: happy paths, gates, error variants, edge cases
- **Watch them pass** — they document what *is*, including quirks
- Found a bug? Pin it with a `KNOWN GAP` comment. Fixing it mid-refactor is forbidden — that's a separate decision
- Kill any test clones that assert against a copy of the implementation (they prove nothing)

### 4. Extract — one chunk at a time, pure moves
- Same code, new named function, **zero logic changes** — no renaming, rewording, or reordering snuck in
- ONE extraction → run tests → green → next extraction. Never batch two moves between test runs
- Long if-chains → lookup tables; repeated skeletons → parameterized helpers; nested flags → early returns (shape only, same behavior)
- Test red mid-extraction? Undo. You changed behavior, not structure.

### 5. Verify at every level
```bash
npx jest <affected-suites> && npm run lint
npm run typecheck / typecheck:frontend   # whichever covers the change
npm test                                 # full suite before "done"
npx fallow health                        # the number must move — no "looks better"
```
UI / generation-flow / save-publish changes also need E2E before merge (repo rule, AGENTS.md §10).

### 6. Lock the door
```bash
fallow audit --max-crap 30   # CI gate, so CRAP can't grow back
```

## Rationalizations

| Excuse | Reality |
|--------|---------|
| "Refactor first, tests after — faster" | Tests against new code can't catch parity bugs. You verify by luck. |
| "The function is obviously correct" | Baseline agents introduce drift on 'obvious' functions every time. |
| "Coverage tool says 0% but tests exist" | Static estimates guess; measure with real Jest coverage after step 3. |
| "Just a small move, skip a test run" | Small moves are where drift hides. One move, one run. |
| "Fix the bug I found while I'm here" | Pin it as KNOWN GAP. Behavior change + structure change in one commit = unreviewable. |

## Red Flags — STOP and start over

- Production code edited before characterization tests exist
- Tests written against the refactored version
- Two extractions without a test run between them
- "Improvements" (renames, reworded messages) inside a move
- Claiming done without a fresh `fallow health` number
- Fixing a discovered bug in the same change as the refactor

**All of these mean: undo, re-pin, redo.**

## Goal

Complexity budget, not zero-CRAP zealotry: the target is no *untested* complexity. A CC-15 function with real coverage is fine — the cubed coverage term makes tested code cheap by design.
