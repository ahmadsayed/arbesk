// @test-env dom
/**
 * landing/version-demo: the v1–v4 rail under the landing model. Only the rail
 * wiring is unit-tested; the Babylon viewer is verified visually.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { DEMO_VERSIONS, wireVersionRail } from "../../frontend/src/js/landing/version-demo.js";

let rail;
let caption;
let seen;

beforeEach(() => {
  document.body.innerHTML = '<div id="versionRail"></div><p id="versionCaption"></p>';
  rail = document.getElementById("versionRail");
  caption = document.getElementById("versionCaption");
  seen = [];
});

const buttons = () => [...rail.querySelectorAll("button")];

describe("wireVersionRail", () => {
  test("builds one button per version with the latest selected", () => {
    wireVersionRail(rail, caption, (i) => seen.push(i));
    expect(buttons()).toHaveLength(DEMO_VERSIONS.length);
    expect(buttons().map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "false", "true"]);
    expect(buttons()[3].classList.contains("is-current")).toBe(true);
    expect(buttons().slice(0, 3).every((b) => b.classList.contains("is-past"))).toBe(true);
    expect(caption.textContent).toBe("v4 — New hat and scarf. Latest");
    expect(seen).toEqual([3]);
  });

  test("clicking a version selects it, updates the caption and reports it", () => {
    wireVersionRail(rail, caption, (i) => seen.push(i));
    buttons()[0].click();
    expect(buttons()[0].classList.contains("is-current")).toBe(true);
    expect(buttons().some((b) => b.classList.contains("is-past"))).toBe(false);
    expect(caption.textContent).toBe("v1 — Untextured mesh from a prompt");
    expect(seen.at(-1)).toBe(0);
  });

  test("the returned select() drives the rail programmatically", () => {
    const select = wireVersionRail(rail, caption, (i) => seen.push(i));
    select(2);
    expect(buttons()[2].getAttribute("aria-pressed")).toBe("true");
    expect(caption.textContent).toBe("v3 — Scaled ×1.2 by an editor");
  });
});
