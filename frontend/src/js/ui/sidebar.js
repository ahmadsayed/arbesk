/**
 * Arbesk Unified Sidebar Controller
 *
 * Single sidebar with 4-view switcher replacing 3 separate panels.
 * Views: Create, Outline, Library, Ledger.
 */

import { emit, EVENTS } from "../events/bus.js";

const VIEWS = ["settings", "chat", "outline", "library", "ledger"];
const STORAGE_KEY = "arbesk-sidebar-view";

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
