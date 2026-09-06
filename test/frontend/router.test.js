/**
 * @jest-environment jsdom
 */
import { jest, describe, test, expect, beforeEach } from "@jest/globals";

const SG = "../../frontend/src/js/engine/scene-graph.js";
const LC = "../../frontend/src/js/ui/library-controller.js";
const AL = "../../frontend/src/js/ui/asset-library.js";
const WS = "../../frontend/src/js/state/wallet-state.js";

// Mock the heavy engine + data deps so we can unit-test the router in isolation.
async function loadRouter({ walletAddress = null } = {}) {
  await jest.unstable_mockModule(SG, () => ({
    initEngine: jest.fn(),
    loadFromParams: jest.fn(),
    pauseRenderLoop: jest.fn(),
    resumeRenderLoop: jest.fn(),
  }));
  await jest.unstable_mockModule(LC, () => ({
    refreshLibraryData: jest.fn(),
    resolveSubjectChain: jest.fn(async () => 84532),
    setLibrarySubject: jest.fn(() => false),
  }));
  await jest.unstable_mockModule(AL, () => ({
    refreshAssetLibrary: jest.fn(),
  }));
  await jest.unstable_mockModule(WS, () => ({
    walletState: { get: jest.fn(() => ({ walletAddress })) },
  }));
  const router = await import("../../frontend/src/js/app/router.js");
  // The real library-state store (router consults it for the profile subject).
  const { libraryState } = await import(
    "../../frontend/src/js/state/library-state.js"
  );
  return { ...router, libraryState };
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

  test("updates document.title per view", async () => {
    const { setView } = await loadRouter();
    setView("library");
    expect(document.title).toBe("Library — Arbesk");
    setView("studio");
    expect(document.title).toBe("Studio — Arbesk");
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

describe("scopeUrlToSubject", () => {
  const ADDRESS = "0xccC626354A2Ea985d4aBDC1173597a46aFC63595";
  const BASE58 = "3rTyYaQADATmQkvr5vkTteihpSHz";

  function spyOnReplaceState(path) {
    // Reset any spy a previous test left installed so setup calls and call
    // counts never leak between tests.
    jest.restoreAllMocks();
    window.history.replaceState({}, "", path);
    return jest.spyOn(window.history, "replaceState");
  }

  test("bare /library is rewritten to the wallet's profile URL", async () => {
    const { scopeUrlToSubject } = await loadRouter();
    const spy = spyOnReplaceState("/library");
    scopeUrlToSubject(ADDRESS);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][2]).toBe(`/library/${BASE58}`);
    expect(location.pathname).toBe(`/library/${BASE58}`);
  });

  test("bare /studio is rewritten too", async () => {
    const { scopeUrlToSubject } = await loadRouter();
    const spy = spyOnReplaceState("/studio");
    scopeUrlToSubject(ADDRESS);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][2]).toBe(`/studio/${BASE58}`);
  });

  test("the query string is preserved", async () => {
    const { scopeUrlToSubject } = await loadRouter();
    const spy = spyOnReplaceState("/library?asset=42&assetId=root");
    scopeUrlToSubject(ADDRESS);
    expect(spy.mock.calls[0][2]).toBe(`/library/${BASE58}?asset=42&assetId=root`);
  });

  test("a URL that already carries a subject is left alone", async () => {
    const { scopeUrlToSubject } = await loadRouter();
    const spy = spyOnReplaceState(`/library/${BASE58}`);
    scopeUrlToSubject(ADDRESS);
    expect(spy).not.toHaveBeenCalled();
    expect(location.pathname).toBe(`/library/${BASE58}`);
  });

  test("an invalid subject segment is left alone", async () => {
    const { scopeUrlToSubject } = await loadRouter();
    const spy = spyOnReplaceState("/library/not-valid!!!");
    scopeUrlToSubject(ADDRESS);
    expect(spy).not.toHaveBeenCalled();
  });

  test("non-view paths are untouched", async () => {
    const { scopeUrlToSubject } = await loadRouter();
    for (const path of ["/", "/anything-else", "/foo/bar"]) {
      const spy = spyOnReplaceState(path);
      scopeUrlToSubject(ADDRESS);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });

  test("empty or invalid address is a no-op", async () => {
    const { scopeUrlToSubject } = await loadRouter();
    const spy = spyOnReplaceState("/library");
    scopeUrlToSubject("");
    scopeUrlToSubject("not-an-address");
    expect(spy).not.toHaveBeenCalled();
    expect(location.pathname).toBe("/library");
  });
});

describe("navigate withSubject scoping", () => {
  const WALLET = "0xccC626354A2Ea985d4aBDC1173597a46aFC63595";
  const WALLET_BASE58 = "3rTyYaQADATmQkvr5vkTteihpSHz";
  // Hardhat account #0 — stands in for "someone else's" profile.
  const OTHER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
  const OTHER_BASE58 = "4Prk42UGhL8jJiiQCPRNwhVfQduP";

  function lastPushedUrl(spy) {
    return spy.mock.calls[spy.mock.calls.length - 1][2];
  }

  test("bare /studio?asset=… gains the connected wallet's id", async () => {
    const { navigate } = await loadRouter({ walletAddress: WALLET });
    window.history.replaceState({}, "", "/library");
    const spy = jest.spyOn(window.history, "pushState");
    navigate("/studio?asset=42&assetId=root");
    expect(lastPushedUrl(spy)).toBe(`/studio/${WALLET_BASE58}?asset=42&assetId=root`);
    spy.mockRestore();
  });

  test("the viewed profile's subject wins over the connected wallet", async () => {
    const { navigate, libraryState } = await loadRouter({ walletAddress: WALLET });
    libraryState.set({ subjectAddress: OTHER });
    window.history.replaceState({}, "", `/library/${OTHER_BASE58}`);
    const spy = jest.spyOn(window.history, "pushState");
    navigate("/studio?asset=42");
    expect(lastPushedUrl(spy)).toBe(`/studio/${OTHER_BASE58}?asset=42`);
    spy.mockRestore();
  });

  test("anonymous with no subject leaves the bare path unchanged", async () => {
    const { navigate } = await loadRouter();
    window.history.replaceState({}, "", "/library");
    const spy = jest.spyOn(window.history, "pushState");
    navigate("/studio?asset=42");
    expect(lastPushedUrl(spy)).toBe("/studio?asset=42");
    spy.mockRestore();
  });

  test("already-scoped paths are untouched", async () => {
    const { navigate } = await loadRouter({ walletAddress: WALLET });
    window.history.replaceState({}, "", "/library");
    const spy = jest.spyOn(window.history, "pushState");
    navigate(`/studio/${OTHER_BASE58}?asset=42`);
    expect(lastPushedUrl(spy)).toBe(`/studio/${OTHER_BASE58}?asset=42`);
    spy.mockRestore();
  });

  test("non-view paths are untouched", async () => {
    const { navigate } = await loadRouter({ walletAddress: WALLET });
    window.history.replaceState({}, "", "/library");
    const spy = jest.spyOn(window.history, "pushState");
    navigate("/foo/bar");
    expect(lastPushedUrl(spy)).toBe("/foo/bar");
    spy.mockRestore();
  });

  test("the bare /library tab path gains the current subject", async () => {
    const { navigate, libraryState } = await loadRouter();
    libraryState.set({ subjectAddress: OTHER });
    window.history.replaceState({}, "", "/studio");
    const spy = jest.spyOn(window.history, "pushState");
    navigate("/library");
    expect(lastPushedUrl(spy)).toBe(`/library/${OTHER_BASE58}`);
    spy.mockRestore();
  });
});
