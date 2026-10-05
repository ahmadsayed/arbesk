# Minimal Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the busy landing page with the minimal, prompt-first "Option A" design: one Generate action, a live 4D version demo, three short lines, quiet Library/upload links.

**Architecture:** `index.pug` becomes a small static page whose hero is a native `GET /studio` form (works without JS). A new classic script `js/landing/landing.js` (built from `frontend/src/js/landing/*.ts`, iife, like `theme-init`) adds the per-mode chips, the CAD gate, the testnet banner and the lazy Babylon version demo. The Studio prefills `?prompt=`; the Library turns `?upload=1` into a highlighted Upload button.

**Tech Stack:** Pug 3, SCSS (theme tokens), TypeScript bundled by `Bun.build`, Babylon.js 9.12 from CDN (landing only), `bun test` with happy-dom (`// @test-env dom`).

**Spec:** `docs/superpowers/specs/2026-10-06-minimal-landing-design.md`

## Global Constraints

- Work only in the worktree `.worktrees/minimal-landing` on branch `feat/minimal-landing`. Never `git checkout` in the main checkout (shared with other sessions).
- No mention of the `besk` CLI, MCP or "AI agents" anywhere on the page.
- `_landing.scss` and every `frontend/src/scss/components/*.scss`: theme tokens only — no hex literals, no `--choco-*`/`--gold-*` raw tokens (enforced by `test/frontend/theme-contrast.test.js`), no `text-transform: uppercase`, mono only via `var(--font-mono)` (enforced by `test/frontend/style-guards.test.js`).
- Orange (`--accent-bg`) only on the two Generate buttons and the active version rail.
- Prompt max length: **500** characters (form `maxlength` and Studio prefill cap).
- Studio prefill **never auto-submits**.
- Versions (exact copy): `v1 Generated — Untextured mesh from a prompt` · `v2 Painted — Colours applied` · `v3 Resized — Scaled ×1.2 by an editor` · `v4 Repainted — New hat and scarf. Latest`. v4 repaint colours: hat `#1f6f78`, scarf `#d9a441` (in TS, not SCSS).
- Example chips: 3D → `Low-poly fox`, `Cowboy mascot`, `Sci-fi crate`; CAD → `M3 mounting bracket, 40 mm`, `Phone stand, 70°`, `Gridfinity bin 2×3`.
- Placeholders: 3D → `Describe a character or prop…`; CAD → `Describe a part…`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Environment notes (worktree)

- Package deps are already symlinked and packages built. If `bun run build:packages` fails with `Cannot find module 'fast-xml-parser'`, run:
  `for d in ../../packages/*/node_modules; do p=$(basename $(dirname $d)); [ ! -e packages/$p/node_modules ] && ln -s "$(realpath $d)" packages/$p/node_modules; done`
- If unit tests fail nonsensically (e.g. bus events not delivered) clear the Bun transpiler cache: `rm -rf ~/.bun/install/cache/@t@`.
- Run a single unit test file: `bun scripts/run-tests.mjs test/frontend/<file>.test.js`.
- Tests that read `frontend/dist` need a build first: `(cd frontend && bun run build)`.

---

### Task 1: Studio prefills `?prompt=`

**Files:**
- Modify: `frontend/src/js/ui/create-panel.ts` (right after the `promptInput.addEventListener("input", …)` block, ~line 2402)
- Test: `test/frontend/create-panel-cad.test.js` (append a new `describe` at the end of the file)

**Interfaces:**
- Consumes: URL `?prompt=<text>` produced by the landing form (Task 4).
- Produces: nothing exported.

- [ ] **Step 1: Write the failing tests**

Append to `test/frontend/create-panel-cad.test.js`:

```js
// ─── ?prompt= deep link (landing-page hero form) ───

describe("prompt deep link", () => {
  afterEach(() => {
    history.replaceState(null, "", "/");
  });

  async function loadAt(url) {
    history.replaceState(null, "", url);
    resetModules();
    buildDom();
    await import("../../frontend/src/js/ui/create-panel.js");
    await flush();
    await flush();
  }

  test("?prompt= prefills the composer, strips only that param, and does not generate", async () => {
    await loadAt("/studio?provider=cad&prompt=%20M3%20bracket%2C%2040%20mm%20");

    expect(document.getElementById("promptInput").value).toBe("M3 bracket, 40 mm");
    const params = new URLSearchParams(location.search);
    expect(params.has("prompt")).toBe(false);
    expect(params.get("provider")).toBe("cad");
    expect(mockGenerateAsset).not.toHaveBeenCalled();
    expect(mockGenerateCadAsset).not.toHaveBeenCalled();
  });

  test("a ?prompt= longer than 500 characters is truncated to 500", async () => {
    await loadAt(`/studio?prompt=${"a".repeat(600)}`);

    expect(document.getElementById("promptInput").value).toHaveLength(500);
  });

  test("a blank ?prompt= leaves the composer empty", async () => {
    await loadAt("/studio?prompt=%20%20");

    expect(document.getElementById("promptInput").value).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun scripts/run-tests.mjs test/frontend/create-panel-cad.test.js`
Expected: the first two `prompt deep link` tests FAIL (`Expected: "M3 bracket, 40 mm" Received: ""`); the blank test passes.

- [ ] **Step 3: Implement the prefill**

In `frontend/src/js/ui/create-panel.ts`, directly after:

```ts
promptInput.addEventListener("input", () => {
  promptInput.style.height = "auto";
  promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + "px";
});
```

add:

```ts
// A ?prompt= deep link (landing-page hero form) prefills the composer. It never
// submits: generating costs credits and needs a signed-in wallet. The param is
// stripped so a reload doesn't overwrite the user's edits.
const PROMPT_DEEP_LINK_MAX = 500;
const deepLinkPrompt = new URLSearchParams(location.search).get("prompt")?.trim();
if (deepLinkPrompt) {
  promptInput.value = deepLinkPrompt.slice(0, PROMPT_DEEP_LINK_MAX);
  promptInput.dispatchEvent(new Event("input"));
  const url = new URL(location.href);
  url.searchParams.delete("prompt");
  history.replaceState(history.state, "", url);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun scripts/run-tests.mjs test/frontend/create-panel-cad.test.js`
Expected: `Tests: 29 passed, 0 failed`

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck:frontend`
Expected: exits 0, no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/js/ui/create-panel.ts test/frontend/create-panel-cad.test.js
git commit -m "feat(studio): prefill the composer from a ?prompt= deep link

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Library highlights Upload on `?upload=1`

**Files:**
- Create: `frontend/src/js/ui/upload-deep-link.ts`
- Modify: `frontend/src/js/app-init.ts` (the `?login` deep-link block, ~lines 107–113)
- Modify: `frontend/src/scss/components/_library-toolbar.scss` (append)
- Test: `test/frontend/upload-deep-link.test.js` (create)

**Interfaces:**
- Consumes: `#libraryUploadBtn` (rendered in `frontend/src/pug/includes/library-view.pug`, its `hidden` toggled by `library-controller.ts` → `!connected || visitor`).
- Produces: `export function initUploadDeepLink(): void`.

