/**
 * Initializes the page theme.
 * @remarks Runs before page render to prevent a flash of the wrong theme.
 *   Mirrors readStoredPref/resolveTheme in theme.ts (this is a classic
 *   script, so it cannot import them).
 */
(function () {
  // Stored value → theme; "dark"/"light" are pre-Graphite legacy values.
  const STORED_THEME = new Map([
    ["graphite", "graphite"],
    ["paper", "paper"],
    ["dark", "graphite"],
    ["light", "paper"],
  ]);
  let stored: string | null = null;
  try {
    stored = localStorage.getItem("arbesk-theme");
  } catch {
    // storage blocked — fall through to system
  }
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme =
    STORED_THEME.get(stored ?? "") ?? (systemDark ? "graphite" : "paper");
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.setAttribute(
    "data-scheme",
    theme === "graphite" ? "dark" : "light",
  );
})();
