/**
 * Sidebar with a 4-view switcher (outline, library = "Insert", chat = "Create", ledger = "Activity").
 * @remarks Width is user-resizable and persisted, but only on wide layouts.
 */

import { emit, on, EVENTS } from "@arbesk/asset-core/events/bus.js";

const VIEWS = ["outline", "library", "chat", "ledger"];
const STORAGE_KEY = "arbesk-sidebar-view";
const WIDTH_STORAGE_KEY = "arbesk-sidebar-width";
const MIN_SIDEBAR_WIDTH = 260;
const MAX_SIDEBAR_WIDTH = 560;

let sidebar: HTMLElement | null = null;
let switcherBtns: HTMLElement[] = [];
let viewPanes: Record<string, HTMLElement | null> = {};
let activeView: string | null = null;
let collapsed = false;
// True while the Studio shows the unpersisted Create landing (no asset open
// at load). Cleared by any persisted tab choice.
let onCreateLanding = false;
// "Is an asset open?" (state/edit-mode.ts isAssetOpen), injected by
// initSidebar so this leaf module stays free of the engine/state graph.
let assetIsOpen: () => boolean = () => true;

/** The last-used tab; retired views ("settings") and unknown values → Outline. */
function storedView(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored && VIEWS.includes(stored) ? stored : "outline";
}

// ─── Initialization ──────────────────────────────────────────────────

/**
 * @param options.isAssetOpen - the Studio's "an asset is open" predicate;
 *   decides when the Create landing gives way to the last-used tab.
 */
function initSidebar(options: { isAssetOpen?: () => boolean } = {}): void {
  if (options.isAssetOpen) assetIsOpen = options.isAssetOpen;
  sidebar = document.querySelector(".sidebar") as HTMLElement | null;
  if (!sidebar) return;
  const sidebarEl = sidebar;

  // Cache DOM
  switcherBtns = Array.from(
    sidebarEl.querySelectorAll(".sidebar-switcher-btn")
  ).map((el) => el as HTMLElement);
  viewPanes = {};
  VIEWS.forEach((v) => {
    viewPanes[v] = sidebarEl.querySelector(
      `.sidebar-view[data-view="${v}"]`
    ) as HTMLElement | null;
  });

  // No asset in the URL: land on Create. Otherwise restore the last view.
  const params = new URLSearchParams(location.search);
  const hasAsset = params.has("asset") || params.has("assetId") || params.has("manifest");
  // Landing on Create must not clobber the last-used tab.
  if (hasAsset) {
    switchView(storedView());
  } else {
    switchView("chat", false);
    onCreateLanding = true;
  }

  // On narrow screens the sidebar overlays the viewport, so it must start
  // closed or it hides the canvas on first visit.
  if (window.matchMedia("(max-width: 900px)").matches) {
    collapseSidebar();
  }

  // Wire switcher buttons
  switcherBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.view;
      if (view) switchView(view);
    });
  });

  // Toggle button
  const toggleBtn = document.getElementById("sidebarToggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", toggleSidebar);
  }

  // Reveal button (visible when collapsed)
  const revealBtn = document.getElementById("sidebarReveal");
  if (revealBtn) {
    revealBtn.addEventListener("click", expandSidebar);
  }

  // Width: restore the user's width, wire the drag handle, and keep the
  // feature in sync with the wide/overlay layout boundary.
  applyStoredSidebarWidth();
  initSidebarResizeHandle();
  window
    .matchMedia("(min-width: 901px)")
    .addEventListener("change", applyStoredSidebarWidth);

  function isEditing(): boolean {
    const activeEl = document.activeElement as HTMLElement | null;
    const tag = activeEl?.tagName?.toLowerCase();
    return !!(
      activeEl?.isContentEditable ||
      tag === "input" ||
      tag === "textarea" ||
      tag === "select"
    );
  }

  // Keyboard: Ctrl+B to toggle
  document.addEventListener("keydown", (e) => {
    if (isEditing()) return;
    if ((e.ctrlKey || e.metaKey) && e.key === "b") {
      e.preventDefault();
      toggleSidebar();
    }
  });

  // Keyboard: Ctrl+1-4 to switch views
  document.addEventListener("keydown", (e) => {
    if (isEditing()) return;
    if ((e.ctrlKey || e.metaKey) && e.key >= "1" && e.key <= "4") {
      e.preventDefault();
      const idx = parseInt(e.key) - 1;
      if (VIEWS[idx]) switchView(VIEWS[idx]);
    }
  });
}

// ─── View Switching ──────────────────────────────────────────────────

function switchView(viewName: string, persist = true, expand = true): void {
  if (!viewPanes[viewName]) return;

  // Hide all panes
  Object.values(viewPanes).forEach((pane) => {
    if (pane) pane.hidden = true;
  });

  // Show selected pane
  viewPanes[viewName]!.hidden = false;
  activeView = viewName;

  emit(EVENTS.SIDEBAR_VIEW_CHANGED, { view: viewName });

  // Update switcher button active states
  switcherBtns.forEach((btn) => {
    const selected = btn.dataset.view === viewName;
    btn.classList.toggle("active", selected);
    btn.setAttribute("aria-selected", String(selected));
    btn.setAttribute("tabindex", selected ? "0" : "-1");
  });

  // Persist. A persisted choice (a tab click, Ctrl+1..4, New ▾) ends the
  // Create landing.
  if (persist) {
    localStorage.setItem(STORAGE_KEY, viewName);
    onCreateLanding = false;
  }

  // Auto-expand if collapsed
  if (expand && collapsed) expandSidebar();
}

function getActiveView(): string | null {
  return activeView;
}

