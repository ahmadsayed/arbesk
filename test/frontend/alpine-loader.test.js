/**
 * Alpine loader (ui/alpine.js) contract tests.
 *
 * Reproduces the browser load-order semantics that broke E2E: while deferred
 * module scripts are still evaluating, document.readyState is "interactive",
 * NOT "loading". The loader must not call Alpine.start() until
 * DOMContentLoaded, or components registered by later modules never initialize.
 *
 * @jest-environment jsdom
 */

import { jest, expect, test, afterEach } from "@jest/globals";

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(async () => {
  const { Alpine } = await import("../../frontend/src/js/ui/alpine.js");
  Alpine.destroyTree(document.body);
  Alpine.stopObservingMutations();
  document.body.innerHTML = "";
  // Remove any readyState override installed by a test
  // @ts-ignore - deleting an own-property override restores the prototype getter
  delete document.readyState;
});

test("components registering while readyState is 'interactive' all initialize at DOMContentLoaded", async () => {
  jest.resetModules();
  // Browser truth: during deferred module evaluation readyState is "interactive".
  Object.defineProperty(document, "readyState", { value: "interactive", configurable: true });
  document.body.innerHTML = `
    <div x-data="probeA"><span id="a" x-text="label"></span></div>
    <div x-data="probeB"><span id="b" x-text="label"></span></div>`;

  const { registerAlpineComponent } = await import("../../frontend/src/js/ui/alpine.js");
  registerAlpineComponent("probeA", () => ({ label: "A" }));
  registerAlpineComponent("probeB", () => ({ label: "B" }));

  // End of deferred module evaluation
  document.dispatchEvent(new Event("DOMContentLoaded"));
  await flush();

  expect(document.getElementById("a")?.textContent).toBe("A");
  expect(document.getElementById("b")?.textContent).toBe("B");
});

test("readyState 'complete' (tests, late imports) starts Alpine on a microtask", async () => {
  jest.resetModules();
  // jsdom default is "complete" — assert it to keep this test honest
  expect(document.readyState).toBe("complete");
  document.body.innerHTML = `<div x-data="probeC"><span id="c" x-text="label"></span></div>`;

  const { registerAlpineComponent } = await import("../../frontend/src/js/ui/alpine.js");
  registerAlpineComponent("probeC", () => ({ label: "C" }));
  await flush();

  expect(document.getElementById("c")?.textContent).toBe("C");
});
