// @test-env dom
/**
 * landing/prompt-form: the hero form is a plain GET to /studio; this module adds
 * per-mode placeholder + example chips, the CAD availability gate and #prompt
 * focus links.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { initPromptForm, PROMPT_MODES } from "../../frontend/src/js/landing/prompt-form.js";

const FRAGMENT = `
<form id="prompt" class="prompt" method="get" action="/studio">
  <fieldset class="prompt-mode">
    <legend class="sr-only">Model type</legend>
    <label><input type="radio" name="provider" value="tripo3d" checked><span>3D</span></label>
    <label><input type="radio" name="provider" value="cad"><span>CAD</span></label>
  </fieldset>
  <input id="promptText" type="text" name="prompt">
  <button type="submit">Generate</button>
</form>
<div id="promptChips"></div>
<a id="footerCta" href="#prompt">Generate a model</a>`;

const tick = () => new Promise((r) => setTimeout(r, 0));
const chipTexts = () => [...document.querySelectorAll(".prompt-chip")].map((b) => b.textContent);

let form;
let input;

beforeEach(() => {
  document.body.innerHTML = FRAGMENT;
  form = document.getElementById("prompt");
  input = document.getElementById("promptText");
});

describe("initPromptForm", () => {
  test("renders the 3D placeholder and chips by default", () => {
    initPromptForm(form, { cadAvailable: Promise.resolve(true) });
    expect(input.placeholder).toBe("Describe a character or prop…");
    expect(chipTexts()).toEqual(["Low-poly fox", "Cowboy mascot", "Sci-fi crate"]);
  });

  test("switching to CAD swaps the placeholder and chips", () => {
    initPromptForm(form, { cadAvailable: Promise.resolve(true) });
    const cad = form.querySelector('input[value="cad"]');
    cad.checked = true;
    cad.dispatchEvent(new Event("change", { bubbles: true }));
    expect(input.placeholder).toBe("Describe a part…");
    expect(chipTexts()).toEqual(PROMPT_MODES.cad.examples);
  });

  test("a chip fills and focuses the input without submitting", () => {
    initPromptForm(form, { cadAvailable: Promise.resolve(true) });
    let submitted = false;
    form.addEventListener("submit", (e) => {
      submitted = true;
      e.preventDefault();
    });
    document.querySelector(".prompt-chip").click();
    expect(input.value).toBe("Low-poly fox");
    expect(document.activeElement).toBe(input);
    expect(submitted).toBe(false);
  });

  test("CAD unavailable: removes the CAD option, hides the switch, falls back to 3D", async () => {
    form.querySelector('input[value="cad"]').checked = true;
    initPromptForm(form, { cadAvailable: Promise.resolve(false) });
    await tick();
    expect(form.querySelector('input[value="cad"]')).toBeNull();
    expect(form.querySelector('input[value="tripo3d"]').checked).toBe(true);
    expect(form.querySelector(".prompt-mode").hidden).toBe(true);
    expect(input.placeholder).toBe(PROMPT_MODES.tripo3d.placeholder);
  });

  test("#prompt links focus the prompt input", () => {
    initPromptForm(form, { cadAvailable: Promise.resolve(true) });
    document.getElementById("footerCta").click();
    expect(document.activeElement).toBe(input);
  });
});
