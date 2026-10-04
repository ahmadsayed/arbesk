// @test-env dom
import { describe, expect, jest, mock, test } from "bun:test";
import { resetModules } from "../helpers/module-registry.js";

const FRAGMENT = `
  <div class="menu-anchor">
    <button id="newMenuBtn" aria-haspopup="menu" aria-expanded="false" aria-controls="newMenu">New</button>
    <ul id="newMenu" role="menu" hidden>
      <li id="newMenuUpload" role="menuitem" tabindex="-1">Upload model…</li>
      <li id="newMenuAi" role="menuitem" tabindex="-1">Generate with AI</li>
      <li id="newMenuCad" role="menuitem" tabindex="-1">Parametric CAD</li>
      <li class="menu-separator" role="separator"></li>
      <li id="newAssetBtn" role="menuitem" tabindex="-1">Empty asset</li>
    </ul>
    <input id="newMenuUploadInput" type="file" hidden>
  </div>
  <select id="providerSelect"><option value="mock">Mock</option><option value="cad">Parametric CAD</option></select>
  <textarea id="promptInput"></textarea>`;

let navigate, switchView, clearScene, closeAsset, bus, dropped, confirmChoice, showConfirmDialog;

async function load({ path = "/studio", activeCid = null, confirm = "new" } = {}) {
  resetModules();
  window.history.replaceState({}, "", path);
  document.body.innerHTML = FRAGMENT;
  navigate = jest.fn();
  switchView = jest.fn();
  clearScene = jest.fn();
  closeAsset = jest.fn();
  confirmChoice = confirm;
  showConfirmDialog = jest.fn(async () => confirmChoice);
  await mock.module("../../frontend/src/js/ui/dialog.js", () => ({ showConfirmDialog }));
  await mock.module("../../frontend/src/js/app/router.js", () => ({ navigate }));
  await mock.module("../../frontend/src/js/ui/sidebar.js", () => ({ switchView }));
  await mock.module("../../frontend/src/js/engine/cleanup.js", () => ({ clearScene }));
  await mock.module("../../frontend/src/js/engine/state.js", () => ({ state: { scene: {} } }));
  await mock.module("@arbesk/asset-core/domain/asset.js", () => ({
    closeAsset,
    getActiveAssetManifestCid: () => activeCid,
  }));
  bus = await import("@arbesk/asset-core/events/bus.js");
  dropped = jest.fn();
  bus.on(bus.EVENTS.ASSET_FILE_DROPPED, dropped);
  const mod = await import("../../frontend/src/js/ui/new-menu.js");
  mod.initNewMenu();
  return mod;
}

const open = () => document.getElementById("newMenuBtn").click();
const item = (id) => document.getElementById(id);

describe("New ▾ menu", () => {
  test("hides the CAD item when the create panel has no cad provider", async () => {
    await load();
    document.querySelector('#providerSelect option[value="cad"]').remove();
    open();
    expect(item("newMenuCad").hidden).toBe(true);
  });

  test("shows the CAD item when the cad provider exists", async () => {
    await load();
    open();
    expect(item("newMenuCad").hidden).toBe(false);
  });

  test("Generate with AI opens Create with a non-CAD provider and focuses the prompt", async () => {
    await load();
    document.getElementById("providerSelect").value = "cad";
    open();
    item("newMenuAi").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(switchView).toHaveBeenCalledWith("chat");
    expect(document.getElementById("providerSelect").value).toBe("mock");
    expect(document.activeElement?.id).toBe("promptInput");
  });

  test("Parametric CAD opens Create with cad selected", async () => {
    await load();
    open();
    item("newMenuCad").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(switchView).toHaveBeenCalledWith("chat");
    expect(document.getElementById("providerSelect").value).toBe("cad");
  });

  test("from the Library, items navigate to /studio first", async () => {
    await load({ path: "/library" });
    open();
    item("newMenuAi").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(navigate).toHaveBeenCalledWith("/studio");
  });

  test("Upload opens the file picker; a chosen file starts a fresh draft", async () => {
    await load({ activeCid: null });
    const input = item("newMenuUploadInput");
    const clickSpy = jest.spyOn(input, "click").mockImplementation(() => {});
    open();
    item("newMenuUpload").click();
    expect(clickSpy).toHaveBeenCalled();

    const file = new File(["x"], "part.glb");
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));
    expect(clearScene).toHaveBeenCalled();
    expect(closeAsset).toHaveBeenCalled();
    expect(dropped).toHaveBeenCalledTimes(1);
    expect(dropped.mock.calls[0][0]).toEqual({ file });
  });

  test("Upload over an open asset asks before discarding it (cancel keeps it)", async () => {
    await load({ activeCid: "bafyOpen", confirm: "cancel" });
    const input = item("newMenuUploadInput");
    Object.defineProperty(input, "files", { value: [new File(["x"], "a.glb")] });
    input.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));
    expect(showConfirmDialog).toHaveBeenCalled();
    expect(clearScene).not.toHaveBeenCalled();
    expect(dropped).not.toHaveBeenCalled();
  });

  test("Upload over an open asset proceeds when confirmed", async () => {
    await load({ activeCid: "bafyOpen", confirm: "new" });
    const input = item("newMenuUploadInput");
    const file = new File(["x"], "b.glb");
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));
    expect(clearScene).toHaveBeenCalled();
    expect(dropped.mock.calls[0][0]).toEqual({ file });
  });

  test("Enter on Empty asset fires the item's click (scene-graph listener)", async () => {
    await load();
    const clicked = jest.fn();
    item("newAssetBtn").addEventListener("click", clicked);
    open();
    item("newAssetBtn").focus();
    item("newAssetBtn").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  test("Ctrl+O opens the file picker, but not while typing in a field", async () => {
    await load();
    const input = item("newMenuUploadInput");
    const clickSpy = jest.spyOn(input, "click").mockImplementation(() => {});
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "o", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    document.getElementById("promptInput").focus();
    document.getElementById("promptInput").dispatchEvent(new KeyboardEvent("keydown", { key: "o", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
