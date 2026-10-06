# Minimal landing page — design

**Date:** 2026-10-06
**Status:** Approved (brainstorm), pending spec review
**Scope:** `frontend/src/pug/index.pug`, `frontend/src/scss/components/_landing.scss`, small additions to `create-panel.ts` and the Library, tests.
**Out of scope:** the `besk` CLI / MCP (not publicly released — no mention on the landing page), new routes, analytics, og:image.

## 1. Problem

The current landing page links to `/library` seven times ("Open app", "Open Library" ×3, "Upload a model" ×2, footer "Library"). "Upload a model" goes to plain `/library` and uploads nothing. Three orange primary buttons compete (header, hero, footer), and both footer buttons are primary. The hero copy sells *time/versions* while its CTAs sell *file management*; the real differentiator — generating CAD parts and 3D models from a prompt — appears only in the second section. Six sections, four interactive demos and decorative bands make the page busy.

## 2. Goal

A minimalist page with one idea per screen and **one primary action: Generate**. Library and upload remain reachable but quiet. Works in both themes (Graphite / Paper), down to 390 px wide, with and without JavaScript.

The chosen direction is mockup **A · Prompt** (reference build kept out of repo; screenshots in the brainstorm session).

## 3. Page structure

| # | Block | Content |
|---|---|---|
| — | Header (sticky, blurred) | Brand mark + "Arbesk" left; **Sign in** text link right → `/library?login=1`. No orange button. |
| 1 | Hero (≈ full viewport) | H1 "Describe it." / dimmed second line "Keep every version." · one sub-line · **prompt form** · three example chips · **upload card** → `/library?upload=1` (neutral bordered card under the prompt: upload icon, "Upload your model", "GLB, glTF or 3MF — every edit after that is kept as a version.", and a small v1 → v2 → v3 trail; never orange). |
| 1a | CAD track (`#cad`, `data-cad-only`) | Kicker "For makers" · H2 "Parts that fit." · three facts · quiet "Try" deep links (`/studio?provider=cad&prompt=…`) · isometric bracket drawing (`landing/cad-bracket*.svg` used as CSS masks so lines take theme colours; dimension labels are HTML). Hidden when `cadGeneration === false`. |
| 1b | Art track (`#art`) | Staggered Reema + Suka renders · "For artists" / "Characters with character." · three facts · "Try" deep links (`provider=tripo3d`). |
| 2 | 4D demo | H2 "The world is 4D." + one-line explanation · live Howdy viewer · version rail v1–v4 · live caption (`aria-live="polite"`). |
| 3 | Three lines | `01 Generate` · `02 Version` · `03 Share` — mono number in accent, title, one sentence each. No cards. |
| — | Footer | "Start with a sentence." + **Generate a model** (only other primary button, links to `#prompt` and focuses the hero input) · "Sign in with an email code. No password." · bottom row: origin line + quiet Library · Studio links. |

Testnet banner (`#testnetBanner`) and its config fetch are kept as-is.

**Removed:** persona cards, colour-memory cube + scrubber + log, CID ledger chain (`prev_manifest_cid`), team pedestals and feature grid, agents note, scroll cue, `band-dark` / `section-tint` bands and radial glows. `asset-reema.webp` / `asset-suka.webp` were deleted here and later restored for the art track (§3 row 1b); `asset-howdy.webp` stays as the no-JS viewer fallback.

### Copy

- H1: "Describe it." / "Keep every version."
- Sub: "Generate 3D models and CAD parts from a sentence. Every edit after that is saved, forever."
- Demo: "The world is 4D." — "Time is the fourth dimension. Step back through everything this model has been."
- 01 Generate — "Precise CAD parts or characters and props — from text or a reference image."
- 02 Version — "Every change is a version. Nothing is overwritten, nothing is lost."
- 03 Share — "Invite editors, comment on any asset, and publish when it's ready."
- `<title>` and meta description updated to match the hero; og tags kept.

## 4. Prompt form → Studio hand-off

```pug
form#prompt.prompt(method="get" action="/studio")
  fieldset.seg  //- radio pair styled as a segmented control
    input(type="radio" name="provider" value="tripo3d" checked) 3D
    input(type="radio" name="provider" value="cad") CAD
  input(type="text" name="prompt" required maxlength="500")
  button.btn(type="submit") Generate
```

- Submitting produces `/studio?provider=tripo3d&prompt=low-poly+fox`. **Works without JS** (native GET form).
- **CAD is the default (first, checked) mode** — it works without an API key; 3D bills the visitor's own Tripo 3D key (BYOK). A one-line note under the chips (`#promptNote`) says which, per mode; the art track repeats the key requirement with a link to platform.tripo3d.ai.
- Placeholder and example chips switch with the mode (JS enhancement): 3D → "Describe a character or prop…" / *Low-poly fox · Cowboy mascot · Sci-fi crate*; CAD → "Describe a part…" / *M3 mounting bracket, 40 mm · Phone stand, 70° · Gridfinity bin 2×3*. A chip fills the input and focuses it; it does not submit.
- When `/api/v1/config` returns `cadGeneration === false`, the CAD radio is removed (mirrors Studio behaviour in `create-panel.ts`).
- **Studio side (new):** `create-panel.ts` reads `?prompt=` next to the existing `?provider=` handling and **prefills** `#promptInput` (trimmed, capped at 500 chars), resizing the textarea. It **never auto-submits** — generation costs credits and needs sign-in. After prefill the param is removed with `history.replaceState` so a reload doesn't re-prefill over user edits.

