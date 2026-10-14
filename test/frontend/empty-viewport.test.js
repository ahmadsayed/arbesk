// @test-env dom
import { describe, expect, jest, mock, test } from "bun:test";
import { resetModules } from "../helpers/module-registry.js";

const FRAGMENT = `
  <button id="newMenuBtn">New</button>
  <li id="newMenuUpload"></li><li id="newAssetBtn"></li>
  <div id="viewport">
    <div id="emptyViewport" class="empty-viewport">
      <div class="empty-viewport-card"><h2>Start</h2><div class="empty-viewport-actions">
        <button id="emptyViewportUpload"></button>
        <button id="emptyViewportEmpty"></button></div>
      </div>
    </div>
  </div>`;

async function load({ open = false, newHidden = false } = {}) {
  resetModules();
  document.body.innerHTML = FRAGMENT;
  document.getElementById("newMenuBtn").hidden = newHidden;
  const ctl = { open };
  await mock.module("../../frontend/src/js/state/edit-mode.js", () => ({
    hasOpenAsset: () => ctl.open,
    isAssetOpen: () => ctl.open || !!ctl.draft,
  }));
  const bus = await import("@arbesk/asset-core/events/bus.js");
  const mod = await import("../../frontend/src/js/ui/empty-viewport.js");
  mod.initEmptyViewport();
  return { ctl, bus };
}

const card = () => document.getElementById("emptyViewport");

describe("empty viewport card", () => {
  test("shown with no open asset, hidden once one opens", async () => {
    const { ctl, bus } = await load();
    expect(card().hidden).toBe(false);
    ctl.open = true;
    bus.emit(bus.EVENTS.ASSET_STATE_CHANGED);
    expect(card().hidden).toBe(true);
    ctl.open = false;
    bus.emit(bus.EVENTS.SCENE_EMPTY);
    expect(card().hidden).toBe(false);
  });

  test("hidden for a named empty draft (New ▾ → Empty asset)", async () => {
    const { ctl, bus } = await load();
    expect(card().hidden).toBe(false);
    ctl.draft = true;
    bus.emit(bus.EVENTS.ASSET_STATE_CHANGED);
    expect(card().hidden).toBe(true);
  });

  test("buttons forward to Upload and Empty asset", async () => {
    await load();
    const upload = jest.fn();
    const empty = jest.fn();
    document.getElementById("newMenuUpload").addEventListener("click", upload);
    document.getElementById("newAssetBtn").addEventListener("click", empty);
    document.getElementById("emptyViewportUpload").click();
    document.getElementById("emptyViewportEmpty").click();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(empty).toHaveBeenCalledTimes(1);
  });

  test("hides both buttons but keeps the card when New is hidden", async () => {
    await load({ newHidden: true });
    expect(card().hidden).toBe(false);
    expect(document.querySelector(".empty-viewport-actions").hidden).toBe(true);
  });

  test("re-renders on wallet and library events", async () => {
    const { bus } = await load({ newHidden: true });
    const actions = document.querySelector(".empty-viewport-actions");
    for (const ev of ["WALLET_STATE_CHANGED", "WALLET_CONNECTED", "WALLET_DISCONNECTED", "LIBRARY_STATE_CHANGED"]) {
      document.getElementById("newMenuBtn").hidden = false;
      bus.emit(bus.EVENTS[ev]);
      expect(actions.hidden).toBe(false);
      document.getElementById("newMenuBtn").hidden = true;
      bus.emit(bus.EVENTS[ev]);
      expect(actions.hidden).toBe(true);
    }
  });
});

describe("empty viewport markup", () => {
  test("Upload model is a secondary button: the accent is reserved for Publish", async () => {
    const { createRequire } = await import("node:module");
    const pug = createRequire(import.meta.url)("../../frontend/node_modules/pug");
    const html = pug.renderFile(
      new URL("../../frontend/src/pug/includes/studio-main.pug", import.meta.url).pathname,
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    const upload = host.querySelector("#emptyViewportUpload");
    expect(upload).not.toBeNull();
    expect(upload.classList.contains("btn-secondary")).toBe(true);
    expect(host.querySelectorAll("#emptyViewport .btn-primary")).toHaveLength(0);
  });
});
