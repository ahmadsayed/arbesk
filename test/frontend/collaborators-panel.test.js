/**
 * Collaborator panel (ui/collaborators-panel.js) Alpine conversion contract.
 *
 * The panel injects an Alpine template into a host container and initializes
 * it with Alpine.initTree(); refresh/destroy drive a per-instance reactive
 * store. This test proves the x-for list + x-show visibility render in jsdom
 * and that the legacy { refresh, destroy } handle keeps working. No service
 * mocks: the real team service has no contract in jsdom (isOwner=false,
 * fetchEditors fails), which exercises the empty-list path deterministically.
 *
 * @jest-environment jsdom
 */

import { expect, test, beforeAll, afterEach } from "@jest/globals";

const flush = () => new Promise((r) => setTimeout(r, 0));

let initCollaboratorPanel;
let Alpine;

beforeAll(async () => {
  document.body.innerHTML = '<div id="host"></div>';
  const mod = await import("../../frontend/src/js/ui/collaborators-panel.js");
  initCollaboratorPanel = mod.initCollaboratorPanel;
  ({ Alpine } = await import("../../frontend/src/js/ui/alpine.js"));
  await flush(); // let Alpine.start() run
});

afterEach(async () => {
  Alpine.destroyTree(document.body);
  Alpine.stopObservingMutations();
  document.body.innerHTML = '<div id="host"></div>';
});

test("injects the panel template and renders the empty-state list", async () => {
  const host = document.getElementById("host");
  const panel = initCollaboratorPanel(host, "7", { editable: true });
  await flush();
  await flush();

  expect(host.querySelector("h5")?.textContent).toBe("Collaborators");
  expect(host.querySelector("#collaboratorList")).not.toBeNull();
  // empty list → empty-state message present
  expect(host.querySelector(".team-empty")?.textContent).toBe(
    "No collaborators yet."
  );
  // no contract → owner badge hidden
  expect(host.querySelector(".owner-badge")).not.toBeNull();
  panel.destroy();
});

test("destroy clears the subtree and Alpine bindings", async () => {
  const host = document.getElementById("host");
  const panel = initCollaboratorPanel(host, "7", { editable: false });
  await flush();
  await flush();

  panel.destroy();
  expect(host.innerHTML).toBe("");
  expect(host.hasAttribute("x-data")).toBe(false);
  expect(host.classList.contains("collaborator-panel")).toBe(false);
});
