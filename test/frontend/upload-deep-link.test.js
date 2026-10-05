// @test-env dom
/**
 * upload-deep-link: /library?upload=1 (landing "or upload a model") points the
 * user at the Upload button — browsers refuse to open a file picker without a
 * user gesture after navigation.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { resetModules } from "../helpers/module-registry.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

async function load() {
  resetModules();
  return import("../../frontend/src/js/ui/upload-deep-link.js");
}

let btn;

beforeEach(() => {
  document.body.innerHTML = '<button id="libraryUploadBtn" type="button" hidden>Upload</button>';
  btn = document.getElementById("libraryUploadBtn");
  history.replaceState(null, "", "/library");
});

describe("initUploadDeepLink", () => {
  test("does nothing without ?upload", async () => {
    btn.hidden = false;
    const { initUploadDeepLink } = await load();
    initUploadDeepLink();
    expect(btn.classList.contains("attention")).toBe(false);
  });

  test("highlights and focuses a visible Upload button and strips only the param", async () => {
    history.replaceState(null, "", "/library?upload=1&collection=7");
    btn.hidden = false;
    const { initUploadDeepLink } = await load();
    initUploadDeepLink();
    expect(btn.classList.contains("attention")).toBe(true);
    expect(document.activeElement).toBe(btn);
    expect(location.search).toBe("?collection=7");
  });

  test("waits until the button unhides (after sign-in)", async () => {
    history.replaceState(null, "", "/library?upload=1");
    const { initUploadDeepLink } = await load();
    initUploadDeepLink();
    expect(btn.classList.contains("attention")).toBe(false);

    btn.hidden = false;
    await tick();
    expect(btn.classList.contains("attention")).toBe(true);
  });

  test("the highlight is one-shot: animationend removes it", async () => {
    history.replaceState(null, "", "/library?upload=1");
    btn.hidden = false;
    const { initUploadDeepLink } = await load();
    initUploadDeepLink();
    btn.dispatchEvent(new Event("animationend"));
    expect(btn.classList.contains("attention")).toBe(false);
  });
});
