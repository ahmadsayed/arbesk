/**
 * Viewport-top task progress overlay (save/publish flows).
 *
 * GNOME infobar-style banner pinned to the top edge of the 3D viewport:
 * visible without blocking interaction (pointer-events: none), with a stage
 * label telling the user what is happening right now (e.g. "Waiting for
 * wallet confirmation…"). Progress is stepped — callers advance the fill at
 * each orchestrator stage; there is no fake indeterminate animation.
 *
 * DOM lookups are lazy so the module is safe to import on pages without the
 * viewport markup (and testable under jsdom).
 */

const FADE_DELAY_MS = 2200;
const ERROR_FADE_DELAY_MS = 4000;

/** @type {ReturnType<typeof setTimeout>|null} */
let hideTimer = null;

function els() {
  return {
    overlay: document.getElementById("taskProgress"),
    label: document.getElementById("taskProgressLabel"),
    fill: document.getElementById("taskProgressFill"),
  };
}

/**
 * @param {number} fraction - 0..1
 * @param {string} text
 */
function render(fraction, text) {
  const { overlay, label, fill } = els();
  if (!overlay || !label || !fill) return;
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  overlay.classList.remove("fade", "error");
  overlay.hidden = false;
  label.textContent = text;
  fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

/**
 * @param {number} delay
 */
function scheduleHide(delay) {
  const { overlay } = els();
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hideTimer = null;
    const { overlay: current } = els();
    if (!current) return;
    current.classList.add("fade");
    // Hide after the fade transition completes.
    setTimeout(() => {
      const { overlay: latest } = els();
      if (latest) latest.hidden = true;
    }, 200);
  }, delay);
  return overlay;
}

/**
 * Show the overlay at a starting fraction with a stage label.
 * @param {string} text - what is happening, e.g. "Saving draft — uploading to IPFS…"
 * @param {number} [fraction=0.1]
 */
export function startTaskProgress(text, fraction = 0.1) {
  render(fraction, text);
}

/**
 * Advance the bar to a new stage.
 * @param {number} fraction - 0..1
 * @param {string} text
 */
export function setTaskProgress(fraction, text) {
  render(fraction, text);
}

/**
 * Complete the bar (100%) and fade the overlay out shortly after.
 * @param {string} text - final stage, e.g. "Draft saved."
 */
export function finishTaskProgress(text) {
  render(1, text);
  scheduleHide(FADE_DELAY_MS);
}

/**
 * Mark the bar as failed (error styling) and fade out after a longer delay.
 * @param {string} text - failure summary
 */
export function failTaskProgress(text) {
  render(1, text);
  const { overlay } = els();
  overlay?.classList.add("error");
  scheduleHide(ERROR_FADE_DELAY_MS);
}
