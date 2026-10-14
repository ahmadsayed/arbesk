// @test-env dom
import { describe, expect, jest, mock, test } from "bun:test";
import { resetModules } from "../helpers/module-registry.js";

const FRAGMENT = `
  <button id="newMenuBtn">New</button>
  <li id="newMenuUpload"></li><li id="newAssetBtn"></li>
  <div id="viewport">
    <div id="emptyViewport" class="empty-viewport">
      <div class="empty-viewport-card">
        <button id="emptyViewportUpload"></button>
        <button id="emptyViewportEmpty"></button>
      </div>
    </div>
  </div>`;

async function load({ open = false } = {}) {
  resetModules();
  document.body.innerHTML = FRAGMENT;
  const ctl = { open };
  await mock.module("../../frontend/src/js/state/edit-mode.js", () => ({
    hasOpenAsset: () => ctl.open,
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
});
