<!-- Title: conventional and short, e.g. "fix(gc): follow references in any form".
     Readable in two minutes. Delete the hints in comments as you fill it in. -->

<!-- One line per issue: "Closes #<n>" if this PR resolves all of it, "Refs #<n>"
     if a part or a verification stays open; "No issue" if there is none. -->
Closes #

## What it's for

<!-- 2–3 sentences, from the user's point of view: what was wrong or missing,
     what they get now. -->

## What changes

<!-- Short bullets by area; settings added with their default. Drop empty ones. -->

- **Studio / frontend:**
- **Backend / API:**
- **Contracts:**
- **SDK packages / CLI:**
- **Scripts / deploy:**
- **Tests:**
- **Docs:**

## Screenshots

<!-- Before / after of anything visible, both themes when colours change. Upload
     with scripts/pr-screenshots.sh and paste the Markdown it prints.
     "No visible change" if there is none. -->

| Before | After |
|---|---|
|  |  |

## How it was checked

<!-- Tick only what really ran, with the counts. -->

- [ ] `bun run test` <!-- N passed -->
- [ ] `bun run lint`, `bun run typecheck`, `bun run typecheck:frontend`
- [ ] Pre-commit audit passed, no `--no-verify`
- [ ] `bun run test:contracts` <!-- N passed, or "no contract change" -->
- [ ] `bun run test:e2e -- --project=chromium` <!-- N passed, flaky ones named; or "not needed: …" -->
- [ ] Looked at in the running Studio <!-- or "no UI change" -->
- [ ] The real thing (testnet, a real provider, the live site): <!-- what was tried and by whom, or "not needed: …" -->

## Not verified

<!-- What could not be checked here (a real provider, the live site, another
     wallet…), one line per point. "Nothing" if all was checked. -->

## Follow-up

<!-- What is left out on purpose, and where it is tracked. -->