- [ ] **Step 1: Write the failing test**

Create `test/frontend/upload-deep-link.test.js`:

```js
// @test-env dom
/**
 * upload-deep-link: /library?upload=1 (landing "or upload a model") points the
 * user at the Upload button — browsers refuse to open a file picker without a
 * user gesture after navigation.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { resetModules } from "../helpers/module-registry.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

async function load() {
  resetModules();
  return import("../../frontend/src/js/ui/upload-deep-link.js");
}

let btn;

beforeEach(() => {
  document.body.innerHTML = '<button id="libraryUploadBtn" type="button" hidden>Upload</button>';
  btn = document.getElementById("libraryUploadBtn");
  history.replaceState(null, "", "/library");
});

describe("initUploadDeepLink", () => {
  test("does nothing without ?upload", async () => {
    btn.hidden = false;
    const { initUploadDeepLink } = await load();
    initUploadDeepLink();
    expect(btn.classList.contains("attention")).toBe(false);
  });

  test("highlights and focuses a visible Upload button and strips only the param", async () => {
    history.replaceState(null, "", "/library?upload=1&collection=7");
    btn.hidden = false;
    const { initUploadDeepLink } = await load();
    initUploadDeepLink();
    expect(btn.classList.contains("attention")).toBe(true);
    expect(document.activeElement).toBe(btn);
    expect(location.search).toBe("?collection=7");
  });

  test("waits until the button unhides (after sign-in)", async () => {
    history.replaceState(null, "", "/library?upload=1");
    const { initUploadDeepLink } = await load();
    initUploadDeepLink();
    expect(btn.classList.contains("attention")).toBe(false);

    btn.hidden = false;
    await tick();
    expect(btn.classList.contains("attention")).toBe(true);
  });

  test("the highlight is one-shot: animationend removes it", async () => {
    history.replaceState(null, "", "/library?upload=1");
    btn.hidden = false;
    const { initUploadDeepLink } = await load();
    initUploadDeepLink();
    btn.dispatchEvent(new Event("animationend"));
    expect(btn.classList.contains("attention")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun scripts/run-tests.mjs test/frontend/upload-deep-link.test.js`
Expected: FAIL — `Cannot find module '…/upload-deep-link.js'`.

- [ ] **Step 3: Implement the module**

Create `frontend/src/js/ui/upload-deep-link.ts`:

```ts
/**
 * /library?upload=1 — the landing page's "or upload a model" link.
 * @remarks Browsers refuse to open a file picker without a user gesture after
 *   navigation, so this points the user at the Upload button instead: once
 *   `#libraryUploadBtn` is visible (signed in, not a visitor) it is scrolled
 *   into view, focused and given a one-shot `.attention` pulse. app-init opens
 *   the sign-in modal when the visitor is signed out.
 */
export function initUploadDeepLink(): void {
  if (!new URLSearchParams(location.search).has("upload")) return;
  const url = new URL(location.href);
  url.searchParams.delete("upload");
  history.replaceState(history.state, "", url);

  const btn = document.getElementById("libraryUploadBtn");
  if (!btn) return;

  const highlight = () => {
    btn.scrollIntoView?.({ block: "nearest" });
    btn.focus();
    btn.classList.add("attention");
    btn.addEventListener("animationend", () => btn.classList.remove("attention"), { once: true });
  };

  if (!btn.hidden) {
    highlight();
    return;
  }
  const observer = new MutationObserver(() => {
    if (btn.hidden) return;
    observer.disconnect();
    highlight();
  });
  observer.observe(btn, { attributes: true, attributeFilter: ["hidden"] });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun scripts/run-tests.mjs test/frontend/upload-deep-link.test.js`
Expected: `Tests: 4 passed, 0 failed`

- [ ] **Step 5: Wire it into app-init**

In `frontend/src/js/app-init.ts` add the import next to the other `./ui/` imports:

```ts
import { initUploadDeepLink } from "./ui/upload-deep-link.ts";
```

Replace the existing block:

```ts
// Deep link from the landing page "Log in" (/library?login=1; any view works): open the
// connect modal immediately. If a previous session gets silently restored
// while the modal is open, close it — the user is already in.
if (new URLSearchParams(location.search).has("login")) {
  on(EVENTS.WALLET_CONNECTED, () => hideWalletModal());
  connectWallet();
}
```

with:

```ts
// Deep links from the landing page. "Sign in" (/library?login=1; any view works)
// opens the connect modal immediately; "or upload a model" (/library?upload=1)
// opens it only when signed out, and initUploadDeepLink then points at the
// Upload button once it unhides. If a previous session gets silently restored
// while the modal is open, close it — the user is already in.
const deepLink = new URLSearchParams(location.search);
if (deepLink.has("login") || (deepLink.has("upload") && !walletState.get().walletAddress)) {
  on(EVENTS.WALLET_CONNECTED, () => hideWalletModal());
  connectWallet();
}
initUploadDeepLink();
```

- [ ] **Step 6: Add the pulse style**

Append to `frontend/src/scss/components/_library-toolbar.scss`:

```scss
// /library?upload=1 deep link (ui/upload-deep-link.ts): one-shot pulse on Upload.
#libraryUploadBtn.attention {
  animation: kUploadAttention 0.9s ease-out 2;
}

@keyframes kUploadAttention {
  from { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-bg) 60%, transparent); }
  to { box-shadow: 0 0 0 10px color-mix(in srgb, var(--accent-bg) 0%, transparent); }
}

@media (prefers-reduced-motion: reduce) {
  #libraryUploadBtn.attention { animation: none; }
}
```

- [ ] **Step 7: Run related tests + typecheck**

Run: `bun scripts/run-tests.mjs test/frontend/upload-deep-link.test.js test/frontend/router.test.js test/frontend/theme-contrast.test.js test/frontend/style-guards.test.js && bun run typecheck:frontend`
Expected: all pass, typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/js/ui/upload-deep-link.ts frontend/src/js/app-init.ts frontend/src/scss/components/_library-toolbar.scss test/frontend/upload-deep-link.test.js
git commit -m "feat(library): ?upload=1 deep link signs in and highlights Upload

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Landing scripts (prompt form + version demo + entry)

**Files:**
- Create: `frontend/src/js/landing/prompt-form.ts`
- Create: `frontend/src/js/landing/version-demo.ts`
- Create: `frontend/src/js/landing/landing.ts`
- Modify: `frontend/scripts/bundle.js` (classic-scripts loop, ~line 199)
- Test: `test/frontend/landing-prompt-form.test.js` (create)
- Test: `test/frontend/landing-version-demo.test.js` (create)

**Interfaces:**
- Consumes: DOM ids rendered by Task 4 — `form#prompt` (radios `name="provider"` values `tripo3d`/`cad` inside `fieldset.prompt-mode`, text input `name="prompt"`), `#promptChips`, links `a[href="#prompt"]`, `#versionDemo` containing a `canvas`, `#versionRail`, `#versionCaption`; `#testnetBanner`.
- Produces:
  - `export type LandingProvider = "tripo3d" | "cad"`
  - `export const PROMPT_MODES: Record<LandingProvider, { placeholder: string; examples: string[] }>`
  - `export function initPromptForm(form: HTMLFormElement, opts: { cadAvailable: Promise<boolean> }): void`
  - `export const DEMO_VERSIONS: { tag: string; label: string; note: string }[]`
  - `export function wireVersionRail(rail: HTMLElement, caption: HTMLElement | null, onSelect: (i: number) => void): (i: number) => void`
  - `export function initVersionDemo(figure: HTMLElement): void`
  - Built file served at `/js/landing/landing.js`.
  - CSS hooks: `.prompt-chip`, `.is-current`, `.is-past`, `.rail-tag`, `.viewer-ready`, `.viewer-failed`.

