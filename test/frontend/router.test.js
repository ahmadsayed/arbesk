/**
 * @jest-environment jsdom
 */
import { jest, describe, test, expect, beforeEach } from "@jest/globals";

const SG = "../../frontend/src/js/engine/scene-graph.js";
const LC = "../../frontend/src/js/ui/library-controller.js";
const WS = "../../frontend/src/js/state/wallet-state.js";

// Mock the heavy engine + data deps so we can unit-test the router in isolation.
async function loadRouter() {
  await jest.unstable_mockModule(SG, () => ({
    initEngine: jest.fn(),
    loadFromParams: jest.fn(),
    pauseRenderLoop: jest.fn(),
    resumeRenderLoop: jest.fn(),
  }));
  await jest.unstable_mockModule(LC, () => ({
    refreshLibraryData: jest.fn(),
  }));
  await jest.unstable_mockModule(WS, () => ({
    walletState: { get: jest.fn(() => ({ walletAddress: null })) },
  }));
  return import("../../frontend/src/js/app/router.js");
}

beforeEach(() => {
  jest.resetModules();
  window.history.replaceState({}, "", "/studio");
  document.body.innerHTML = `
    <main id="studioView" class="app-view"></main>
    <main id="libraryView" class="app-view hidden"></main>
    <nav class="page-switcher">
      <a class="page-switcher-tab" href="/library" data-nav>Library</a>
      <a class="page-switcher-tab active" href="/studio" data-nav>Studio</a>
    </nav>
  `;
});

describe("pathToView", () => {
  test("maps paths to views, defaulting unknown/root to studio", async () => {
    const { pathToView } = await loadRouter();
    expect(pathToView("/studio")).toBe("studio");
    expect(pathToView("/library")).toBe("library");
    expect(pathToView("/")).toBe("studio");
    expect(pathToView("/anything-else")).toBe("studio");
  });
});

describe("setView", () => {
  test("toggles view visibility and sets body.dataset.view", async () => {
    const { setView } = await loadRouter();
    setView("library");
    expect(document.getElementById("studioView").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("libraryView").classList.contains("hidden")).toBe(false);
    expect(document.body.dataset.view).toBe("library");
  });

  test("marks the matching page-switcher tab active", async () => {
    const { setView } = await loadRouter();
    setView("library");
    const tabs = [...document.querySelectorAll(".page-switcher-tab")];
    const libTab = tabs.find((t) => t.getAttribute("href") === "/library");
    const studioTab = tabs.find((t) => t.getAttribute("href") === "/studio");
    expect(libTab.classList.contains("active")).toBe(true);
    expect(studioTab.classList.contains("active")).toBe(false);
  });
});

describe("navigate", () => {
  test("preserves the query string when pushing history", async () => {
    const { navigate } = await loadRouter();
    // Start on library so a navigate to studio actually changes the view.
    window.history.replaceState({}, "", "/library");
    const spy = jest.spyOn(window.history, "pushState");
    navigate("/studio?asset=42&assetId=root");
    expect(spy).toHaveBeenCalled();
    const pushedUrl = spy.mock.calls[spy.mock.calls.length - 1][2];
    expect(pushedUrl).toBe("/studio?asset=42&assetId=root");
    expect(document.body.dataset.view).toBe("studio");
  });
});
