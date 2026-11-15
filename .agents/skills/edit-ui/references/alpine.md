# Alpine.js in Arbesk Studio

Working examples: `ui/dialog.ts`, `ui/wallet-popover.ts`, `ui/ledger-panel.ts`, `ui/collaborators-panel.ts`, `ui/chat-messages.ts`. Copy the shape of the closest one.

## Pattern

- Register with `registerAlpineComponent(name, factory)` from `ui/alpine.ts`. Never call `Alpine.start()`; the loader does it once.
- Shared state lives in `Alpine.store(name, {...})`; the component exposes getters over it. Code outside Alpine changes the **store**. Changing a component's `this` from outside does not re-render.
- `Alpine.store(name, value)` is a setter and returns undefined. Read the store back with `Alpine.store(name)`.
- `init()` seeds from the source stores first, then subscribes. Page-load flows such as wallet auto-connect can emit before `Alpine.start()`.
- Several hosts of one component: per-instance `Alpine.reactive({...})` in a module `Map`, not one global store.
- A subtree added after start: set `x-data`, call `Alpine.initTree(el)`; tear down with `Alpine.destroyTree(el)` and remove `x-data`. `initTree` does nothing before `Alpine.start()` has run.
- Parameters: `x-data="name({...})"` with the object `JSON.stringify`-ed into the attribute.

## Template traps

- `x-for` needs exactly one root element per iteration. If items must be direct flex children, make that root the item and nest `<template x-if>` inside it.
- `:class="'a b'"` (string) **replaces** the class attribute. `:class="{ active: cond }"` (object) keeps the static classes.
- `x-if` removes the node; `x-show` hides it. Keep whichever matches the DOM the E2E specs expect.
- `x-model` needs a getter and a setter on the component.

## Timing

Alpine renders on the next microtask. A `querySelector` right after a store write finds nothing. `await Alpine.nextTick()` before imperative work such as mounting a Babylon canvas, focusing or measuring.

## Keep imperative

Babylon canvases, focus traps, promise queues and any DOM node. A DOM node placed in a reactive store is proxied and then fails `appendChild`. Keep those at module level and mount them after `nextTick()`.

## Unit tests (bun test + jsdom)

- First line `// @test-env dom`. Not happy-dom: it misparses `:class`.
- jsdom is already `complete`, so Alpine starts on a microtask. Wait one real tick (`setTimeout(r, 0)`) after importing the module and before `Alpine.initTree`.
- Flush with real ticks. Bun's fake timers do not cover `queueMicrotask` or `requestAnimationFrame`.
- Assert on the store, not on the DOM straight after a write.
- In `afterEach`: `Alpine.destroyTree(document.body)`, `Alpine.stopObservingMutations()`, reset the body, and reset any module-level state (modules load once per file).

## E2E

Keep every id and class byte-identical when converting a panel. Playwright auto-waits, so the async render needs no change there.
