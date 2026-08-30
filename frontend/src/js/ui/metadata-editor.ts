/**
 * Inspector "Metadata" section: read-only computed facts + editable
 * annotations. Edits write to the pending-annotations store (persisted on
 * save). Renders on ASSET_STATE_CHANGED and SCENE_CLEARED.
 */
import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { getAssetState, getCurrentManifest } from "@arbesk/asset-core/domain/asset.js";
import { getPendingAnnotations, setPendingAnnotations, clearPendingAnnotations } from "../services/asset-save/annotations.ts";

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function readAnnotations(): Record<string, unknown> {
  const manifest = getCurrentManifest() as any;
  return getPendingAnnotations() ?? (manifest?.metadata?.annotations as Record<string, unknown>) ?? {};
}

function writeAnnotations(a: Record<string, unknown>): void {
  setPendingAnnotations(a);
}

function hasComputedFacts(
  computed: Record<string, unknown> | null | undefined
): computed is Record<string, unknown> {
  return !!computed && Object.keys(computed).length > 0;
}

function formatComputedValue(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

function renderComputedEmpty(list: HTMLElement): void {
  const empty = document.createElement("div");
  empty.className = "metadata-empty";
  empty.textContent = "No auto-detected facts yet — save the asset to compute them.";
  list.appendChild(empty);
}

function renderComputedEntries(
  list: HTMLElement,
  entries: [string, unknown][]
): void {
  for (const [k, v] of entries) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = formatComputedValue(v);
    list.append(dt, dd);
  }
}

function renderComputed(computed: Record<string, unknown> | null | undefined): void {
  const list = el("metadataComputedList");
  if (!list) return;
  list.textContent = "";
  if (!hasComputedFacts(computed)) {
    renderComputedEmpty(list);
    return;
  }
  renderComputedEntries(list, Object.entries(computed));
}

function rowHtml(key: string, value: unknown): HTMLElement {
  const row = document.createElement("div");
  row.className = "metadata-kv-row";

  const keyInput = document.createElement("input");
  keyInput.className = "form-input metadata-kv-key";
  keyInput.placeholder = "key";
  keyInput.value = key;
  keyInput.setAttribute("aria-label", "Metadata key");

  const valueInput = document.createElement("input");
  valueInput.className = "form-input metadata-kv-value";
  valueInput.placeholder = "value (JSON allowed)";
  valueInput.value = typeof value === "string" ? value : JSON.stringify(value);
  valueInput.setAttribute("aria-label", "Metadata value");

  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn btn-icon btn-sm metadata-kv-del";
  del.setAttribute("aria-label", "Remove field");
  del.textContent = "×";

  del.addEventListener("click", () => {
    row.remove();
    collect();
  });
  keyInput.addEventListener("input", collect);
  valueInput.addEventListener("input", collect);

  row.append(keyInput, valueInput, del);
  return row;
}

function collect(): void {
  const list = el("metadataAnnotationsList");
  if (!list) return;
  const out: Record<string, unknown> = {};
  list.querySelectorAll(".metadata-kv-row").forEach((row) => {
    const key = (row.querySelector(".metadata-kv-key") as HTMLInputElement).value.trim();
    const raw = (row.querySelector(".metadata-kv-value") as HTMLInputElement).value;
    if (!key) return;
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* keep raw string */
    }
    out[key] = parsed;
  });
  writeAnnotations(out);
}

function renderAnnotations(): void {
  const list = el("metadataAnnotationsList");
  if (!list) return;
  list.textContent = "";
  const annotations = readAnnotations();
  for (const [k, v] of Object.entries(annotations)) {
    list.appendChild(rowHtml(k, v));
  }
}

function render(): void {
  const section = el("metadataSection");
  const s = getAssetState();
  const hasAsset = !!s.activeAssetManifestCid;
  if (section) section.hidden = !hasAsset;
  if (!hasAsset) return;
  const manifest = getCurrentManifest() as any;
  renderComputed(manifest?.metadata?.computed);
  renderAnnotations();
}

export function initMetadataEditor(): void {
  el("metadataAddBtn")?.addEventListener("click", () => {
    el("metadataAnnotationsList")?.appendChild(rowHtml("", ""));
  });
  document.querySelectorAll(".metadata-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const key = (chip as HTMLElement).dataset.key || "";
      el("metadataAnnotationsList")?.appendChild(rowHtml(key, ""));
      collect();
    });
  });
  on(EVENTS.ASSET_STATE_CHANGED, render);
  on(EVENTS.SCENE_CLEARED, () => {
    clearPendingAnnotations();
    const section = el("metadataSection");
    if (section) section.hidden = true;
  });
  render();
}