- [ ] **Step 1: Write the failing prompt-form test**

Create `test/frontend/landing-prompt-form.test.js`:

```js
// @test-env dom
/**
 * landing/prompt-form: the hero form is a plain GET to /studio; this module adds
 * per-mode placeholder + example chips, the CAD availability gate and #prompt
 * focus links.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { initPromptForm, PROMPT_MODES } from "../../frontend/src/js/landing/prompt-form.js";

const FRAGMENT = `
<form id="prompt" class="prompt" method="get" action="/studio">
  <fieldset class="prompt-mode">
    <legend class="sr-only">Model type</legend>
    <label><input type="radio" name="provider" value="tripo3d" checked><span>3D</span></label>
    <label><input type="radio" name="provider" value="cad"><span>CAD</span></label>
  </fieldset>
  <input id="promptText" type="text" name="prompt">
  <button type="submit">Generate</button>
</form>
<div id="promptChips"></div>
<a id="footerCta" href="#prompt">Generate a model</a>`;

const tick = () => new Promise((r) => setTimeout(r, 0));
const chipTexts = () => [...document.querySelectorAll(".prompt-chip")].map((b) => b.textContent);

let form;
let input;

beforeEach(() => {
  document.body.innerHTML = FRAGMENT;
  form = document.getElementById("prompt");
  input = document.getElementById("promptText");
});

describe("initPromptForm", () => {
  test("renders the 3D placeholder and chips by default", () => {
    initPromptForm(form, { cadAvailable: Promise.resolve(true) });
    expect(input.placeholder).toBe("Describe a character or prop…");
    expect(chipTexts()).toEqual(["Low-poly fox", "Cowboy mascot", "Sci-fi crate"]);
  });

  test("switching to CAD swaps the placeholder and chips", () => {
    initPromptForm(form, { cadAvailable: Promise.resolve(true) });
    const cad = form.querySelector('input[value="cad"]');
    cad.checked = true;
    cad.dispatchEvent(new Event("change", { bubbles: true }));
    expect(input.placeholder).toBe("Describe a part…");
    expect(chipTexts()).toEqual(PROMPT_MODES.cad.examples);
  });

  test("a chip fills and focuses the input without submitting", () => {
    initPromptForm(form, { cadAvailable: Promise.resolve(true) });
    let submitted = false;
    form.addEventListener("submit", (e) => {
      submitted = true;
      e.preventDefault();
    });
    document.querySelector(".prompt-chip").click();
    expect(input.value).toBe("Low-poly fox");
    expect(document.activeElement).toBe(input);
    expect(submitted).toBe(false);
  });

  test("CAD unavailable: removes the CAD option, hides the switch, falls back to 3D", async () => {
    form.querySelector('input[value="cad"]').checked = true;
    initPromptForm(form, { cadAvailable: Promise.resolve(false) });
    await tick();
    expect(form.querySelector('input[value="cad"]')).toBeNull();
    expect(form.querySelector('input[value="tripo3d"]').checked).toBe(true);
    expect(form.querySelector(".prompt-mode").hidden).toBe(true);
    expect(input.placeholder).toBe(PROMPT_MODES.tripo3d.placeholder);
  });

  test("#prompt links focus the prompt input", () => {
    initPromptForm(form, { cadAvailable: Promise.resolve(true) });
    document.getElementById("footerCta").click();
    expect(document.activeElement).toBe(input);
  });
});
```

- [ ] **Step 2: Write the failing version-rail test**

Create `test/frontend/landing-version-demo.test.js`:

```js
// @test-env dom
/**
 * landing/version-demo: the v1–v4 rail under the landing model. Only the rail
 * wiring is unit-tested; the Babylon viewer is verified visually.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { DEMO_VERSIONS, wireVersionRail } from "../../frontend/src/js/landing/version-demo.js";

let rail;
let caption;
let seen;

beforeEach(() => {
  document.body.innerHTML = '<div id="versionRail"></div><p id="versionCaption"></p>';
  rail = document.getElementById("versionRail");
  caption = document.getElementById("versionCaption");
  seen = [];
});

const buttons = () => [...rail.querySelectorAll("button")];

describe("wireVersionRail", () => {
  test("builds one button per version with the latest selected", () => {
    wireVersionRail(rail, caption, (i) => seen.push(i));
    expect(buttons()).toHaveLength(DEMO_VERSIONS.length);
    expect(buttons().map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "false", "true"]);
    expect(buttons()[3].classList.contains("is-current")).toBe(true);
    expect(buttons().slice(0, 3).every((b) => b.classList.contains("is-past"))).toBe(true);
    expect(caption.textContent).toBe("v4 — New hat and scarf. Latest");
    expect(seen).toEqual([3]);
  });

  test("clicking a version selects it, updates the caption and reports it", () => {
    wireVersionRail(rail, caption, (i) => seen.push(i));
    buttons()[0].click();
    expect(buttons()[0].classList.contains("is-current")).toBe(true);
    expect(buttons().some((b) => b.classList.contains("is-past"))).toBe(false);
    expect(caption.textContent).toBe("v1 — Untextured mesh from a prompt");
    expect(seen.at(-1)).toBe(0);
  });

  test("the returned select() drives the rail programmatically", () => {
    const select = wireVersionRail(rail, caption, (i) => seen.push(i));
    select(2);
    expect(buttons()[2].getAttribute("aria-pressed")).toBe("true");
    expect(caption.textContent).toBe("v3 — Scaled ×1.2 by an editor");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun scripts/run-tests.mjs test/frontend/landing-prompt-form.test.js test/frontend/landing-version-demo.test.js`
Expected: both FAIL — `Cannot find module`.

- [ ] **Step 4: Implement `prompt-form.ts`**

Create `frontend/src/js/landing/prompt-form.ts`:

