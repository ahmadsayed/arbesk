/**
 * Viewport-top task progress overlay for save/publish flows.
 * @remarks Progress is stepped — there is no fake indeterminate animation.
 *   DOM lookups are lazy so the module is safe to import on pages without
 *   the viewport markup.
 */

const FADE_DELAY_MS = 2200;
const ERROR_FADE_DELAY_MS = 4000;

let hideTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Resolves the overlay, label and fill elements.
 * @remarks The label and fill elements are addressed as `<rootId>Label` /
 *   `<rootId>Fill`.
 */
function els(rootId = "taskProgress") {
  return {
    overlay: document.getElementById(rootId),
    label: document.getElementById(`${rootId}Label`),
    fill: document.getElementById(`${rootId}Fill`),
  };
}

function render(fraction: number, text: string, rootId?: string): void {
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

function scheduleHide(delay: number, rootId?: string) {
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
 * Shows the overlay at a starting fraction with a stage label.
 */
export function startTaskProgress(text: string, fraction = 0.1, rootId?: string): void {
  render(fraction, text, rootId);
}

/**
 * Advances the bar to a new stage.
 */
export function setTaskProgress(fraction: number, text: string, rootId?: string): void {
  render(fraction, text, rootId);
}

/**
 * Completes the bar (100%) and fades the overlay out shortly after.
 */
export function finishTaskProgress(text: string, rootId?: string): void {
  render(1, text, rootId);
  scheduleHide(FADE_DELAY_MS, rootId);
}

/**
 * Marks the bar as failed and fades it out after a longer delay.
 */
export function failTaskProgress(text: string, rootId?: string): void {
  render(1, text, rootId);
  const { overlay } = els(rootId);
  overlay?.classList.add("error");
  scheduleHide(ERROR_FADE_DELAY_MS, rootId);
}