/**
 * The Create panel opens its own generation: stay on Create.
 * @remarks Call before the open (it ends the landing without switching), so
 *   the SCENE_READY that follows keeps the user in the panel they are using.
 */
function keepCreateView(): void {
  onCreateLanding = false;
}

/**
 * First asset open after landing on Create: go to the last-used tab.
 * @remarks Spec 3.2 — the Create landing is for "no asset open"; once an
 *   asset is open the last-used tab is kept. Not persisted and does not
 *   expand a collapsed sidebar.
 */
function leaveCreateLanding(): void {
  if (!onCreateLanding || !assetIsOpen()) return;
  onCreateLanding = false;
  switchView(storedView(), false, false);
}

on(EVENTS.SCENE_READY, leaveCreateLanding);

// ─── Collapse / Expand ───────────────────────────────────────────────

function toggleSidebar(): void {
  if (collapsed) expandSidebar();
  else collapseSidebar();
}

function collapseSidebar(): void {
  if (!sidebar) return;
  sidebar.classList.add("collapsed");
  collapsed = true;
  const toggleBtn = document.getElementById("sidebarToggle");
  if (toggleBtn) toggleBtn.setAttribute("aria-expanded", "false");
}

function expandSidebar(): void {
  if (!sidebar) return;
  sidebar.classList.remove("collapsed");
  collapsed = false;
  const toggleBtn = document.getElementById("sidebarToggle");
  if (toggleBtn) toggleBtn.setAttribute("aria-expanded", "true");
}

function isCollapsed(): boolean {
  return collapsed;
}

// ─── Width Resizing ──────────────────────────────────────────────────

function clampSidebarWidth(px: number): number {
  return Math.min(
    MAX_SIDEBAR_WIDTH,
    Math.max(MIN_SIDEBAR_WIDTH, Math.round(px))
  );
}

// Resizing only applies to wide layouts; at ≤900px the sidebar is an overlay
// pinned by the responsive tokens.
function isWideLayout(): boolean {
  return window.matchMedia("(min-width: 901px)").matches;
}

function applyStoredSidebarWidth(): void {
  if (!sidebar) return;
  if (!isWideLayout()) {
    sidebar.style.removeProperty("--sidebar-width-user");
    return;
  }
  const stored = parseInt(localStorage.getItem(WIDTH_STORAGE_KEY) || "", 10);
  if (Number.isFinite(stored)) {
    sidebar.style.setProperty(
      "--sidebar-width-user",
      `${clampSidebarWidth(stored)}px`
    );
  } else {
    sidebar.style.removeProperty("--sidebar-width-user");
  }
}

function setUserSidebarWidth(px: number): void {
  if (!sidebar) return;
  sidebar.style.setProperty(
    "--sidebar-width-user",
    `${clampSidebarWidth(px)}px`
  );
}

function persistUserSidebarWidth(): void {
  if (!sidebar) return;
  const width = parseInt(
    sidebar.style.getPropertyValue("--sidebar-width-user"),
    10
  );
  if (Number.isFinite(width)) {
    localStorage.setItem(WIDTH_STORAGE_KEY, String(clampSidebarWidth(width)));
  }
}

function resetSidebarWidth(): void {
  if (!sidebar) return;
  localStorage.removeItem(WIDTH_STORAGE_KEY);
  sidebar.style.removeProperty("--sidebar-width-user");
}

function initSidebarResizeHandle(): void {
  const handle = document.getElementById("sidebarResizeHandle");
  if (!handle || !sidebar) return;
  const sidebarEl = sidebar;

  let dragging = false;
  let dragStartX = 0;
  let dragStartWidth = 0;

  handle.addEventListener("pointerdown", (e) => {
    if (!isWideLayout() || collapsed) return;
    dragging = true;
    dragStartX = e.clientX;
    dragStartWidth = sidebarEl.getBoundingClientRect().width;
    handle.setPointerCapture(e.pointerId);
    sidebarEl.classList.add("resizing");
    document.body.classList.add("sidebar-resizing");
    e.preventDefault();
  });

  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    setUserSidebarWidth(dragStartWidth + (e.clientX - dragStartX));
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    sidebarEl.classList.remove("resizing");
    document.body.classList.remove("sidebar-resizing");
    persistUserSidebarWidth();
  };
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);

  // Double-click restores the default token width.
  handle.addEventListener("dblclick", resetSidebarWidth);

  // Keyboard: ←/→ steps 16px, Home restores the default.
  handle.addEventListener("keydown", (e) => {
    if (e.key === "Home") {
      e.preventDefault();
      resetSidebarWidth();
      return;
    }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const delta = e.key === "ArrowRight" ? 16 : -16;
    setUserSidebarWidth(sidebarEl.getBoundingClientRect().width + delta);
    persistUserSidebarWidth();
  });
}

// ─── Responsive ──────────────────────────────────────────────────────

// On narrow screens, collapse sidebar when clicking the main content area
document.addEventListener("DOMContentLoaded", () => {
  const mainStage = document.getElementById("mainStage");
  if (!mainStage) return;

  mainStage.addEventListener("click", (e) => {
    // Only auto-collapse on narrow screens
    if (window.innerWidth <= 900 && !collapsed) {
      // Don't collapse if clicking on a sidebar element
      const target = e.target as Node | null;
      if (sidebar && target && sidebar.contains(target)) return;
      collapseSidebar();
    }
  });
});

// ─── Exports ─────────────────────────────────────────────────────────

export {
  initSidebar,
  switchView,
  getActiveView,
  keepCreateView,
  toggleSidebar,
  collapseSidebar,
  expandSidebar,
  isCollapsed,
};
