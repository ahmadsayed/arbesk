# Alpine.js — stateful-panel migration playbook

How Arbesk Studio uses Alpine.js for stateful panels. Follow this when
converting an imperative DOM module to Alpine, or adding a new reactive panel.
The canonical consumers are dialog.ts, wallet-popover.ts, ledger-panel.ts,
header-wallet-button.ts, collaborators-panel.ts, and chat-messages.ts.

## The canonical pattern (store + getter + template)

1. **Register** the component via registerAlpineComponent(name, factory) in
   frontend/src/js/ui/alpine.ts (never call Alpine.start() yourself — the
   loader schedules it once on DOMContentLoaded).

   ~~~ts
   import { Alpine, registerAlpineComponent } from "./alpine.ts";

   // Shared reactive state lives in a store. NOTE: Alpine.store(name, value)
   // is a SETTER (returns undefined) — read it back afterward.
   let _state: MyState | null = null;
   function state(): MyState {
     if (!_state) {
       if (!Alpine.store("myPanel")) Alpine.store("myPanel", { /* defaults */ });
       _state = Alpine.store("myPanel") as MyState;
     }
     return _state;
   }

   export function myPanel() {
     return {
       get someField() { return state().someField; },   // getters read the store
       doThing() { /* mutate state() or delegate */ },
     };
   }
   registerAlpineComponent("myPanel", myPanel);
   ~~~

2. **Template** (x-data="myPanel" in Pug) uses x-text / x-show / x-if / x-for /
   x-model / @click / :class / :key.

3. **External code mutates the store, never the component's captured 'this'.**
   Mutating a component's 'this' from outside an Alpine expression does NOT
   trigger reactivity — store writes always do.

4. **init() must SEED from source stores before subscribing.** Page-load flows
   (wallet auto-connect) can emit before Alpine.start(); a subscription-only
   init() misses those earlier events.

## Parameterized + dynamically-injected components

registerAlpineComponent accepts (...args: any[]) => object factories, so
x-data="name({...})" passes params (JSON.stringify them into the attribute):

~~~ts
function collaboratorPanel(params: { id: string; tokenId: string | number; editable: boolean }) {
  const state = Alpine.reactive({ /* per-instance fields */ });
  byId.set(params.id, state);
  return { get canEdit() { return state.editable && state.isOwner; }, /* … */ };
}
registerAlpineComponent("collaboratorPanel", collaboratorPanel);

export function initCollaboratorPanel(container, tokenId, opts) {
  container.innerHTML = TEMPLATE;                          // static HTML string
  container.setAttribute("x-data", "collaboratorPanel(" + JSON.stringify({ id, tokenId, editable }) + ")");
  Alpine.initTree(container);                              // initialize the subtree
  return { refresh, destroy: () => destroyCollaboratorPanel(container) };
}
function destroyCollaboratorPanel(container) {
  if (container.hasAttribute("x-data")) {
    Alpine.destroyTree(container);
    container.removeAttribute("x-data");
  }
  container.innerHTML = "";
}
~~~

- **Use Alpine.initTree(el)** for a subtree added after Alpine.start();
  teardown with Alpine.destroyTree(el) + remove x-data.
- **Per-instance state** (multiple hosts of one component) belongs in
  Alpine.reactive({...}) + a module Map keyed by id/container — NOT a single
  global store (two hosts would fight over it).
- Put the injected template in a 'const TEMPLATE' string in the TS file (the
  Library dialog's host is created at runtime, so it can't be a Pug partial).
  The Studio's static host placeholder just gets replaced by the same string.

## x-for template constraints

- **One root element per iteration.** Multiple sibling <template x-if> roots
  inside <template x-for> do not reconcile reliably.