```ts
/**
 * Landing hero prompt form (index.pug `form#prompt`).
 * @remarks The form is a plain GET to /studio (`provider` + `prompt`), so it
 *   works without JS. This module only adds the per-mode placeholder and
 *   example chips, the CAD availability gate, and `a[href="#prompt"]` links
 *   that focus the input.
 */

export type LandingProvider = "tripo3d" | "cad";

export const PROMPT_MODES: Record<LandingProvider, { placeholder: string; examples: string[] }> = {
  tripo3d: {
    placeholder: "Describe a character or prop…",
    examples: ["Low-poly fox", "Cowboy mascot", "Sci-fi crate"],
  },
  cad: {
    placeholder: "Describe a part…",
    examples: ["M3 mounting bracket, 40 mm", "Phone stand, 70°", "Gridfinity bin 2×3"],
  },
};

export interface PromptFormOptions {
  /** Resolves false when the deployment cannot serve CAD (config.cadGeneration === false). */
  cadAvailable: Promise<boolean>;
}

export function initPromptForm(form: HTMLFormElement, { cadAvailable }: PromptFormOptions): void {
  const input = form.querySelector<HTMLInputElement>('input[name="prompt"]');
  if (!input) return;
  const chips = document.getElementById("promptChips");

  const radio = (value: LandingProvider) =>
    form.querySelector<HTMLInputElement>(`input[name="provider"][value="${value}"]`);
  const mode = (): LandingProvider =>
    form.querySelector<HTMLInputElement>('input[name="provider"]:checked')?.value === "cad" ? "cad" : "tripo3d";

  const render = () => {
    const { placeholder, examples } = PROMPT_MODES[mode()];
    input.placeholder = placeholder;
    chips?.replaceChildren(
      ...examples.map((text) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "prompt-chip";
        chip.textContent = text;
        return chip;
      }),
    );
  };

  form.addEventListener("change", (e) => {
    if ((e.target as HTMLInputElement).name === "provider") render();
  });

  chips?.addEventListener("click", (e) => {
    const chip = (e.target as HTMLElement).closest(".prompt-chip");
    if (!chip) return;
    input.value = chip.textContent ?? "";
    input.focus();
  });

  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href="#prompt"]')) {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      form.scrollIntoView?.({ block: "center" });
      input.focus({ preventScroll: true });
    });
  }

  void cadAvailable.then((available) => {
    if (available) return;
    radio("cad")?.closest("label")?.remove();
    const fallback = radio("tripo3d");
    if (fallback) fallback.checked = true;
    const switcher = form.querySelector<HTMLElement>(".prompt-mode");
    if (switcher) switcher.hidden = true;
    render();
  });

  render();
}
```

- [ ] **Step 5: Implement `version-demo.ts`**

Create `frontend/src/js/landing/version-demo.ts`:

```ts
/**
 * Landing "The world is 4D." demo (index.pug `#versionDemo`): the Howdy model
 * with a v1–v4 version rail. Babylon loads from the CDN only when the demo
 * scrolls into view; the render loop pauses off-screen. Until the viewer is
 * ready (or if it fails / JS is off) the static render stays visible.
 */

// Babylon is loaded from the CDN as a global on this page (no app bundle).
declare const BABYLON: any;

const BJS_CORE = "https://cdn.jsdelivr.net/npm/babylonjs@9.12.0/babylon.min.js";
const BJS_LOADERS = "https://cdn.babylonjs.com/v9.12.0/loaders/babylonjs.loaders.min.js";

/** v4 repaint: glTF material name → new colour. */
const REPAINT: Record<string, string> = { hat: "#1f6f78", scarf: "#d9a441" };

export const DEMO_VERSIONS = [
  { tag: "v1", label: "Generated", note: "Untextured mesh from a prompt" },
  { tag: "v2", label: "Painted", note: "Colours applied" },
  { tag: "v3", label: "Resized", note: "Scaled ×1.2 by an editor" },
  { tag: "v4", label: "Repainted", note: "New hat and scarf. Latest" },
];

/** Builds the rail buttons; keeps rail + caption in sync. Returns `select(i)`. */
export function wireVersionRail(
  rail: HTMLElement,
  caption: HTMLElement | null,
  onSelect: (i: number) => void,
): (i: number) => void {
  rail.replaceChildren(
    ...DEMO_VERSIONS.map((v, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.index = String(i);
      const tag = document.createElement("span");
      tag.className = "rail-tag";
      tag.textContent = v.tag;
      button.append(tag, v.label);
      return button;
    }),
  );

  const select = (i: number) => {
    rail.querySelectorAll("button").forEach((button, k) => {
      button.classList.toggle("is-current", k === i);
      button.classList.toggle("is-past", k < i);
      button.setAttribute("aria-pressed", String(k === i));
    });
    if (caption) caption.textContent = `${DEMO_VERSIONS[i].tag} — ${DEMO_VERSIONS[i].note}`;
    onSelect(i);
  };

  rail.addEventListener("click", (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-index]");
    if (button) select(Number(button.dataset.index));
  });

  select(DEMO_VERSIONS.length - 1);
  return select;
}

interface DemoViewer {
  setVersion(i: number): void;
  start(): void;
  stop(): void;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve();
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function mountDemoViewer(canvas: HTMLCanvasElement, reduceMotion: boolean): Promise<DemoViewer> {
  await loadScript(BJS_CORE);
  await loadScript(BJS_LOADERS);

  const engine = new BABYLON.Engine(canvas, true, { alpha: true, antialias: true });
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0, 0, 0, 0);

  const result = await BABYLON.SceneLoader.ImportMeshAsync("", "/models/", "howdy.glb", scene);
  result.meshes.forEach((m: any) => m.computeWorldMatrix(true));
  const parts = result.meshes.filter((m: any) => m.getTotalVertices?.() > 0);

  let min = new BABYLON.Vector3(Infinity, Infinity, Infinity);
  let max = new BABYLON.Vector3(-Infinity, -Infinity, -Infinity);
  for (const m of parts) {
    const box = m.getBoundingInfo().boundingBox;
    min = BABYLON.Vector3.Minimize(min, box.minimumWorld);
    max = BABYLON.Vector3.Maximize(max, box.maximumWorld);
  }
  const center = min.add(max).scale(0.5);
  const radius = max.subtract(min).length() / 2 || 1;

  // Pivot on the feet so the v3 resize grows upward, not into the floor.
  const pivot = new BABYLON.TransformNode("pivot", scene);
  pivot.position = new BABYLON.Vector3(center.x, min.y, center.z);
  result.meshes[0].setParent(pivot);

  const target = center.add(new BABYLON.Vector3(0, radius * 0.12, 0));
  const camera = new BABYLON.ArcRotateCamera("cam", Math.PI / 4, Math.PI / 2.5, radius * 5, target, scene);
  camera.fov = 0.45;
  camera.lowerBetaLimit = 0.7;
  camera.upperBetaLimit = Math.PI / 1.95;
  camera.panningSensibility = 0;
  // No wheel zoom: the wheel must keep scrolling the page.
  camera.inputs.removeByType("ArcRotateCameraMouseWheelInput");
  camera.attachControl(canvas, true);

