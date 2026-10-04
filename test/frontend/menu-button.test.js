// @test-env dom
import { beforeEach, describe, expect, jest, test } from "bun:test";
import { resetModules } from "../helpers/module-registry.js";

const FRAGMENT = `
  <button id="btn" aria-haspopup="menu" aria-expanded="false" aria-controls="m">Menu</button>
  <ul id="m" role="menu" hidden>
    <li role="menuitemradio" tabindex="-1" data-v="a">A</li>
    <li role="menuitemradio" tabindex="-1" data-v="b" aria-disabled="true">B</li>
    <li role="menuitemradio" tabindex="-1" data-v="c">C</li>
    <li role="menuitemradio" tabindex="-1" data-v="d" hidden>D</li>
  </ul>
  <button id="outside">x</button>`;

/** @type {typeof import("../../frontend/src/js/ui/menu-button.js")} */
let mod;
let onSelect;
const btn = () => document.getElementById("btn");
const menu = () => document.getElementById("m");
const key = (el, k) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

beforeEach(async () => {
  resetModules();
  document.body.innerHTML = FRAGMENT;
  mod = await import("../../frontend/src/js/ui/menu-button.js");
  onSelect = jest.fn();
  mod.initMenuButton(btn(), menu(), { onSelect });
});

describe("menu button (WAI-ARIA APG)", () => {
  test("click opens, sets aria-expanded, focuses first enabled item", () => {
    btn().click();
    expect(menu().hidden).toBe(false);
    expect(btn().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement?.dataset.v).toBe("a");
  });

  test("ArrowUp on button opens on the last enabled item", () => {
    key(btn(), "ArrowUp");
    expect(document.activeElement?.dataset.v).toBe("c");
  });

  test("ArrowDown skips disabled and hidden items and wraps", () => {
    btn().click();
    key(document.activeElement, "ArrowDown");
    expect(document.activeElement?.dataset.v).toBe("c");
    key(document.activeElement, "ArrowDown");
    expect(document.activeElement?.dataset.v).toBe("a");
  });

  test("Home/End jump to first/last", () => {
    btn().click();
    key(document.activeElement, "End");
    expect(document.activeElement?.dataset.v).toBe("c");
    key(document.activeElement, "Home");
    expect(document.activeElement?.dataset.v).toBe("a");
  });

  test("Enter selects, closes, and returns focus to the button", () => {
    btn().click();
    key(document.activeElement, "Enter");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].dataset.v).toBe("a");
    expect(menu().hidden).toBe(true);
    expect(btn().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(btn());
  });

  test("Escape closes without selecting and returns focus", () => {
    btn().click();
    key(document.activeElement, "Escape");
    expect(onSelect).not.toHaveBeenCalled();
    expect(menu().hidden).toBe(true);
    expect(document.activeElement).toBe(btn());
  });

  test("clicking outside closes", () => {
    btn().click();
    document.getElementById("outside").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(menu().hidden).toBe(true);
  });

  test("onOpen runs before items are focused", async () => {
    resetModules();
    document.body.innerHTML = FRAGMENT;
    const m = await import("../../frontend/src/js/ui/menu-button.js");
    m.initMenuButton(btn(), menu(), {
      onSelect: jest.fn(),
      onOpen: () => { menu().querySelector('[data-v="a"]').hidden = true; },
    });
    btn().click();
    expect(document.activeElement?.dataset.v).toBe("c");
  });

  test("clicking a disabled item does nothing", () => {
    btn().click();
    menu().querySelector('[data-v="b"]').click();
    expect(onSelect).not.toHaveBeenCalled();
    expect(menu().hidden).toBe(false);
  });

  // Global shortcuts (viewport Home = frame all, Escape = deselect, G = grid)
  // listen on document; keys pressed inside the open menu must not reach them.
  test("keys pressed in the menu don't reach document shortcuts", () => {
    const seen = [];
    const spy = (e) => seen.push(e.key);
    document.addEventListener("keydown", spy);
    btn().click();
    for (const k of ["Home", "End", "ArrowDown", "g", "Escape"]) key(document.activeElement, k);
    document.removeEventListener("keydown", spy);
    expect(seen).toEqual([]);
  });

  test("ArrowDown/ArrowUp on the button don't reach document shortcuts", () => {
    const seen = [];
    const spy = (e) => seen.push(e.key);
    document.addEventListener("keydown", spy);
    key(btn(), "ArrowDown");
    document.removeEventListener("keydown", spy);
    expect(seen).toEqual([]);
  });

  // The header clips overflow, so the menu is fixed-positioned under the
  // button (right edges aligned, clamped on-screen) and focus never scrolls.
  test("positions the menu fixed under the button, right-aligned", () => {
    btn().getBoundingClientRect = () => ({ top: 8, bottom: 40, left: 900, right: 940, width: 40, height: 32 });
    menu().getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 176, width: 176, height: 100 });
    btn().click();
    expect(menu().style.position).toBe("fixed");
    expect(menu().style.top).toBe("44px");
    expect(menu().style.left).toBe(`${940 - 176}px`);
  });

  test("clamps the menu inside the window's left edge", () => {
    btn().getBoundingClientRect = () => ({ top: 8, bottom: 40, left: 4, right: 44, width: 40, height: 32 });
    menu().getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 176, width: 176, height: 100 });
    btn().click();
    expect(menu().style.left).toBe("8px");
  });

  test("focuses items without scrolling", () => {
    const calls = [];
    const orig = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (opts) { calls.push(opts); return orig.call(this, opts); };
    try {
      btn().click();
      key(document.activeElement, "ArrowDown");
    } finally {
      HTMLElement.prototype.focus = orig;
    }
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.every((o) => o?.preventScroll === true)).toBe(true);
  });

  test("window resize closes the menu", () => {
    btn().click();
    window.dispatchEvent(new Event("resize"));
    expect(menu().hidden).toBe(true);
  });

  test("align: start left-aligns the menu with the button", async () => {
    resetModules();
    document.body.innerHTML = FRAGMENT;
    const m = await import("../../frontend/src/js/ui/menu-button.js");
    m.initMenuButton(btn(), menu(), { onSelect: jest.fn(), align: "start" });
    btn().getBoundingClientRect = () => ({ top: 8, bottom: 40, left: 300, right: 380, width: 80, height: 32 });
    menu().getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 176, width: 176, height: 100 });
    btn().click();
    expect(menu().style.left).toBe("300px");
  });
});
