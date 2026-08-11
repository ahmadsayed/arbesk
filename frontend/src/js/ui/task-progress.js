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

/**
 * @param {string} [rootId="taskProgress"] - element id prefix; the label and
 *   fill elements are resolved as `<rootId>Label` / `<rootId>Fill`
 */
function els(rootId = "taskProgress") {
  return {
    overlay: document.getElementById(rootId),
    label: document.getElementById(`${rootId}Label`),
    fill: document.getElementById(`${rootId}Fill`),
  };
}

/**
 * @param {number} fraction - 0..1
 * @param {string} text
 * @param {string} [rootId]
 */
function render(fraction, text, rootId) {
  const { overlay, label, fill } = els(rootId);
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
 * @param {string} [rootId]
 */
function scheduleHide(delay, rootId) {
  const { overlay } = els(rootId);
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hideTimer = null;
    const { overlay: current } = els(rootId);
    if (!current) return;
    current.classList.add("fade");
    // Hide after the fade transition completes.
    setTimeout(() => {
      const { overlay: latest } = els(rootId);
      if (latest) latest.hidden = true;
    }, 200);
  }, delay);
  return overlay;
}

/**
 * Show the overlay at a starting fraction with a stage label.
 * @param {string} text - what is happening, e.g. "Saving draft — uploading to IPFS…"
 * @param {number} [fraction=0.1]
 * @param {string} [rootId] - overlay id prefix (default: viewport "#taskProgress")
 */
export function startTaskProgress(text, fraction = 0.1, rootId) {
  render(fraction, text, rootId);
}

/**
 * Advance the bar to a new stage.
 * @param {number} fraction - 0..1
 * @param {string} text
 * @param {string} [rootId]
 */
export function setTaskProgress(fraction, text, rootId) {
  render(fraction, text, rootId);
}

/**
 * Complete the bar (100%) and fade the overlay out shortly after.
 * @param {string} text - final stage, e.g. "Draft saved."
 * @param {string} [rootId]
 */
export function finishTaskProgress(text, rootId) {
  render(1, text, rootId);
  scheduleHide(FADE_DELAY_MS, rootId);
}

/**
 * Mark the bar as failed (error styling) and fade out after a longer delay.
 * @param {string} text - failure summary
 * @param {string} [rootId]
 */
export function failTaskProgress(text, rootId) {
  render(1, text, rootId);
  const { overlay } = els(rootId);
  overlay?.classList.add("error");
  scheduleHide(ERROR_FADE_DELAY_MS, rootId);
}