  new BABYLON.HemisphericLight("key", new BABYLON.Vector3(0.3, 1, 0.2), scene).intensity = 0.9;
  const rim = new BABYLON.DirectionalLight("rim", new BABYLON.Vector3(-0.6, -0.2, 1), scene);
  rim.intensity = 1.2;
  rim.diffuse = new BABYLON.Color3(0.94, 0.75, 0.5);

  const clay = new BABYLON.PBRMaterial("clay", scene);
  clay.albedoColor = new BABYLON.Color3(0.62, 0.62, 0.6);
  clay.metallic = 0;
  clay.roughness = 0.85;
  const originals = parts.map((m: any) => m.material);
  const repainted = originals.map((mat: any) => {
    const hex = mat && REPAINT[mat.name];
    if (!hex) return mat;
    const copy = mat.clone(`${mat.name}-v4`);
    copy.albedoColor = BABYLON.Color3.FromHexString(hex).toLinearSpace();
    return copy;
  });

  let targetScale = 1;
  let spinning = !reduceMotion;
  canvas.addEventListener("pointerdown", () => {
    spinning = false;
  });

  const render = () => {
    engine.resize();
    if (spinning) camera.alpha += 0.003;
    const s = pivot.scaling.x + (targetScale - pivot.scaling.x) * (reduceMotion ? 1 : 0.12);
    pivot.scaling.setAll(s);
    scene.render();
  };

  return {
    setVersion(i) {
      parts.forEach((m: any, k: number) => {
        m.material = i === 0 ? clay : i === 3 ? repainted[k] : originals[k];
      });
      targetScale = i >= 2 ? 1.2 : 1;
    },
    start() {
      engine.stopRenderLoop();
      engine.runRenderLoop(render);
    },
    stop() {
      engine.stopRenderLoop();
    },
  };
}

export function initVersionDemo(figure: HTMLElement): void {
  const canvas = figure.querySelector("canvas");
  const rail = document.getElementById("versionRail");
  if (!canvas || !rail) return;

  let viewer: DemoViewer | null = null;
  let current = DEMO_VERSIONS.length - 1;
  wireVersionRail(rail, document.getElementById("versionCaption"), (i) => {
    current = i;
    viewer?.setVersion(i);
  });

  if (!("IntersectionObserver" in window)) return;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let booting = false;

  new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          viewer?.stop();
        } else if (viewer) {
          viewer.start();
        } else if (!booting) {
          booting = true;
          mountDemoViewer(canvas, reduceMotion)
            .then((v) => {
              viewer = v;
              v.setVersion(current);
              v.start();
              figure.classList.add("viewer-ready");
            })
            .catch(() => figure.classList.add("viewer-failed"));
        }
      }
    },
    { threshold: 0.2 },
  ).observe(figure);
}
```

- [ ] **Step 6: Implement the entry `landing.ts`**

Create `frontend/src/js/landing/landing.ts`:

```ts
/**
 * Landing page (index.html) script — the landing page ships no app bundle.
 * Built as a classic iife (frontend/scripts/bundle.js) and loaded with `defer`.
 * Fetches /api/v1/config once for the testnet banner and the CAD gate.
 */
import { initPromptForm } from "./prompt-form.ts";
import { initVersionDemo } from "./version-demo.ts";

// Mirrors ui/testnet-banner.ts (Base Sepolia).
const BASE_SEPOLIA = 84532;

const config: Promise<{ defaultChainId?: number | string; cadGeneration?: boolean } | null> = fetch(
  "/api/v1/config",
)
  .then((r) => r.json())
  .catch(() => null);

void config.then((cfg) => {
  if (Number(cfg?.defaultChainId) === BASE_SEPOLIA) {
    document.getElementById("testnetBanner")?.classList.add("visible");
  }
});

const form = document.getElementById("prompt");
if (form instanceof HTMLFormElement) {
  initPromptForm(form, { cadAvailable: config.then((cfg) => cfg?.cadGeneration !== false) });
}

