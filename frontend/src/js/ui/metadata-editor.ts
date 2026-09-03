/**
 * Inspector "Metadata" section: read-only computed facts and editable
 * annotations.
 * @remarks Edits write to the pending-annotations store (persisted on save).
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

/** Human-readable label + formatter for each computed fact. */
interface ComputedFieldDef {
  label: string;
  format: (v: unknown) => string;
}

const COMPUTED_ORDER = [
  "format",
  "dimensions",
  "bounds",
  "center",
  "origin",
  "animation_clips",
  "triangle_count",
  "vertex_count",
  "mesh_count",
  "node_count",
  "material_count",
  "texture_count",
  "rigged",
  "bone_count",
];

function trim(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "—";
}

function formatRaw(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

function formatVector(v: unknown): string {
  if (!Array.isArray(v)) return formatRaw(v);
  return "(" + v.map((n) => trim(Number(n))).join(", ") + ")";
}

function formatDimensions(v: unknown): string {
  const d = (v ?? {}) as { width?: number; height?: number; depth?: number; unit?: string };
  const dims = [d.width, d.height, d.depth]
    .map((n) => (typeof n === "number" ? trim(n) : "—"))
    .join(" × ");
  return dims + (d.unit ? " " + d.unit : "");
}

function formatBounds(v: unknown): string {
  const b = (v ?? {}) as { min?: number[]; max?: number[] };
  const min = Array.isArray(b.min) ? b.min.map((n) => trim(Number(n))).join(", ") : "—";
  const max = Array.isArray(b.max) ? b.max.map((n) => trim(Number(n))).join(", ") : "—";
  return "[" + min + "] → [" + max + "]";
}

function formatClips(v: unknown): string {
  if (!Array.isArray(v)) return formatRaw(v);
  return v.length === 0 ? "—" : v.join(", ");
}

function formatCount(v: unknown): string {
  return typeof v === "number" ? v.toLocaleString("en-US") : String(v);
}

function formatBoolean(v: unknown): string {
  return v ? "Yes" : "No";
}

const COMPUTED_FIELDS: Record<string, ComputedFieldDef> = {
  format: { label: "Format", format: (v) => String(v).toUpperCase() },
  dimensions: { label: "Dimensions", format: formatDimensions },
  bounds: { label: "Bounds", format: formatBounds },
  center: { label: "Center", format: formatVector },
  origin: { label: "Origin", format: formatVector },
  animation_clips: { label: "Animations", format: formatClips },
  triangle_count: { label: "Triangles", format: formatCount },
  vertex_count: { label: "Vertices", format: formatCount },
  mesh_count: { label: "Meshes", format: formatCount },
  node_count: { label: "Nodes", format: formatCount },
  material_count: { label: "Materials", format: formatCount },
  texture_count: { label: "Textures", format: formatCount },
  rigged: { label: "Rigged", format: formatBoolean },
  bone_count: { label: "Bones", format: formatCount },
};

function computedRank(key: string): number {
  const idx = COMPUTED_ORDER.indexOf(key);
  return idx === -1 ? COMPUTED_ORDER.length : idx;
}

function sortComputedEntries(entries: [string, unknown][]): [string, unknown][] {
  return entries.slice().sort((a, b) => computedRank(a[0]) - computedRank(b[0]));
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
  for (const [k, v] of sortComputedEntries(entries)) {
    const field = COMPUTED_FIELDS[k] ?? { label: k, format: formatRaw };
    const dt = document.createElement("dt");
    dt.className = "metadata-fact-label";
    dt.textContent = field.label;
    const dd = document.createElement("dd");
    dd.className = "metadata-fact-value";
    dd.textContent = field.format(v);
    dd.title = formatRaw(v);
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
