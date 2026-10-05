/**
 * /library?upload=1 — the landing page's "or upload a model" link.
 * @remarks Browsers refuse to open a file picker without a user gesture after
 *   navigation, so this points the user at the Upload button instead: once
 *   `#libraryUploadBtn` is visible (signed in, not a visitor) it is scrolled
 *   into view, focused and given a one-shot `.attention` pulse. app-init opens
 *   the sign-in modal when the visitor is signed out.
 */
export function initUploadDeepLink(): void {
  if (!new URLSearchParams(location.search).has("upload")) return;
  const url = new URL(location.href);
  url.searchParams.delete("upload");
  history.replaceState(history.state, "", url);

  const btn = document.getElementById("libraryUploadBtn");
  if (!btn) return;

  const highlight = () => {
    btn.scrollIntoView?.({ block: "nearest" });
    btn.focus();
    btn.classList.add("attention");
    btn.addEventListener("animationend", () => btn.classList.remove("attention"), { once: true });
  };

  if (!btn.hidden) {
    highlight();
    return;
  }
  const observer = new MutationObserver(() => {
    if (btn.hidden) return;
    observer.disconnect();
    highlight();
  });
  observer.observe(btn, { attributes: true, attributeFilter: ["hidden"] });
}
