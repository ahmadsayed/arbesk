// TODO: tighten types for SVG DOM and strict event typing; currently too dynamic for strict checkJs.
// @ts-nocheck
/**
 * Version Clock face — reusable SVG dial for scrubbing the manifest chain.
 *
 * Pure view: no engine or store imports. One tick per version around the
 * dial, newest at 12 o'clock running clockwise into the past, a draggable
 * hand, a green ring on the published tick, version badge + detail in the
 * center. Emits onCommit(index) when the user lands on a version (pointer
 * release, wheel debounce, or keyboard step).
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const TICK_OUTER = 44; // viewBox units; viewBox is 0 0 100 100, center (50,50)
const TICK_INNER = 37;
const DOT_R = 1.6; // thinned tick dot radius
const WHEEL_COMMIT_MS = 400;
const THIN_ABOVE = 24; // start thinning ticks past this many versions

/** Angle in degrees for entry index i of n. Exported for tests. */
export function _angleForIndex(i, n) {
  return -90 + ((n - 1 - i) * 360) / n;
}

function polar(angleDeg, radius) {
  const rad = (angleDeg * Math.PI) / 180;
  return [50 + radius * Math.cos(rad), 50 + radius * Math.sin(rad)];
}

function entryDetail(entry) {
  if (!entry) return "";
  const nodes = `${entry.nodeCount} node${entry.nodeCount !== 1 ? "s" : ""}`;
  const when = entry.timestamp
    ? new Date(entry.timestamp).toLocaleString()
    : "";
  return [entry.name || "Untitled", `v${entry.version}`, nodes, when]
    .filter(Boolean)
    .join(" · ");
}

