# AI Generation Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the AI generation experience (conversation, prompt input, provider selection, BYOK key access) into the left sidebar as an "AI Generation" section, restrict providers to Mock + Tripo 3D, and drop the viewport-bottom messagebar.

**Architecture:** Pure frontend reshuffle — Pug markup moves (element ids preserved), SCSS relocated from `_messagebar.scss` into `_chat.scss`, rail reorder in `sidebar.js`, and `create-panel.js` gains provider persistence plus a `showCustomDialog`-based BYOK key dialog (the key input leaves the persistent DOM; `getByokKey()` reads localStorage). No backend, schema, or contract changes. Spec: `docs/superpowers/specs/2026-07-19-ai-generation-sidebar-design.md`.

**Tech Stack:** Pug, SCSS (custom design system), vanilla ES-module JS, Jest (structural integrity tests), Playwright (E2E).

---

### Task 1: Failing structural tests

**Files:**
- Modify: `test/frontend/deployment-integrity.test.js` (append at end of file)

- [ ] **Step 1: Add the failing test block**

Append this `describe` block at the **end of the file, top level** (after the final `});` — the file's existing `describe("Deployment Pipeline Integrity")` closes on the last line; the new block is a sibling). `ROOT_DIR`, `resolve`, and `readFileSync` are already imported at the top of the file.

```js
describe("AI Generation sidebar", () => {
  const STUDIO_PUG_PATH = resolve(ROOT_DIR, "frontend/src/pug/app.pug");
  const pug = () => readFileSync(STUDIO_PUG_PATH, "utf-8");

  test("provider select offers only Mock and Tripo 3D", () => {
    const content = pug();
    expect(content).toContain('option(value="mock") Mock (Local)');
    expect(content).toContain('option(value="tripo3d") Tripo 3D');
    expect(content).not.toContain('value="meshy"');
    expect(content).not.toContain('value="hunyuan3d"');
  });

  test("prompt input lives in the sidebar, before the main stage", () => {
    const content = pug();
    expect(content).toContain("textarea#promptInput");
    expect(content.indexOf("textarea#promptInput")).toBeLessThan(
      content.indexOf("main#mainStage"),
    );
  });

  test("AI Generation is the first rail button with an explicit AI label", () => {
    const content = pug();
    expect(content).toContain('aria-label="AI Generation"');
    expect(content.indexOf('data-view="chat"')).toBeLessThan(
      content.indexOf('data-view="settings"'),
    );
  });

  test("provider row has a configure-key button and a missing-key hint", () => {
    const content = pug();
    expect(content).toContain("button#providerKeyBtn");
    expect(content).toContain("#providerKeyHint");
  });

  test("BYOK key input is not inlined (it lives in the key dialog)", () => {
    expect(pug()).not.toContain("input#providerKeyInput");
  });

  test("bottom bar provider status is live-bindable", () => {
    expect(pug()).toContain("span#bottomBarProvider");
  });

  test("sidebar view order puts chat first", () => {
    const src = readFileSync(
      resolve(ROOT_DIR, "frontend/src/js/ui/sidebar.js"),
      "utf-8",
    );
    expect(src).toContain(
      'const VIEWS = ["chat", "settings", "outline", "library", "ledger"]',
    );
  });

  test("keyboard help lists all five sidebar shortcuts", () => {
    const src = readFileSync(
      resolve(ROOT_DIR, "frontend/src/js/ui/keyboard-help.js"),
      "utf-8",
    );
    expect(src).toContain("1 – 5");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/deployment-integrity.test.js --runInBand --silent`
Expected: FAIL — 8 new tests fail (app.pug still has `meshy`/`hunyuan3d` options, prompt input still inside `main#mainStage`, no `AI Generation` label, no `#providerKeyBtn`/`#providerKeyHint`, `input#providerKeyInput` still inlined in Settings, no `#bottomBarProvider`, old VIEWS order, `1 – 4` in keyboard help). All pre-existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add test/frontend/deployment-integrity.test.js
git commit -m "test: add AI generation sidebar structural integrity tests"
```

---

### Task 2: Pug restructure (`app.pug`)

**Files:**
- Modify: `frontend/src/pug/app.pug` (rail lines 111-117, settings view lines 155-167, chat view lines 180-190, messagebar lines 264-276, bottom bar line 341)

- [ ] **Step 1: Reorder the icon rail — AI Generation first, Settings second**

Replace the settings button block followed by the chat button block (currently lines 111-117):

```pug
              button.sidebar-switcher-btn.active(data-view="settings" role="tab" aria-selected="true" tabindex="0" aria-label="Settings" title="Settings (Ctrl+1)")
                svg(width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
                  circle(cx="12" cy="12" r="3")
                  path(d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z")
              button.sidebar-switcher-btn(data-view="chat" role="tab" aria-selected="false" tabindex="-1" aria-label="Chat" title="Chat (Ctrl+2)")
                svg(width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
                  path(d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z")
```

with (AI Generation first, active, sparkle icon; Settings second — gear SVG unchanged):

```pug
              button.sidebar-switcher-btn.active(data-view="chat" role="tab" aria-selected="true" tabindex="0" aria-label="AI Generation" title="AI Generation (Ctrl+1)")
                svg(width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
                  path(d="M12 3 L13.8 10.2 L21 12 L13.8 13.8 L12 21 L10.2 13.8 L3 12 L10.2 10.2 Z")
              button.sidebar-switcher-btn(data-view="settings" role="tab" aria-selected="false" tabindex="-1" aria-label="Settings" title="Settings (Ctrl+2)")
                svg(width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
                  circle(cx="12" cy="12" r="3")
                  path(d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z")
```

The Outline / Gallery / Activity buttons keep their `Ctrl+3/4/5` titles unchanged.

- [ ] **Step 2: Remove provider + BYOK controls from the Settings view**

Delete these two form-groups from the Settings view (currently lines 155-167), keeping the Collection group above and the Quality Tier group below:

```pug
                    .form-group
                      label.form-label(for="providerSelect") Generation Provider
                      select#providerSelect.form-select
                        option(value="mock") Mock (Local)
                        option(value="meshy") Meshy
                        option(value="tripo3d") Tripo3D
                        option(value="hunyuan3d") Hunyuan3D
                    .form-group
                      label.form-label(for="providerKeyInput") Generation API Key
                      .byok-field
                        input#providerKeyInput.form-control(type="password", placeholder="sk-… (optional)", autocomplete="off", aria-describedby="byokHelp")
                        button#providerKeyToggle.byok-toggle(type="button", aria-label="Show API key") Show
                      .form-help#byokHelp Bring your own key for the selected provider to generate without the free-tier on-chain quota.
```

- [ ] **Step 3: Rebuild the chat view as "AI Generation" with the pinned composer**

Replace the entire chat view block (currently lines 180-190):

```pug
              //- View: Chat
              .sidebar-view(data-view="chat" hidden)
                .sidebar-view-header
                  h3 Chat
                .sidebar-view-body
                  #chatHistory
                    #chatHistoryList.chat-history-list
                      .chat-welcome
                        .welcome-icon ✦
                        p.welcome-text Create an asset
                        p.welcome-sub Describe the 3D asset you want to generate.
```

with:

```pug
              //- View: AI Generation (data-view kept as "chat" for selector stability)
              .sidebar-view(data-view="chat" hidden)
                .sidebar-view-header
                  h3 AI Generation
                .sidebar-view-body
                  #chatHistory
                    #chatHistoryList.chat-history-list
                      .chat-welcome
                        .welcome-icon ✦
                        p.welcome-text Create an asset
                        p.welcome-sub Describe the 3D asset you want to generate.
                  .chat-composer
                    .form-group
                      label.form-label(for="providerSelect") Generation Provider
                      .provider-row
                        select#providerSelect.form-select
                          option(value="mock") Mock (Local)
                          option(value="tripo3d") Tripo 3D
                        button#providerKeyBtn.provider-key-btn(type="button" hidden aria-label="Configure API key" title="Configure Tripo 3D API key")
                          svg(width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
                            path(d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4")
                      p#providerKeyHint.provider-key-hint(hidden) API key required — select the key icon to add it.
                    .messagebar-row
                      textarea#promptInput.messagebar-input(placeholder="Describe the 3D asset you envision…" rows="1" aria-label="Asset generation prompt")
                      button#generateBtn.messagebar-submit(aria-label="Generate asset")
                        svg.messagebar-submit-icon(width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true")
                          polygon(points="12 2 22 12 12 22 12 16 2 16 2 8 12 8")
                        .messagebar-spinner
                    p#generateHint.messagebar-hint(hidden)
                      svg.messagebar-hint-icon(width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
                        rect(x="3" y="11" width="18" height="11" rx="2" ry="2")
                        path(d="M7 11V7a5 5 0 0 1 10 0v4")
                      span Sign in to start generating assets.
```

The `messagebar-*` class names are intentionally retained — JS and tests key off ids, and keeping classes minimizes the SCSS diff. The key icon is the stock Feather "key" glyph.

- [ ] **Step 4: Delete the messagebar from the main stage**

Delete this block (currently lines 264-276), including the `//- Message bar` comment:

```pug
            //- Message bar
            .messagebar
              .messagebar-row
                textarea#promptInput.messagebar-input(placeholder="Describe the 3D asset you envision…" rows="1" aria-label="Asset generation prompt")
                button#generateBtn.messagebar-submit(aria-label="Generate asset")
                  svg.messagebar-submit-icon(width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true")
                    polygon(points="12 2 22 12 12 22 12 16 2 16 2 8 12 8")
                  .messagebar-spinner
              p#generateHint.messagebar-hint(hidden)
                svg.messagebar-hint-icon(width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
                  rect(x="3" y="11" width="18" height="11" rx="2" ry="2")
                  path(d="M7 11V7a5 5 0 0 1 10 0v4")
                span Sign in to start generating assets.
```

- [ ] **Step 5: Live-bindable bottom bar provider status**

Replace line 341:

```pug
            span.bottombar-status-item Provider: Mock
```

with:

```pug
            span#bottomBarProvider.bottombar-status-item Provider: Mock (Local)
```

- [ ] **Step 6: Verify the Pug compiles**

Run: `npm run build:frontend`
Expected: build succeeds. Then:

```bash
grep -c "AI Generation" frontend/dist/app.html        # expect >= 2
grep -c 'value="meshy"' frontend/dist/app.html        # expect 0
grep -c 'class="messagebar"' frontend/dist/app.html   # expect 0
grep -c 'id="promptInput"' frontend/dist/app.html     # expect 1
grep -c 'id="providerKeyBtn"' frontend/dist/app.html  # expect 1
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pug/app.pug
git commit -m "feat(ui): move AI generation into left sidebar, trim providers to Mock + Tripo 3D"
```

---

### Task 3: SCSS — relocate messagebar styles into the chat pane

**Files:**
- Modify: `frontend/src/scss/components/_chat.scss`
- Delete: `frontend/src/scss/components/_messagebar.scss`
- Modify: `frontend/src/scss/styles.scss:20`
- Modify: `frontend/src/scss/utilities/_responsive.scss:169-171`
- Modify: `frontend/src/scss/base/_tokens.scss:266`

- [ ] **Step 1: Rewrite `_chat.scss` with the composer layout + moved messagebar styles**

Replace the entire content of `frontend/src/scss/components/_chat.scss` with:

```scss
// ═══════════════════════════════════════════════════════════════════
// AI Generation Pane — conversation log + pinned composer (chat sidebar view)
// ═══════════════════════════════════════════════════════════════════

// The composer is pinned to the bottom of the view, so the view body stops
// scrolling itself and becomes a vertical flex container.
.sidebar-view[data-view="chat"] .sidebar-view-body {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
}

#chatHistory {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  padding: var(--size-3);
}

.chat-history-list {
  display: flex;
  flex-direction: column;
  gap: var(--size-2);
}

.chat-welcome {
  text-align: center;
  padding: var(--size-7) var(--size-2);
  opacity: 0.7;

  .welcome-icon {
    font-size: var(--size-7);
    color: var(--accent-bg);
    margin-bottom: var(--size-3);
  }

  .welcome-text {
    font-size: var(--font-size-2);
    font-weight: var(--font-weight-6);
    color: var(--accent-bg);
    margin: 0 0 var(--size-2);
  }

  .welcome-sub {
    font-size: var(--font-size-1);
    color: var(--dim-fg);
    margin: 0;
    line-height: var(--font-lineheight-3);
  }
}

.chat-bubble {
  max-width: 90%;
  padding: var(--size-2) var(--size-3);
  border-radius: var(--radius-3);
  font-size: var(--font-size-1);
  line-height: var(--font-lineheight-2);
  word-break: break-word;

  &-user {
    align-self: flex-end;
    background-color: var(--accent-bg);
    color: var(--accent-fg);
    border-bottom-right-radius: var(--size-1);
    font-weight: var(--font-weight-6);
  }

  &-system {
    align-self: flex-start;
    background-color: var(--card-bg);
    color: var(--sidebar-fg);
    border: var(--border-size-1) solid var(--border-hairline);
    border-bottom-left-radius: var(--size-1);
  }
}

.chat-bubble-time {
  display: block;
  margin-top: var(--size-1);
  font-size: var(--font-size-0);
  font-weight: var(--font-weight-4);
  opacity: 0.7;

  .chat-bubble-system & {
    color: var(--dim-fg);
  }
}

// ─── Composer — provider controls + prompt input, pinned at pane bottom ───

.chat-composer {
  display: flex;
  flex-direction: column;
  gap: var(--size-2);
  padding: var(--size-2) var(--size-3);
  background-color: var(--card-bg);
  border-top: var(--border-size-1) solid var(--border-hairline);
  flex-shrink: 0;
  transition: box-shadow var(--duration-quick) var(--ease-out-3);

  // The whole composer lights up gently while composing a prompt.
  &:focus-within {
    box-shadow: var(--glow-accent);
  }

  // Composer rows are stacked via gap, not form-group margins.
  .form-group {
    margin-bottom: 0;
  }
}

// Provider select + key configure button on one row.
.provider-row {
  display: flex;
  align-items: center;
  gap: var(--size-2);

  .form-select {
    flex: 1;
    min-width: 0;
  }
}

.provider-key-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: var(--dim-fg);
  border-radius: var(--radius-3);
  flex-shrink: 0;

  &:hover {
    color: var(--view-fg);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  // Tripo 3D selected but no key stored yet.
  &.attention {
    color: var(--yellow-4);
  }
}

.provider-key-hint {
  margin: 0;
  font-size: var(--font-size-0);
  color: var(--yellow-4);

  &[hidden] {
    display: none;
  }
}

// Input + submit sit on one row; the hint (when shown) drops below it.
.messagebar-row {
  display: flex;
  align-items: flex-end;
  gap: var(--size-2);
}

.messagebar-input {
  flex: 1;
  padding: var(--size-2) var(--size-3);
  font-size: var(--font-size-1);
  font-family: var(--font-family);
  line-height: var(--font-lineheight-3);
  color: var(--view-fg);
  background-color: var(--view-bg);
  border: var(--border-size-1) solid var(--border-color);
  border-radius: var(--radius-3);
  resize: none;
  min-height: 24px;
  max-height: 120px;

  &::placeholder {
    color: var(--dim-fg);
  }

  &:focus {
    outline: none;
    border-color: var(--accent-bg);
    box-shadow: var(--focus-ring);
  }
}

.messagebar-submit {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background-color: var(--accent-bg);
  color: var(--accent-fg);
  border-radius: var(--radius-round);
  flex-shrink: 0;
  transition: background-color var(--duration-quick) var(--ease-out-3);

  &:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  svg {
    width: 20px;
    height: 20px;
  }

  // Spinner state (replaces icon during generation)
  &.generating {
    .messagebar-submit-icon { display: none; }
    .messagebar-spinner { display: block; }
  }
}

.messagebar-spinner {
  display: none;
  width: 20px;
  height: 20px;
  border: 2px solid var(--accent-fg);
  border-top-color: transparent;
  border-radius: 50%;
}

@media (prefers-reduced-motion: no-preference) {
  .messagebar-spinner {
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
}

@media (prefers-reduced-motion: reduce) {
  .messagebar-spinner {
    opacity: 0.6;
  }
}

// Disconnected guidance — a calm centered caption under the input row,
// not stray text beside the button. The submit button is disabled while
// gated (see create-panel.js), so it reads muted rather than live.
.messagebar-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--size-1);
  font-size: var(--font-size-0);
  color: var(--dim-fg);

  .messagebar-hint-icon {
    flex-shrink: 0;
    opacity: 0.75;
  }

  &[hidden] {
    display: none;
  }
}
```

Notes: the old `.messagebar` wrapper rules (`min-height: var(--messagebar-min-height)`, `border-top`, glow) are absorbed by `.chat-composer`; the wrapper itself no longer exists. `.byok-field` / `.byok-toggle` stay in `_settings.scss` — they are global classes, now consumed by the key dialog body (Task 4).

- [ ] **Step 2: Delete `_messagebar.scss`**

```bash
rm frontend/src/scss/components/_messagebar.scss
```

- [ ] **Step 3: Remove the import in `styles.scss`**

Delete line 20 of `frontend/src/scss/styles.scss`:

```scss
@use 'components/messagebar';
```

- [ ] **Step 4: Remove the obsolete responsive override**

Delete this block from `frontend/src/scss/utilities/_responsive.scss` (lines 169-171, inside the small-screen media query):

```scss
  .messagebar {
    padding: var(--size-2);
  }
```

- [ ] **Step 5: Remove the orphaned token**

Delete line 266 of `frontend/src/scss/base/_tokens.scss` (its only consumer was the deleted `.messagebar` wrapper):

```scss
  --messagebar-min-height: 52px;
```

- [ ] **Step 6: Verify the CSS builds and the styles moved**

Run: `npm run build:frontend`
Expected: build succeeds. Then:

```bash
grep -c ".messagebar-input" frontend/dist/css/styles.css   # expect >= 1
grep -c "chat-composer" frontend/dist/css/styles.css       # expect >= 1
grep -rc "messagebar" frontend/src/scss/                    # expect matches only in _chat.scss
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/scss
git commit -m "refactor(scss): relocate messagebar styles into the AI generation chat pane"
```

---

### Task 4: JS — rail order, provider persistence, BYOK key dialog, bottom bar binding

**Files:**
- Modify: `frontend/src/js/ui/sidebar.js:4-5,10`
- Modify: `frontend/src/js/ui/keyboard-help.js:19`
- Modify: `frontend/src/js/ui/create-panel.js:3-6,14,36-37,46-52,63-83,246-256,350-351`

(Line numbers refer to the file before this task; they shift ±a few lines as earlier steps land. The quoted old-code blocks are the source of truth — match on those, not on line numbers.)

- [ ] **Step 1: Reorder views in `sidebar.js` and fix the stale header comment**

Replace lines 4-5:

```js
 * Single sidebar with 4-view switcher replacing 3 separate panels.
 * Views: Create, Outline, Library, Ledger.
```

with:

```js
 * Single sidebar with a 5-view switcher.
 * Views: AI Generation (chat), Settings, Outline, Gallery, Ledger.
```

Replace line 10:

```js
const VIEWS = ["settings", "chat", "outline", "library", "ledger"];
```

with:

```js
const VIEWS = ["chat", "settings", "outline", "library", "ledger"];
```

(No other change: the default view is already `"chat"`, the storage key is unchanged, and Ctrl+1–5 indexes into this array, so the reorder automatically renumbers the shortcuts to match the new rail order.)

- [ ] **Step 2: Fix the stale shortcut range in `keyboard-help.js`**

Replace line 19:

```js
      [`${MOD}+1 – 4`, "Switch sidebar panel"],
```

with:

```js
      [`${MOD}+1 – 5`, "Switch sidebar panel"],
```

- [ ] **Step 3: `create-panel.js` — import the dialog host**

Replace line 14:

```js
import { showToast } from "./toasts.js";
```

with:

```js
import { showToast } from "./toasts.js";
import { showCustomDialog } from "./dialog.js";
```

- [ ] **Step 4: `create-panel.js` — swap the BYOK DOM refs**

Replace lines 36-37:

```js
const providerKeyInput = document.getElementById("providerKeyInput");
const providerKeyToggle = document.getElementById("providerKeyToggle");
```

with:

```js
const providerKeyBtn = document.getElementById("providerKeyBtn");
const providerKeyHint = document.getElementById("providerKeyHint");
const bottomBarProvider = document.getElementById("bottomBarProvider");
```

(`#providerKeyInput` no longer exists at module load — it is created per key-dialog open, so the old refs are removed, not kept.)

- [ ] **Step 5: `create-panel.js` — `getByokKey()` reads localStorage**

Replace lines 50-52:

```js
function getByokKey() {
  return (providerKeyInput?.value || "").trim();
}
```

with:

```js
function getByokKey() {
  return (localStorage.getItem(BYOK_KEY_STORAGE) || "").trim();
}
```

- [ ] **Step 6: `create-panel.js` — replace the inline-BYOK wiring with the key dialog + provider sync**

Replace the two blocks currently at lines 63-83:

```js
// Persist + hydrate the BYOK key. Saved on input so it survives reloads; loaded
// on init so a returning user doesn't have to re-enter it.
if (providerKeyInput) {
  providerKeyInput.value = localStorage.getItem(BYOK_KEY_STORAGE) || "";
  providerKeyInput.addEventListener("input", () => {
    localStorage.setItem(BYOK_KEY_STORAGE, providerKeyInput.value);
  });
}

// Show/hide toggle for the key field (type password ⇄ text).
if (providerKeyToggle && providerKeyInput) {
  providerKeyToggle.addEventListener("click", () => {
    const hidden = providerKeyInput.type === "password";
    providerKeyInput.type = hidden ? "text" : "password";
    providerKeyToggle.setAttribute(
      "aria-label",
      hidden ? "Hide API key" : "Show API key"
    );
    providerKeyToggle.textContent = hidden ? "Hide" : "Show";
  });
}
```

with:

```js
// ─── BYOK Key Dialog ───

// Persist + hydrate the generation provider. A stored value that no longer
// exists among the select options (e.g. a removed provider) is ignored, so
// the markup default (mock) wins.
const PROVIDER_STORAGE = "arbesk-provider";

/**
 * Sync provider-dependent UI for the current selection: the key configure
 * button only applies to real providers, the hint + attention state flag a
 * missing key, and the bottom bar mirrors the active selection.
 */
function syncProviderUI() {
  const real = isRealProvider();
  const missingKey = real && getByokKey().length === 0;
  if (providerKeyBtn) {
    providerKeyBtn.hidden = !real;
    providerKeyBtn.classList.toggle("attention", missingKey);
  }
  if (providerKeyHint) providerKeyHint.hidden = !missingKey;
  if (bottomBarProvider && providerSelect) {
    const label = providerSelect.selectedOptions[0]?.textContent || "Mock";
    bottomBarProvider.textContent = `Provider: ${label}`;
  }
}

if (providerSelect) {
  const storedProvider = localStorage.getItem(PROVIDER_STORAGE);
  const knownProvider = Array.from(providerSelect.options).some(
    (o) => o.value === storedProvider
  );
  if (storedProvider && knownProvider) {
    providerSelect.value = storedProvider;
  }
  providerSelect.addEventListener("change", () => {
    localStorage.setItem(PROVIDER_STORAGE, providerSelect.value);
    syncProviderUI();
  });
}

/**
 * Build the key dialog body: a password input (prefilled from localStorage,
 * persisted on input), a show/hide toggle, and a Clear Key action. The input
 * only exists while the dialog is open; the stored key lives in localStorage.
 * All markup is static — no user content is injected.
 * @returns {HTMLElement}
 */
function buildProviderKeyBody() {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <p style="margin:0 0 var(--size-2)">Bring your own Tripo 3D key to generate without the free-tier on-chain quota. The key is stored only in this browser and sent with each generation request.</p>
    <div class="form-group">
      <label class="form-label" for="providerKeyInput">Tripo 3D API Key</label>
      <div class="byok-field">
        <input id="providerKeyInput" class="form-control" type="password" placeholder="sk-…" autocomplete="off">
        <button id="providerKeyToggle" class="byok-toggle" type="button" aria-label="Show API key">Show</button>
      </div>
    </div>
    <button id="providerKeyClear" class="btn btn-secondary" type="button" style="margin-top:var(--size-2)">Clear Key</button>`;

  const input = /** @type {HTMLInputElement} */ (
    wrap.querySelector("#providerKeyInput")
  );
  const toggle = /** @type {HTMLButtonElement} */ (
    wrap.querySelector("#providerKeyToggle")
  );
  const clear = /** @type {HTMLButtonElement} */ (
    wrap.querySelector("#providerKeyClear")
  );

  input.value = localStorage.getItem(BYOK_KEY_STORAGE) || "";
  input.addEventListener("input", () => {
    localStorage.setItem(BYOK_KEY_STORAGE, input.value);
    syncProviderUI();
  });

  toggle.addEventListener("click", () => {
    const hidden = input.type === "password";
    input.type = hidden ? "text" : "password";
    toggle.setAttribute("aria-label", hidden ? "Hide API key" : "Show API key");
    toggle.textContent = hidden ? "Hide" : "Show";
  });

  clear.addEventListener("click", () => {
    input.value = "";
    localStorage.removeItem(BYOK_KEY_STORAGE);
    syncProviderUI();
  });

  return wrap;
}

function showProviderKeyDialog() {
  return showCustomDialog("Tripo 3D API Key", buildProviderKeyBody());
}

if (providerKeyBtn) {
  providerKeyBtn.addEventListener("click", () => {
    showProviderKeyDialog();
  });
}
```

(`isRealProvider` and `getByokKey` are function declarations, so they hoist above this block.)

- [ ] **Step 7: `create-panel.js` — the BYOK guard opens the key dialog**

Replace the guard block (currently lines 246-256):

```js
    // Real providers require a BYOK key; mock does not. The on-chain
    // quota/payment gate is never used by the generation route.
    if (isRealProvider() && providerKey.length === 0) {
      showToast({
        type: "warning",
        title: "Provider Key Required",
        message: `Add your ${provider} API key in Settings to generate.`,
      });
      setGenerating(false);
      return;
    }
```

with:

```js
    // Real providers require a BYOK key; mock does not. A missing key opens
    // the key dialog directly — a guided flow, not a dead-end toast.
    if (isRealProvider() && providerKey.length === 0) {
      showProviderKeyDialog();
      setGenerating(false);
      return;
    }
```

(`showToast` stays imported — the sign-in toast at line 219 still uses it.)

- [ ] **Step 8: `create-panel.js` — init call**

Replace lines 350-351:

```js
syncAssetNameDisplay();
updateGenerateHint();
```

with:

```js
syncAssetNameDisplay();
updateGenerateHint();
syncProviderUI();
```

- [ ] **Step 9: `create-panel.js` — fix the stale file-header comment**

Replace lines 3-6:

```js
/**
 * Arbesk Chat Studio UI Controller
 *
 * Real PayGo generation flow: wallet payment → backend generation →
 * manifest load → scene graph registration.
 */
```

with:

```js
/**
 * Arbesk AI Generation UI Controller
 *
 * Generation flow: session auth → backend generation → manifest load →
 * scene graph registration. Owns the AI Generation sidebar pane: chat
 * history, prompt input, provider selection, and the BYOK key dialog.
 */
```

- [ ] **Step 10: Run lint + typecheck**

Run: `npm run lint && npm run typecheck:frontend`
Expected: both pass clean.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/js/ui/sidebar.js frontend/src/js/ui/keyboard-help.js frontend/src/js/ui/create-panel.js
git commit -m "feat(ui): persist provider, BYOK key dialog, live bottom-bar provider, AI-first rail order"
```

---

### Task 5: Full verification — build, Jest, lint, typecheck

**Files:** none (verification only)

- [ ] **Step 1: Rebuild the frontend**

Run: `npm run build:frontend`
Expected: success. Sanity-check the built output:

```bash
grep -c "AI Generation" frontend/dist/app.html        # expect >= 2
grep -c 'value="meshy"' frontend/dist/app.html        # expect 0
grep -c 'class="messagebar"' frontend/dist/app.html   # expect 0
grep -c 'id="providerKeyBtn"' frontend/dist/app.html  # expect 1
```

- [ ] **Step 2: Run the Task 1 structural tests — they must now pass**

Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/deployment-integrity.test.js --runInBand --silent`
Expected: PASS — all 8 new tests green, no regressions in the existing suites.

- [ ] **Step 3: Run the full Jest suite**

Run: `npm test`
Expected: all suites pass (backend untouched, so `test/api.test.js` BYOK cases stay green).

- [ ] **Step 4: Lint + typecheck**

Run: `npm run lint && npm run typecheck && npm run typecheck:frontend`
Expected: all clean.

- [ ] **Step 5: Commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore: verification fixes for AI generation sidebar"
```

(Skip if the tree is already clean.)

---

### Task 6: Docs sweep for stale references

**Files:** possibly `e2e/README.md`, `docs/*.md`, `AGENTS.md`, `CLAUDE.md` (only if matches found)

- [ ] **Step 1: Search for stale references**

```bash
grep -rn "Chat (Ctrl" docs/ e2e/ AGENTS.md CLAUDE.md 2>/dev/null
grep -rn "messagebar" docs/ e2e/ AGENTS.md CLAUDE.md 2>/dev/null
grep -rn "meshy\|hunyuan" docs/ e2e/ AGENTS.md CLAUDE.md 2>/dev/null
grep -rn "providerKeyInput" docs/ e2e/ AGENTS.md CLAUDE.md 2>/dev/null
```

- [ ] **Step 2: Update any hits**

For each hit, update the text to match the new reality: the left sidebar's first view is "AI Generation" (Ctrl+1), the messagebar no longer exists (prompt input lives in the AI Generation pane), the provider select offers only Mock (Local) and Tripo 3D, and the BYOK key is configured via the key-icon button → "Tripo 3D API Key" dialog rather than an inline Settings field. Selector references (`#promptInput`, `#generateBtn`, `#providerSelect`, `data-view="chat"`) are unchanged and must not be "fixed". If there are no hits, this task is a no-op.

- [ ] **Step 3: Commit (only if files changed)**

```bash
git add docs/ e2e/ AGENTS.md CLAUDE.md
git commit -m "docs: sync AI generation sidebar references"
```

---

### Task 7: E2E suite + manual smoke

**Files:** none expected (selectors are id- and `data-view`-based, all preserved)

- [ ] **Step 1: Start the dev stack if not running**

Run: `./scripts/start-dev.sh --setup-only`
Expected: IPFS + Hardhat + Nostr containers up.

- [ ] **Step 2: Run the full E2E suite**

Run: `npm run test:e2e -- --project=chromium`
Expected: all 35 tests pass. Known-good by construction: `flows.mjs generate()` uses `#promptInput`/`#generateBtn`/`#chatHistoryList` (all preserved); spec 07 switches to Settings for `#collectionSelect` (still there); spec 99 toggles `#sidebarToggle` (unchanged). If a spec does break, sync `e2e/helpers/studio-selectors.mjs` per `e2e/README.md` — do not weaken assertions.

- [ ] **Step 3: Manual smoke (headed browser)**

Run: `npm run test:e2e:ui -- --project=chromium` or start the app (`./scripts/start-dev.sh`, open the Studio URL) and verify:

- AI Generation is the first rail icon (sparkle), active by default; Settings is second.
- Prompt input + provider row sit at the bottom of the AI Generation pane; the key button is hidden while Mock is selected.
- Generate with Mock → user bubble + "Model carved via mock." system bubble appear in the pane history.
- Switch to Tripo 3D → key icon appears highlighted with the "API key required" hint; generate without a key → the "Tripo 3D API Key" dialog opens; save a key → hint clears; reopen the dialog → key prefilled; Clear Key → hint returns.
- Reload the page → provider selection persisted; bottom bar reads `Provider: <selection>`.
- Ctrl+1..5 switch views in the new order; Ctrl+/ help dialog shows `Ctrl/⌘+1 – 5`.
- Collapse/expand the sidebar → viewport resizes cleanly, no stretch.

- [ ] **Step 4: Final commit (only if E2E fixes were needed)**

```bash
git add -A
git commit -m "test(e2e): sync specs with AI generation sidebar"
```