## 5. "Upload a model" link

Browsers refuse to open a file picker without a user gesture, so `/library?upload=1` cannot open it after navigation. Instead:

- Library reads `?upload=1`. Once the upload button is usable (`#libraryUploadBtn` not hidden — i.e. connected and not a visitor), it scrolls it into view, focuses it and adds a one-shot `.attention` pulse class (removed on `animationend`; no animation under reduced motion). The param is then removed via `history.replaceState`.
- If the user is not signed in, the param also triggers the same sign-in prompt as `?login=1`; the highlight runs after `WALLET_CONNECTED`.

## 6. Visual system

- Only theme tokens from `themes/_graphite.scss` / `_paper.scss` (`--window-bg`, `--window-fg`, `--view-bg`, `--raised-bg`, `--hairline`, `--border-color`, `--dim-fg`, `--accent-*`). No raw hex in `_landing.scss` (the colour-leak test enforces this).
- Orange (`--accent-bg`) appears only on the two Generate buttons and the active version rail.
- Type: Inter; H1 `clamp(40px, 7.2vw, 96px)`, weight 700, letter-spacing −0.045em, `text-wrap: balance`; mono (JetBrains Mono) for version tags and section numbers.
- Generous vertical spacing (≈120–160 px between blocks on desktop), max content width 1080 px, 16 px side gutters on mobile.
- Demo stage: rounded 20 px, subtle radial from `--viewport-bg` to `--window-bg`.
- **Mobile (≤ 560 px):** prompt wraps — input on its own row, toggle + full-width Generate below; three lines stack; stage becomes 1:1. No horizontal scroll at 390 px.
- **Reduced motion:** no auto-spin, no reveal/transition animations, no pulse.
- Focus: visible `:focus-visible` ring on every interactive element; chips and rail are `<button>`s; rail buttons carry `aria-pressed`.

## 7. 4D demo viewer

Port the mockup's viewer into the page's inline script, replacing the two current viewers:

- Lazy-boot Babylon (same CDN URLs and `IntersectionObserver` pause/resume as today) when the stage scrolls into view.
- Load `/models/howdy.glb`; compute bounds after `computeWorldMatrix(true)`; pivot at the feet; camera distance ≈ 5× bounding radius (fov 0.45).
- Versions: **v1 Generated** (all parts → grey clay PBR) · **v2 Painted** (original materials) · **v3 Resized** (scale ×1.2, eased) · **v4 Repainted** (hat `#1f6f78`, scarf `#d9a441`; default/latest).
- Rail click switches version and updates the caption ("v4 — New hat and scarf. Latest").
- Failure or no JS → show `asset-howdy.webp` fallback, hide rail (existing `noscript` / `.viewer-failed` pattern).

## 8. Testing

- `test/frontend/create-panel-cad.test.js`: `?prompt=` prefills `#promptInput`, is capped at 500 chars, does not call submit, and is stripped from the URL; `?provider=` + `?prompt=` together.
- New Library test: `?upload=1` with connected owner → upload button focused + `.attention`; when not connected → login prompt opened, highlight after connect.
- `test/frontend/theme-contrast.test.js`: drop the `landing band …` pairs and the band-heading test (bands removed). `dim-fg` on surfaces is already covered by `TEXT_ON_SURFACE`.
- Landing render test (pug compile of `index.pug`): exactly one `form[action="/studio"]` with `provider` radios + `prompt` input; `href="/library"` appears only in the footer; upload link is `/library?upload=1`; no `.persona-card`, `#memory-cube`.
- Manual/Playwright visual check at 1440 × 900 and 390 × 844, Graphite and Paper.
- Existing E2E specs are unaffected (none target the landing page); run `test/frontend` + router tests.

## 9. Risks

- **Prefill vs. stored provider:** `?provider=` already overrides and persists the stored choice; `?prompt=` is independent and never persisted.
- **Visitors without CAD:** a no-JS submit with `provider=cad` on a CAD-less deployment does *not* fall through cleanly — `knownOption("cad")` is still true at sync time because `create-panel.ts` only removes the `cad` option once `getConfig()` resolves (async, after the select has already been set to `"cad"` and that value stored), so the select ends on whatever the browser picks once the option is later removed. The landing page's JS CAD gate (hiding the CAD persona card when the deployment lacks it) prevents this for JS users; a no-JS visitor on a CAD-less deployment hitting this URL directly is a known, accepted edge case.
- **Copy length:** keep the hero to one sub-line; resist re-adding feature lists.