export function createVersionClock({ onCommit }) {
  let view = { entries: [], activeIndex: -1, publishedIndex: -1, loading: false };
  let previewIndex = null; // non-null while dragging / wheel-stepping
  let wheelTimer = null;
  let dragging = false;

  const el = document.createElement("div");
  el.className = "version-clock";
  el.setAttribute("role", "slider");
  el.setAttribute("aria-label", "Asset version");
  el.setAttribute("aria-valuemin", "0");
  el.tabIndex = 0;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("aria-hidden", "true");

  const face = document.createElementNS(SVG_NS, "circle");
  face.setAttribute("class", "vc-face");
  face.setAttribute("cx", "50");
  face.setAttribute("cy", "50");
  face.setAttribute("r", "48");

  const ticks = document.createElementNS(SVG_NS, "g");
  ticks.setAttribute("class", "vc-ticks");

  const publishedRing = document.createElementNS(SVG_NS, "circle");
  publishedRing.setAttribute("class", "vc-published-ring");
  publishedRing.setAttribute("r", "4.5");
  publishedRing.setAttribute("display", "none");

  // Hand drawn pointing up (12 o'clock = -90°); rotated via transform.
  const hand = document.createElementNS(SVG_NS, "line");
  hand.setAttribute("class", "vc-hand");
  hand.setAttribute("x1", "50");
  hand.setAttribute("y1", "50");
  hand.setAttribute("x2", "50");
  hand.setAttribute("y2", String(50 - TICK_INNER + 4));

  const pivot = document.createElementNS(SVG_NS, "circle");
  pivot.setAttribute("class", "vc-pivot");
  pivot.setAttribute("cx", "50");
  pivot.setAttribute("cy", "50");
  pivot.setAttribute("r", "2.5");

  const badge = document.createElementNS(SVG_NS, "text");
  badge.setAttribute("class", "vc-badge");
  badge.setAttribute("x", "50");
  badge.setAttribute("y", "68");
  badge.setAttribute("text-anchor", "middle");

  svg.append(face, ticks, publishedRing, hand, pivot, badge);

  const detail = document.createElement("div");
  detail.className = "vc-detail";

  el.append(svg, detail);

  // ─── Rendering ───

  function shownIndex() {
    return previewIndex !== null ? previewIndex : view.activeIndex;
  }

  function renderTicks() {
    ticks.textContent = "";
    const n = view.entries.length;
    const k = n > THIN_ABOVE ? Math.ceil(n / THIN_ABOVE) : 1;
    for (let i = 0; i < n; i++) {
      const angle = _angleForIndex(i, n);
      const major =
        (n - 1 - i) % k === 0 || i === view.activeIndex || i === view.publishedIndex;
      if (major) {
        const [x1, y1] = polar(angle, TICK_OUTER);
        const [x2, y2] = polar(angle, TICK_INNER);
        const line = document.createElementNS(SVG_NS, "line");
        line.setAttribute("class", "vc-tick");
        line.setAttribute("x1", String(x1));
        line.setAttribute("y1", String(y1));
        line.setAttribute("x2", String(x2));
        line.setAttribute("y2", String(y2));
        ticks.appendChild(line);
      } else {
        const [cx, cy] = polar(angle, (TICK_OUTER + TICK_INNER) / 2);
        const dot = document.createElementNS(SVG_NS, "circle");
        dot.setAttribute("class", "vc-tick vc-tick-minor");
        dot.setAttribute("cx", String(cx));
        dot.setAttribute("cy", String(cy));
        dot.setAttribute("r", String(DOT_R));
        ticks.appendChild(dot);
      }
    }
  }

  function renderIndicators() {
    const n = view.entries.length;
    const idx = shownIndex();
    const entry = view.entries[idx];

    if (n > 0 && idx >= 0) {
      const angle = _angleForIndex(idx, n);
      hand.setAttribute("transform", `rotate(${angle + 90} 50 50)`);
    }
    badge.textContent = entry ? `v${entry.version}` : "";
    detail.textContent = entryDetail(entry);

    if (view.publishedIndex >= 0 && n > 0) {
      const [cx, cy] = polar(
        _angleForIndex(view.publishedIndex, n),
        (TICK_OUTER + TICK_INNER) / 2
      );
      publishedRing.setAttribute("cx", String(cx));
      publishedRing.setAttribute("cy", String(cy));
      publishedRing.removeAttribute("display");
    } else {
      publishedRing.setAttribute("display", "none");
    }

    el.classList.toggle("loading", view.loading);
    el.classList.toggle(
      "published",
      view.publishedIndex >= 0 && view.activeIndex === view.publishedIndex
    );

    el.setAttribute("aria-valuemax", String(Math.max(0, n - 1)));
    el.setAttribute("aria-valuenow", String(Math.max(0, idx)));
    el.setAttribute("aria-valuetext", entry ? `Version ${entry.version}` : "");
  }

  function update(next) {
    view = next;
    if (!dragging) previewIndex = null;
    renderTicks();
    renderIndicators();
  }

  // ─── Interaction ───

  function clamp(i) {
    return Math.max(0, Math.min(view.entries.length - 1, i));
  }

  function indexForPointer(e) {
    const n = view.entries.length;
    if (n === 0) return -1;
    const rect = el.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI; // 0° = 3 o'clock
    const steps =
      Math.round(((((deg + 90) % 360) + 360) % 360) / (360 / n)) % n;
    return n - 1 - steps;
  }

  function commit(index) {
    if (index < 0 || index >= view.entries.length) return;
    if (index === view.activeIndex) {
      previewIndex = null;
      renderIndicators();
      return;
    }
    onCommit(index);
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    if (view.entries.length < 2) return;
    dragging = true;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    previewIndex = clamp(indexForPointer(e));
    renderIndicators();
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const idx = clamp(indexForPointer(e));
    if (idx !== previewIndex) {
      previewIndex = idx;
      renderIndicators();
    }
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    const idx = previewIndex;
    previewIndex = null;
    if (idx !== null) commit(idx);
  }

  function onWheel(e) {
    if (view.entries.length < 2) return;
    e.preventDefault();
    const base = shownIndex();
    previewIndex = clamp(base + (e.deltaY > 0 ? -1 : 1)); // wheel down = older
    renderIndicators();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      const idx = previewIndex;
      previewIndex = null;
      if (idx !== null) commit(idx);
    }, WHEEL_COMMIT_MS);
  }

  function onKeyDown(e) {
    const n = view.entries.length;
    if (n < 2) return;
    let idx = null;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown":
        idx = clamp(view.activeIndex - 1); // older
        break;
      case "ArrowRight":
      case "ArrowUp":
        idx = clamp(view.activeIndex + 1); // newer
        break;
      case "Home":
        idx = 0; // oldest
        break;
      case "End":
        idx = n - 1; // newest
        break;
      default:
        return;
    }
    e.preventDefault();
    if (idx !== view.activeIndex) commit(idx);
  }

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerUp);
  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("keydown", onKeyDown);

  function destroy() {
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerUp);
    el.removeEventListener("pointercancel", onPointerUp);
    el.removeEventListener("wheel", onWheel);
    el.removeEventListener("keydown", onKeyDown);
    clearTimeout(wheelTimer);
    el.remove();
  }

  update(view);
  return { el, update, destroy };
}
