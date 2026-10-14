// @test-env dom
import { beforeEach, describe, expect, test } from "bun:test";
import { resetModules } from "../helpers/module-registry.js";

const VIEWS = ["outline", "library", "chat", "ledger"];

function fragment() {
  const btns = VIEWS.map(
    (v) => `<button class="sidebar-switcher-btn" data-view="${v}" role="tab"></button>`,
  ).join("");
  const panes = VIEWS.map((v) => `<div class="sidebar-view" data-view="${v}" hidden></div>`).join("");
  return `<aside class="sidebar"><div class="sidebar-switcher">${btns}</div>${panes}</aside>`;
}

async function load(options) {
  resetModules();
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.matchMedia = window.matchMedia;
  document.body.innerHTML = fragment();
  const mod = await import("../../frontend/src/js/ui/sidebar.js");
  mod.initSidebar(options);
  return mod;
}

const visible = () =>
  [...document.querySelectorAll(".sidebar-view")].filter((p) => !p.hidden).map((p) => p.dataset.view);

const ctrl = (key) =>
  document.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true }));

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/studio?asset=1");
});

describe("sidebar views", () => {
  test("no asset in the URL opens Create", async () => {
    window.history.replaceState({}, "", "/studio");
    await load();
    expect(visible()).toEqual(["chat"]);
  });

  test("an asset in the URL restores the stored view, else Outline", async () => {
    window.history.replaceState({}, "", "/studio?asset=1");
    await load();
    expect(visible()).toEqual(["outline"]);
    localStorage.setItem("arbesk-sidebar-view", "ledger");
    await load();
    expect(visible()).toEqual(["ledger"]);
    window.history.replaceState({}, "", "/studio");
  });

  test("landing on Create does not overwrite the stored tab", async () => {
    localStorage.setItem("arbesk-sidebar-view", "ledger");
    window.history.replaceState({}, "", "/studio");
    await load();
    expect(visible()).toEqual(["chat"]);
    expect(localStorage.getItem("arbesk-sidebar-view")).toBe("ledger");
    window.history.replaceState({}, "", "/studio?asset=1");
    await load();
    expect(visible()).toEqual(["ledger"]);
  });

  test("an assetId or manifest param also counts as an asset in the URL", async () => {
    window.history.replaceState({}, "", "/studio?assetId=x");
    await load();
    expect(visible()).toEqual(["outline"]);
    window.history.replaceState({}, "", "/studio?manifest=bafy");
    await load();
    expect(visible()).toEqual(["outline"]);
  });

  test("migrates a stored 'settings' view to Outline", async () => {
    localStorage.setItem("arbesk-sidebar-view", "settings");
    await load();
    expect(visible()).toEqual(["outline"]);
  });

  test("restores a valid stored view", async () => {
    localStorage.setItem("arbesk-sidebar-view", "ledger");
    await load();
    expect(visible()).toEqual(["ledger"]);
  });

  test("Ctrl+1..4 map to Outline, Assets, Create, Activity", async () => {
    await load();
    ctrl("2");
    expect(visible()).toEqual(["library"]);
    ctrl("3");
    expect(visible()).toEqual(["chat"]);
    ctrl("4");
    expect(visible()).toEqual(["ledger"]);
    ctrl("1");
    expect(visible()).toEqual(["outline"]);
  });

  test("Ctrl+5 is not intercepted", async () => {
    await load();
    const ev = new KeyboardEvent("keydown", { key: "5", ctrlKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  test("Create does not pulse on load (not AI-first)", async () => {
    await load();
    expect(document.querySelector('[data-view="chat"]').classList.contains("pulse")).toBe(false);
  });
});

describe("leaving the Create landing when an asset opens", () => {
  async function landing() {
    window.history.replaceState({}, "", "/studio");
    // The real "an asset is open" predicate, as app-init injects it
    // (resolved lazily: load() resets the module graph first).
    let editMode;
    const mod = await load({ isAssetOpen: () => editMode.isAssetOpen() });
    editMode = await import("../../frontend/src/js/state/edit-mode.js");
    const bus = await import("@arbesk/asset-core/events/bus.js");
    const asset = await import("@arbesk/asset-core/domain/asset.js");
    const store = await import("@arbesk/asset-core/domain/asset-store.js");
    store._resetForTesting();
    const openAsset = () => {
      asset.setActiveManifestCid("bafyOpened");
      bus.emit(bus.EVENTS.SCENE_READY, { manifest: {}, manifestCid: "bafyOpened" });
    };
    return { mod, bus, asset, openAsset };
  }

  test("Library → open asset switches to the stored tab (default Outline)", async () => {
    const { openAsset } = await landing();
    expect(visible()).toEqual(["chat"]);
    openAsset();
    expect(visible()).toEqual(["outline"]);
  });

  test("restores the stored tab rather than Outline when one is stored", async () => {
    localStorage.setItem("arbesk-sidebar-view", "ledger");
    const { openAsset } = await landing();
    openAsset();
    expect(visible()).toEqual(["ledger"]);
    expect(localStorage.getItem("arbesk-sidebar-view")).toBe("ledger");
  });

  test("a tab the user chose since landing is kept", async () => {
    const { openAsset } = await landing();
    document.querySelector('.sidebar-switcher-btn[data-view="library"]').click();
    openAsset();
    expect(visible()).toEqual(["library"]);
  });

  test("an open triggered by the Create panel's own generation stays on Create", async () => {
    const { mod, openAsset } = await landing();
    mod.keepCreateView();
    openAsset();
    expect(visible()).toEqual(["chat"]);
  });

  test("only the first open leaves the landing", async () => {
    const { openAsset } = await landing();
    openAsset();
    ctrl("3");
    openAsset();
    expect(visible()).toEqual(["chat"]);
  });

  test("a SCENE_READY with no asset open keeps the landing", async () => {
    const { bus } = await landing();
    bus.emit(bus.EVENTS.SCENE_READY, { manifest: {}, manifestCid: null });
    expect(visible()).toEqual(["chat"]);
  });
});
