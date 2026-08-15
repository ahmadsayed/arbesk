/**
 * Theme Initializer
 *
 * Runs before page render to prevent flash of wrong theme.
 * Reads saved theme from localStorage or system preference.
 */
(function () {
  const s = localStorage.getItem("arbesk-theme");
  const t =
    s ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light");
  document.documentElement.setAttribute("data-theme", t);
})();