- **Direct flex children.** .chat-history-list uses display:flex;
  flex-direction:column; gap + per-bubble align-self, so bubbles must be
  DIRECT children. Solution: make the single root the bubble and compute its
  class, with nested <template x-if> for per-kind content:

  ~~~pug
  template(x-for="msg in messages" :key="msg.id")
    div(:class="bubbleClass(msg)" :data-msg-id="msg.id")
      template(x-if="msg.kind === 'text'")
        span.chat-bubble-content(x-text="msg.text")
      // … one x-if per content block
  ~~~

- **:class semantics differ by shape:**
  - :class="'a b c'" (STRING) **replaces** the whole class attribute — so
    return the FULL class list, and don't rely on a static class="…" on the
    same element.
  - :class="{ active: cond }" (OBJECT) **toggles** keys while preserving the
    static class — use this for conditional modifiers on a fixed base.
- **x-if vs x-show:** <template x-if> removes the node from the DOM; x-show
  sets display:none and keeps it. Match the pre-Alpine DOM contract (hidden
  attribute → node present but hidden → x-show; a node that was only appended
  conditionally → x-if).
- **x-model needs getter + setter** on the component (two-way binding).

## Async render timing (the #1 gotcha)

Alpine re-renders on the **next microtask** after a store mutation. A
synchronous querySelector right after addX()/store write returns nothing.

- **For imperative post-render work** (Babylon canvas mount, focus, measuring),
  'await Alpine.nextTick()' first, then query via an id/x-ref/data-attribute:

  ~~~ts
  await Alpine.nextTick();
  const canvas = assetMessage.canvas;   // getter queries '[data-msg-id="…"] .chat-asset-canvas'
  if (!canvas) { assetMessage.markFallback(); return; }
  await createChatPreview(id, canvas, …);
  ~~~

- **Alpine.start() runs once** (DOMContentLoaded / microtask when readyState
  is "complete"). Alpine.initTree(el) initializes a dynamically-added subtree
  only AFTER start — do not rely on it working before start.

## What stays imperative (AGENTS.md rule #5)

Do NOT force these into reactive stores — hand-roll and leave a comment saying
why:

- **Babylon canvases / live 3D previews** — the engine renders into a real
  <canvas> that must be created/disposed imperatively. Mount it post-render via
  Alpine.nextTick().
- **Focus traps, promise queues, DOM nodes** — storing a DOM node in a reactive
  store proxies it and fails DOM brand checks (appendChild etc.). Keep those
  module-level (dialog.ts does exactly this for the focus-trap + FIFO queue).
- **The message/list state** goes in the store; **raw engine DOM** stays a
  post-render imperative mount.

## Testing Alpine components in jest

- jsdom reports document.readyState === "complete", so registerAlpineComponent
  schedules Alpine.start() on a microtask. **await a flush before calling
  Alpine.initTree** in beforeAll:

  ~~~js
  const flush = () => new Promise((r) => setTimeout(r, 0));
  beforeAll(async () => {
    document.body.innerHTML = '<div id="host"></div>';
    ({ initCollaboratorPanel } = await import("…/collaborators-panel.js"));
    await flush();   // let Alpine.start() run
  });
  afterEach(async () => {
    Alpine.destroyTree(document.body);
    Alpine.stopObservingMutations();
    document.body.innerHTML = '<div id="host"></div>';
  });
  ~~~

- **Assert on the store** (the source of truth), not synchronous DOM.
  Alpine.store("chat").messages is where addChatMessage writes; the x-for
  render is async and belongs to E2E/build coverage.
- **Use jest.unstable_mockModule(path, () => ({...}))** for ESM deps (the repo
  is "type": "module"); jest.mock does not reliably intercept .ts ESM imports.
  Match the emitted specifier convention (.js paths).

## E2E contract

- **Keep every id/class byte-identical** when converting (#collaboratorList,
  .chat-bubble-asset, [data-action], …). See references/e2e-sync.md.
- Playwright's toContainText / toBeVisible auto-wait, so the async Alpine
  render is fine in E2E — only synchronous unit-test DOM assertions break.
- Run npm run test:e2e -- --project=chromium after converting any flow that
  e2e covers (generation, wallet/session, save/publish, collaborators).
