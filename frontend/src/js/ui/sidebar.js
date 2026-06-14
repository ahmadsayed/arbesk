/**
 * Arbesk Unified Sidebar Controller
 *
 * Single sidebar with 4-view switcher replacing 3 separate panels.
 * Views: Create, Outline, Library, Ledger.
 */

const VIEWS = ["settings", "chat", "outline", "library", "ledger"];
const STORAGE_KEY = "arbesk-sidebar-view";

let sidebar = null;
let switcherBtns = [];
let viewPanes = {};
let activeView = null;
let collapsed = false;

// ─── Initialization ──────────────────────────────────────────────────

function initSidebar() {
  sidebar = document.querySelector(".sidebar");
  if (!sidebar) return;

  // Cache DOM
  switcherBtns = Array.from(sidebar.querySelectorAll(".sidebar-switcher-btn"));
  viewPanes = {};
  VIEWS.forEach((v) => {
    viewPanes[v] = sidebar.querySelector(`.sidebar-view[data-view="${v}"]`);
  });

  // Restore last view or default to "chat"
  const stored = localStorage.getItem(STORAGE_KEY);
  switchView(stored && VIEWS.includes(stored) ? stored : "chat");

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
    const tag = document.activeElement?.tagName?.toLowerCase();
    return document.activeElement?.isContentEditable ||
      tag === "input" || tag === "textarea" || tag === "select";
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

function switchView(viewName) {
  if (!viewPanes[viewName]) return;

  // Hide all panes
  Object.values(viewPanes).forEach((pane) => {
    if (pane) pane.hidden = true;
  });

  // Show selected pane
  viewPanes[viewName].hidden = false;
  activeView = viewName;

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
      if (sidebar && sidebar.contains(e.target)) return;
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
