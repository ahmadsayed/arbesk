/**
 * Initializes the page theme.
 * @remarks Runs before page render to prevent a flash of the wrong theme.
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