const demo = document.getElementById("versionDemo");
if (demo) initVersionDemo(demo);
```

- [ ] **Step 7: Add the entry to the bundler**

In `frontend/scripts/bundle.js`, change the classic-scripts block:

```js
  // 4. Classic (non-module) synchronous head scripts.
  for (const rel of ['engine/theme-init', 'app/initial-view']) {
```

to:

```js
  // 4. Classic (non-module) scripts: synchronous head scripts, plus the
  //    landing page's deferred script (index.html ships no app bundle).
  for (const rel of ['engine/theme-init', 'app/initial-view', 'landing/landing']) {
```

- [ ] **Step 8: Run tests, typecheck and build**

Run: `bun scripts/run-tests.mjs test/frontend/landing-prompt-form.test.js test/frontend/landing-version-demo.test.js && bun run typecheck:frontend && (cd frontend && bun run build) && ls frontend/dist/js/landing/landing.js`
Expected: `Tests: 5 passed` and `Tests: 3 passed`; typecheck exits 0; build succeeds; the `ls` prints the path.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/js/landing frontend/scripts/bundle.js test/frontend/landing-prompt-form.test.js test/frontend/landing-version-demo.test.js
git commit -m "feat(landing): prompt-form and version-demo scripts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Rewrite the landing page (Pug + SCSS) and its tests

**Files:**
- Modify (full rewrite): `frontend/src/pug/index.pug`
- Modify (full rewrite): `frontend/src/scss/components/_landing.scss`
- Modify: `test/frontend/theme-contrast.test.js` (~lines 126–153: remove the landing-band pairs, `band()` and the band-heading test)
- Modify: `frontend/scripts/render-landing-models.js` (~lines 33–35: drop reema/suka)
- Delete: `frontend/public/landing/asset-reema.webp`, `frontend/public/landing/asset-suka.webp`
- Test: `test/frontend/landing-build.test.js` (create)

**Interfaces:**
- Consumes: `/js/landing/landing.js` and the DOM contract listed in Task 3; `.sr-only` (global, `base/_tokens.scss`); `.testnet-banner` (`_testnet-banner.scss`).
- Produces: `frontend/dist/index.html`.

- [ ] **Step 1: Write the failing build test**

Create `test/frontend/landing-build.test.js`:

```js
/**
 * Landing page build (frontend/dist/index.html) — minimal, prompt-first
 * (docs/superpowers/specs/2026-10-06-minimal-landing-design.md).
 * Needs a frontend build: (cd frontend && bun run build).
 */
import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "../../frontend/dist");
const html = () => fs.readFileSync(path.join(DIST, "index.html"), "utf-8");

describe("landing page build (index.html)", () => {
  test("the hero is the only form: a GET to /studio with provider radios and a prompt", () => {
    const h = html();
    const forms = h.match(/<form\b[^>]*>/g) ?? [];
    expect(forms).toHaveLength(1);
    expect(forms[0]).toContain('id="prompt"');
    expect(forms[0]).toContain('method="get"');
    expect(forms[0]).toContain('action="/studio"');
    expect(h).toMatch(/<input[^>]*name="provider"[^>]*value="tripo3d"[^>]*checked/);
    expect(h).toMatch(/<input[^>]*name="provider"[^>]*value="cad"/);
    expect(h).toMatch(/<input[^>]*name="prompt"[^>]*maxlength="500"[^>]*required/);
  });

  test("Library is one quiet footer link; sign-in and upload are deep links", () => {
    const h = html();
    expect(h.match(/href="\/library"/g)).toHaveLength(1);
    expect(h).toContain('href="/library?login=1"');
    expect(h).toContain('href="/library?upload=1"');
  });

  test("only the two Generate actions are orange CTAs", () => {
    expect(html().match(/class="landing-cta"/g)).toHaveLength(2);
  });

  test("the old sections are gone and nothing mentions agents", () => {
    const h = html();
    for (const gone of ["persona-card", "memory-cube", "ledger-chain", "team-scene", "band-dark", "scroll-cue"]) {
      expect(h).not.toContain(gone);
    }
    expect(h).not.toMatch(/AI agents|\bMCP\b|\bbesk\b/); // "Arbesk" has no word boundary before "besk"
  });

  test("loads the landing script and ships the version demo with its fallback", () => {
    const h = html();
    expect(h).toMatch(/<script[^>]*src="\/js\/landing\/landing\.js"[^>]*defer/);
    expect(fs.existsSync(path.join(DIST, "js/landing/landing.js"))).toBe(true);
    expect(h).toContain('id="versionDemo"');
    expect(h).toContain('id="versionRail"');
    expect(h).toContain('src="/landing/asset-howdy.webp"');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `(cd frontend && bun run build) && bun scripts/run-tests.mjs test/frontend/landing-build.test.js`
Expected: FAIL — e.g. `forms` has length 0, `/library` appears 7 times.

- [ ] **Step 3: Rewrite `index.pug`**

Replace the whole of `frontend/src/pug/index.pug` with:

```pug
doctype html
html(lang="en")
  head
    title Arbesk — Describe it. Keep every version.
    meta(charset="utf-8")
    meta(name="viewport", content="width=device-width, initial-scale=1")
    meta(name="description", content="Generate 3D models and CAD parts from a sentence. Every edit after that is saved as a version you can return to.")
    meta(property="og:title", content="Arbesk — Describe it. Keep every version.")
    meta(property="og:description", content="Generate 3D models and CAD parts from a sentence. Every edit after that is saved, forever.")
    meta(property="og:type", content="website")
    meta(property="og:site_name", content="Arbesk")
    meta(name="twitter:card", content="summary_large_image")
    //- TODO: add og:image, og:url, and rel=canonical once the production
    //- domain is fixed — those tags require absolute URLs.
    link(rel="icon", type="image/webp", href="/logo.webp")
    link(rel="apple-touch-icon", href="/apple-touch-icon.webp")
    link(rel="stylesheet", href="/css/styles.css")
    link(rel="preload", href="/fonts/inter-latin-wght-normal.woff2", as="font", type="font/woff2", crossorigin)
    script(src="/js/engine/theme-init.js")
    script(src="/js/landing/landing.js", defer)

  body.landing-page
    #app
      #testnetBanner.testnet-banner(role="status") Testnet — Base Sepolia. Assets created here are not on mainnet.
      header.landing-header
        a.landing-brand(href="/", aria-label="Arbesk home")
          img(src="/brand-logo.webp", alt="", width="78", height="52")
          span Arbesk
        a.landing-link(href="/library?login=1") Sign in

      main
        section.landing-hero
          h1
            | Describe it.
            br
            span.landing-hero-dim Keep every version.
          p.landing-hero-sub Generate 3D models and CAD parts from a sentence. Every edit after that is saved, forever.
          .landing-composer
            form#prompt.prompt(method="get", action="/studio")
              fieldset.prompt-mode
                legend.sr-only Model type
                label
                  input(type="radio", name="provider", value="tripo3d", checked)
                  span 3D
                label
                  input(type="radio", name="provider", value="cad")
                  span CAD
              input#promptText.prompt-input(type="text", name="prompt", maxlength="500", required, autocomplete="off", placeholder="Describe a character or prop…", aria-label="Describe your model")
              button.landing-cta(type="submit") Generate
            #promptChips.prompt-chips
          a.landing-link(href="/library?upload=1") or upload a model

        section.landing-demo(aria-labelledby="demoTitle")
          .landing-demo-head
            h2#demoTitle The world is 4D.
            p Time is the fourth dimension. Step back through everything this model has been.
          figure#versionDemo.landing-demo-figure
            .landing-demo-stage
              img.landing-demo-fallback(src="/landing/asset-howdy.webp", alt="Howdy, a cowboy character made in Arbesk")
              canvas(aria-label="Live 3D model — drag to rotate")
            .landing-demo-rail
              #versionRail.version-rail(role="group", aria-label="Versions")
              p#versionCaption.version-caption(aria-live="polite")

        section.landing-pillars(aria-label="How it works")
          div
            span.landing-pillar-n 01
            h3 Generate
            p Precise CAD parts or characters and props — from text or a reference image.
          div
            span.landing-pillar-n 02
            h3 Version
            p Every change is a version. Nothing is overwritten, nothing is lost.
          div
            span.landing-pillar-n 03
            h3 Share
            p Invite editors, comment on any asset, and publish when it’s ready.

      footer.landing-footer
        .landing-final
          div
            h2 Start with a sentence.
            p Sign in with an email code. No password.
          a.landing-cta(href="#prompt") Generate a model
        .landing-base
          span
            | Arbesk — from&#x20;
            em arabesque
            | .
          nav(aria-label="Footer")
            a.landing-link(href="/library") Library
            a.landing-link(href="/studio") Studio
```

- [ ] **Step 4: Rewrite `_landing.scss`**

Replace the whole of `frontend/src/scss/components/_landing.scss` with:

```scss
// ═══════════════════════════════════════════════════════════════════
// Landing page (index.html) — minimal, prompt-first.
// Spec: docs/superpowers/specs/2026-10-06-minimal-landing-design.md
// Theme tokens only; orange is reserved for Generate and the version rail.
// Everything is scoped under .landing-page, so this partial is safe in the
// shared bundle.
// ═══════════════════════════════════════════════════════════════════

html:has(.landing-page),
.landing-page,
.landing-page body {
  overflow: auto;
  height: auto;
}

.landing-page #app {
  height: auto;
  min-height: 100vh;
  overflow: visible;
}

.landing-page {
  background: var(--window-bg);
  color: var(--window-fg);
  font-family: var(--font-family);
  line-height: 1.5;

  :focus-visible {
    outline: 2px solid var(--accent-text);
    outline-offset: 3px;
    border-radius: 6px;
  }

  // ─── Shared bits ───
  .landing-link {
    color: var(--dim-fg);
    font-size: 14px;
    text-decoration: none;

    &:hover {
      color: var(--window-fg);
      text-decoration: underline;
      text-underline-offset: 3px;
    }
  }

  .landing-cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 44px;
    padding: 0 20px;
    border: 0;
    border-radius: 10px;
    background: var(--accent-bg);
    color: var(--accent-fg);
    font: 600 15px/1 var(--font-family);
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
    transition: filter 0.15s;

    &:hover { filter: brightness(1.08); }
  }

  // ─── Header ───
  .landing-header {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 64px;
    padding: 0 32px;
    background: color-mix(in srgb, var(--window-bg) 82%, transparent);
    backdrop-filter: blur(12px);
  }

  .landing-brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: var(--window-fg);
    font-size: 17px;
    font-weight: 650;
    letter-spacing: -0.01em;
    text-decoration: none;

    img { width: 36px; height: auto; }
  }

  // ─── Hero ───
  .landing-hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-content: center;
    justify-items: center;
    gap: 28px;
    min-height: calc(100svh - 64px);
    padding: 40px 16px 96px;
    text-align: center;

    h1 {
      margin: 0;
      font-size: clamp(40px, 7.2vw, 96px);
      font-weight: 700;
      line-height: 0.98;
      letter-spacing: -0.045em;
      text-wrap: balance;
    }
  }

  .landing-hero-dim { color: var(--dim-fg); }

  .landing-hero-sub {
    max-width: 34ch;
    margin: 0;
    color: var(--dim-fg);
    font-size: 18px;
  }

  .landing-composer {
    display: grid;
    gap: 14px;
    width: min(640px, 100%);
  }

  // ─── Prompt form ───
  .prompt {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 8px;
    border: 1px solid var(--hairline);
    border-radius: 14px;
    background: var(--view-bg);
    transition: border-color 0.15s;

    &:focus-within { border-color: var(--border-color); }
  }

  .prompt-input {
    flex: 1;
    min-width: 0;
    height: 40px;
    padding: 0 8px;
    border: 0;
    outline: none;
    background: none;
    color: var(--window-fg);
    font: 400 16px var(--font-family);

    &::placeholder { color: var(--dim-fg); }
  }

  .prompt-mode {
    display: inline-flex;
    flex: none;
    gap: 2px;
    margin: 0;
    padding: 3px;
    border: 0;
    border-radius: 9px;
    background: var(--raised-bg);

    &[hidden] { display: none; }

    label { position: relative; }

    input {
      position: absolute;
      inset: 0;
      margin: 0;
      opacity: 0;
      cursor: pointer;
    }

    span {
      display: block;
      padding: 8px 10px;
      border-radius: 7px;
      color: var(--dim-fg);
      font: 600 12px/1 var(--font-family);
      letter-spacing: 0.02em;
    }

    input:checked + span {
      background: var(--view-bg);
      color: var(--window-fg);
      box-shadow: 0 1px 2px color-mix(in srgb, var(--window-fg) 20%, transparent);
    }

    input:focus-visible + span {
      outline: 2px solid var(--accent-text);
      outline-offset: 1px;
    }
  }

  .prompt-chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }

  .prompt-chip {
    padding: 6px 12px;
    border: 1px solid var(--hairline);
    border-radius: 999px;
    background: none;
    color: var(--dim-fg);
    font: 400 13px var(--font-family);
    cursor: pointer;

    &:hover {
      border-color: var(--border-color);
      color: var(--window-fg);
    }
  }

  // ─── 4D demo ───
  .landing-demo {
    display: grid;
    gap: 40px;
    max-width: 1080px;
    margin: 0 auto;
    padding: 120px 16px 0;
  }

  .landing-demo-head {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    justify-content: space-between;
    gap: 24px;

    h2 {
      margin: 0;
      font-size: clamp(28px, 4vw, 44px);
      font-weight: 650;
      line-height: 1.05;
      letter-spacing: -0.03em;
    }

    p {
      max-width: 36ch;
      margin: 0;
      color: var(--dim-fg);
    }
  }

  .landing-demo-figure {
    display: grid;
    gap: 32px;
    margin: 0;
  }

  .landing-demo-stage {
    position: relative;
    aspect-ratio: 16 / 8;
    overflow: hidden;
    border-radius: 20px;
    background: radial-gradient(
      60% 70% at 50% 60%,
      color-mix(in srgb, var(--viewport-bg) 45%, var(--window-bg)) 0%,
      var(--window-bg) 75%
    );

    canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      outline: none;
      opacity: 0;
      touch-action: none;
      transition: opacity 0.4s;
    }
  }

  .landing-demo-fallback {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    padding: 6%;
  }

  .viewer-ready {
    canvas { opacity: 1; }
    .landing-demo-fallback { display: none; }
  }

  // The rail only means something once the live model can react to it.
  .landing-demo-figure:not(.viewer-ready) .landing-demo-rail { visibility: hidden; }

  .landing-demo-rail {
    width: min(640px, 100%);
    margin: 0 auto;
  }

  .version-rail {
    display: flex;
    align-items: center;
    font: 500 12px var(--font-family);

    button {
      position: relative;
      flex: 1;
      padding: 18px 4px 0;
      border: 0;
      background: none;
      color: var(--dim-fg);
      font: inherit;
      text-align: left;
      cursor: pointer;

      &::before {
        content: "";
        position: absolute;
        top: 6px;
        right: 0;
        left: 0;
        height: 2px;
        background: var(--hairline);
      }

      &::after {
        content: "";
        position: absolute;
        top: 2px;
        left: 0;
        width: 10px;
        height: 10px;
        border: 2px solid var(--border-color);
        border-radius: 50%;
        background: var(--window-bg);
      }

      &:last-child { flex: 0 0 auto; }
      &:last-child::before { display: none; }

      &.is-past::before,
      &.is-current::before { background: var(--accent-bg); }

      &.is-past::after,
      &.is-current::after {
        border-color: var(--accent-bg);
        background: var(--accent-bg);
      }

      &.is-current { color: var(--window-fg); }
    }
  }

  .rail-tag {
    display: block;
    color: var(--dim-fg);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .is-current .rail-tag { color: var(--accent-text); }

  .version-caption {
    min-height: 1.5em;
    margin: 12px 0 0;
    color: var(--dim-fg);
    font-size: 14px;
    text-align: center;
  }

  // ─── Three lines ───
  .landing-pillars {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 48px;
    max-width: 1080px;
    margin: 0 auto;
    padding: 160px 16px;

    h3 {
      margin: 0 0 8px;
      font-size: 17px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }

    p {
      margin: 0;
      color: var(--dim-fg);
      font-size: 15px;
    }
  }

  .landing-pillar-n {
    display: block;
    margin-bottom: 16px;
    color: var(--accent-text);
    font-family: var(--font-mono);
    font-size: 12px;
  }

  // ─── Footer ───
  .landing-footer {
    display: grid;
    gap: 64px;
    max-width: 1080px;
    margin: 0 auto;
    padding: 96px 16px 48px;
    border-top: 1px solid var(--hairline);
  }

  .landing-final {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 24px;

    h2 {
      margin: 0;
      font-size: clamp(28px, 4vw, 40px);
      font-weight: 650;
      letter-spacing: -0.03em;
    }

    p {
      margin: 6px 0 0;
      color: var(--dim-fg);
    }
  }

  .landing-base {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 16px;
    color: var(--dim-fg);
    font-size: 13px;

    nav {
      display: flex;
      gap: 20px;
    }
  }

  // ─── Narrow screens ───
  @media (max-width: 720px) {
    .landing-header { padding: 0 16px; }
    .landing-demo { padding-top: 96px; }
    .landing-demo-stage { aspect-ratio: 1 / 1; }

    .landing-pillars {
      grid-template-columns: 1fr;
      gap: 32px;
      padding: 96px 16px;
    }
  }

  @media (max-width: 560px) {
    .prompt {
      flex-wrap: wrap;
      padding: 8px;
    }

    .prompt-input {
      flex: 1 0 100%;
      order: -1;
      height: 44px;
    }

    .prompt .landing-cta { flex: 1; }
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      transition: none !important;
    }
  }
}
```

- [ ] **Step 5: Drop the landing-band contrast checks**

In `test/frontend/theme-contrast.test.js` delete these two entries from `DERIVED_TEXT_PAIRS`:

```js
  // _landing bands: --landing-on-dark text / hint line on --landing-dark
  ["landing band text", (t) => [band(t).onDark, band(t).bg]],
  ["landing band hint line", (t) => [mix(band(t).onDark, t["accent-text"], 0.45), band(t).bg]],
```

delete the `band()` helper:

```js
/** _landing.scss band colours: inverted on light themes, one step up on dark. */
function band(t) {
  const dark = luminance(t["window-bg"]) < 0.5;
  return dark
    ? { bg: t["view-bg"], onDark: t["window-fg"] }
    : { bg: t["window-fg"], onDark: t["window-bg"] };
}
```

and delete the band-heading test inside the `for (const name of THEMES)` loop:

```js
    // Band headings are large text (≥ 2.2rem bold): 3:1.
    test("landing band heading (accent-text) ≥ 3:1", () => {
      expect(contrast(t["accent-text"], band(t).bg)).toBeGreaterThanOrEqual(3);
    });
```

If `luminance` is now unused, run `grep -n "luminance" test/frontend/theme-contrast.test.js`; delete its definition only if no other reference remains.

- [ ] **Step 6: Remove the unused renders**

```bash
git rm frontend/public/landing/asset-reema.webp frontend/public/landing/asset-suka.webp
```

In `frontend/scripts/render-landing-models.js` delete these two lines from the models list:

```js
  { name: 'asset-reema', file: 'reemalowPoly_stamp.glb' },
  { name: 'asset-suka', file: 'sukaLowPoly_stamp.glb' },
```

- [ ] **Step 7: Build and run the landing tests**

Run: `(cd frontend && bun run build) && bun scripts/run-tests.mjs test/frontend/landing-build.test.js test/frontend/theme-contrast.test.js test/frontend/style-guards.test.js test/frontend/library-build.test.js test/frontend/build.test.js`
Expected: all files pass (`landing-build`: 5 passed).

- [ ] **Step 8: Commit**

```bash
git add -A frontend/src/pug/index.pug frontend/src/scss/components/_landing.scss frontend/scripts/render-landing-models.js test/frontend/theme-contrast.test.js test/frontend/landing-build.test.js
git commit -m "feat(landing): minimal prompt-first landing page

One Generate action (GET /studio form, works without JS), a live 4D version
demo, three short lines and quiet Library/upload links. Removes the persona
cards, colour-memory cube, CID ledger, team section and band styles.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Visual + end-to-end verification and docs

**Files:**
- Modify: `AGENTS.md` (unit-test count line ~172, only if the counts changed)
- Modify: `docs/CURRENT_STATUS.md` (only if it describes the landing page sections — check with `grep -n -i "landing" docs/CURRENT_STATUS.md`)

**Interfaces:**
- Consumes: everything above.
- Produces: verified build; screenshots in `.playwright-mcp/` (gitignored scratch, not committed).

- [ ] **Step 1: Run the whole frontend unit suite**

Run: `bun run test:frontend 2>&1 | tail -5`
Expected: `0 failed`. If failures appear in files this branch did not touch, re-run them alone in the main checkout to confirm they are pre-existing before going further.

- [ ] **Step 2: Lint + typecheck**

Run: `bun run lint && bun run typecheck:frontend`
Expected: both exit 0.

- [ ] **Step 3: Serve the worktree build**

Start the backend from the worktree on a free port, or serve `frontend/dist` statically:
`(cd frontend/dist && python3 -m http.server 8766 --bind 127.0.0.1)` (background). The `/api/v1/config` fetch will 404 there; the page must still render (testnet banner hidden, CAD shown).

- [ ] **Step 4: Visual check with Playwright**

At 1440×900 and 390×844, in Graphite (`localStorage['arbesk-theme']='graphite'`) and Paper (`'paper'`), screenshot `/` and scroll to `#versionDemo`. Confirm:
- one orange button above the fold (Generate); header shows only "Sign in";
- no horizontal scroll at 390 px (`document.documentElement.scrollWidth === 390`);
- the model is fully framed (feet and hat visible); clicking v1 turns it grey clay, v3 grows it, v4 shows the teal hat + gold scarf;
- mouse-wheel over the model scrolls the page;
- CAD toggle swaps placeholder and chips; a chip fills the input;
- submitting navigates to `/studio?provider=…&prompt=…`.

- [ ] **Step 5: Check the deep links against the real app**

With the dev stack running from this worktree (`./scripts/start-dev.sh` per AGENTS.md), open `/studio?provider=cad&prompt=M3%20bracket` → the composer holds "M3 bracket", the provider is CAD, nothing generates, the URL no longer has `prompt`. Open `/library?upload=1` signed out → the sign-in modal opens; after sign-in the Upload button is focused and pulses once.

- [ ] **Step 6: Update docs counts**

Run: `bun run test:frontend 2>&1 | grep -E "^Files:|^Tests:"` and update the `~NNNN unit tests / NNN files` figure in `AGENTS.md` (~line 172) to the new totals. Update `docs/CURRENT_STATUS.md` only if Step "Files" check found a landing description.

- [ ] **Step 7: Commit**

```bash
git add AGENTS.md docs/CURRENT_STATUS.md
git commit -m "docs: landing page refresh; sync unit-test counts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
