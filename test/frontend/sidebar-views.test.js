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

async function load() {
  resetModules();
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.matchMedia = window.matchMedia;
  document.body.innerHTML = fragment();
  const mod = await import("../../frontend/src/js/ui/sidebar.js");
  mod.initSidebar();
  return mod;
}

const visible = () =>
  [...document.querySelectorAll(".sidebar-view")].filter((p) => !p.hidden).map((p) => p.dataset.view);

const ctrl = (key) =>
  document.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true }));

beforeEach(() => localStorage.clear());

describe("sidebar views", () => {
  test("defaults to Outline", async () => {
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
