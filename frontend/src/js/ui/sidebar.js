/**
 * Arbesk Unified Sidebar Controller
 *
 * Single sidebar with a 5-view switcher.
 * Views: AI Generation (chat), Settings, Outline, Gallery, Ledger.
 * The width is user-resizable (drag handle, persisted) on wide layouts.
 */

import { emit, EVENTS } from "../events/bus.js";

const VIEWS = ["chat", "settings", "outline", "library", "ledger"];
const STORAGE_KEY = "arbesk-sidebar-view";
const WIDTH_STORAGE_KEY = "arbesk-sidebar-width";
const MIN_SIDEBAR_WIDTH = 260;
const MAX_SIDEBAR_WIDTH = 560;

/** @type {HTMLElement|null} */
let sidebar = null;
/** @type {HTMLElement[]} */
let switcherBtns = [];
/** @type {Record<string, HTMLElement|null>} */
let viewPanes = {};
/** @type {string|null} */
let activeView = null;
let collapsed = false;

// ─── Initialization ──────────────────────────────────────────────────

function initSidebar() {
  sidebar = document.querySelector(".sidebar");
  if (!sidebar) return;
  const sidebarEl = sidebar;

  // Cache DOM
  switcherBtns = Array.from(
    sidebarEl.querySelectorAll(".sidebar-switcher-btn")
  ).map((el) => /** @type {HTMLElement} */ (el));
  viewPanes = {};
  VIEWS.forEach((v) => {
    viewPanes[v] = sidebarEl.querySelector(`.sidebar-view[data-view="${v}"]`);
  });

  // Restore last view or default to "chat"
  const stored = localStorage.getItem(STORAGE_KEY);
  switchView(stored && VIEWS.includes(stored) ? stored : "chat");

  // On narrow screens the sidebar overlays the viewport, so it must start
  // closed or it hides the canvas and prompt input on first visit.
  if (window.matchMedia("(max-width: 900px)").matches) {
    collapseSidebar();
  }

  // Pulse the chat button as an empty-state hint (JS owns this, not the template)
  const chatBtn = switcherBtns.find((b) => b.dataset.view === "chat");
  if (chatBtn) chatBtn.classList.add("pulse");

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

  function isEditing() {
    const activeEl = /** @type {HTMLElement|null} */ (document.activeElement);
    const tag = activeEl?.tagName?.toLowerCase();
    return (
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

  // Keyboard: Ctrl+1-5 to switch views
  document.addEventListener("keydown", (e) => {
    if (isEditing()) return;
    if ((e.ctrlKey || e.metaKey) && e.key >= "1" && e.key <= "5") {
      e.preventDefault();
      const idx = parseInt(e.key) - 1;
      if (VIEWS[idx]) switchView(VIEWS[idx]);
    }
  });
}

// ─── View Switching ──────────────────────────────────────────────────

/**
 * @param {string} viewName
 */
function switchView(viewName) {
  if (!viewPanes[viewName]) return;

  // Hide all panes
  Object.values(viewPanes).forEach((pane) => {
    if (pane) pane.hidden = true;
  });

  // Show selected pane
  viewPanes[viewName].hidden = false;
  activeView = viewName;

  emit(EVENTS.SIDEBAR_VIEW_CHANGED, { view: viewName });

  // Update switcher button active states
  switcherBtns.forEach((btn) => {
    const selected = btn.dataset.view === viewName;
    btn.classList.toggle("active", selected);
    btn.setAttribute("aria-selected", String(selected));
    btn.setAttribute("tabindex", selected ? "0" : "-1");
  });

  // Persist
  localStorage.setItem(STORAGE_KEY, viewName);

  // Auto-expand if collapsed
  if (collapsed) expandSidebar();
}

function getActiveView() {
  return activeView;
}

// ─── Collapse / Expand ───────────────────────────────────────────────

function toggleSidebar() {
  if (collapsed) expandSidebar();
  else collapseSidebar();
}

function collapseSidebar() {
  if (!sidebar) return;
  sidebar.classList.add("collapsed");
  collapsed = true;
  const toggleBtn = document.getElementById("sidebarToggle");
  if (toggleBtn) toggleBtn.setAttribute("aria-expanded", "false");
}

function expandSidebar() {
  if (!sidebar) return;
  sidebar.classList.remove("collapsed");
  collapsed = false;
  const toggleBtn = document.getElementById("sidebarToggle");
  if (toggleBtn) toggleBtn.setAttribute("aria-expanded", "true");
}

function isCollapsed() {
  return collapsed;
}

// ─── Width Resizing ──────────────────────────────────────────────────

/**
 * @param {number} px
 * @returns {number}
 */
function clampSidebarWidth(px) {
  return Math.min(
    MAX_SIDEBAR_WIDTH,
    Math.max(MIN_SIDEBAR_WIDTH, Math.round(px))
  );
}

// Resizing only applies to wide layouts; at ≤900px the sidebar is an overlay
// pinned by the responsive tokens.
function isWideLayout() {
  return window.matchMedia("(min-width: 901px)").matches;
}

function applyStoredSidebarWidth() {
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

/**
 * @param {number} px
 */
function setUserSidebarWidth(px) {
  if (!sidebar) return;
  sidebar.style.setProperty(
    "--sidebar-width-user",
    `${clampSidebarWidth(px)}px`
  );
}

function persistUserSidebarWidth() {
  if (!sidebar) return;
  const width = parseInt(
    sidebar.style.getPropertyValue("--sidebar-width-user"),
    10
  );
  if (Number.isFinite(width)) {
    localStorage.setItem(WIDTH_STORAGE_KEY, String(clampSidebarWidth(width)));
  }
}

function resetSidebarWidth() {
  if (!sidebar) return;
  localStorage.removeItem(WIDTH_STORAGE_KEY);
  sidebar.style.removeProperty("--sidebar-width-user");
}

function initSidebarResizeHandle() {
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
      const target = /** @type {Node|null} */ (e.target);
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
  toggleSidebar,
  collapseSidebar,
  expandSidebar,
  isCollapsed,
};
