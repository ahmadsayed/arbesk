/**
 * Inspector "Parameters" section: the selected CAD part's parameters as
 * editable rows (lengths with a number box and slider, colours with a picker).
 * @remarks Rows list only the parameters the script reads (all of them when it
 *   reads PARAMETERS dynamically). Typing previews (cad-param-preview); a
 *   commit (change event) clamps to min/max and pushes one undo entry. The
 *   pending values live in state/cad-param-edits.ts, which Save writes.
 *   @arbesk/cad-gen is imported lazily so the main bundle only pays for it
 *   when a CAD part is selected.
 */
import type { CadDesign, CadParameter } from "@arbesk/cad-gen";
import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { getCurrentManifest } from "@arbesk/asset-core/domain/asset.js";
import { Alpine, registerAlpineComponent } from "./alpine.ts";
import { resolveCadDesign } from "../services/cad-design-source.ts";
import { getCadParamBase, scheduleCadPreview, setCadParamBase } from "../services/cad-param-preview.ts";
import { cadParamValues, cadPartIndex, getCadParamEdit, setCadParamValues } from "../state/cad-param-edits.ts";
import type { CadParamValues } from "../state/cad-param-edits.ts";
import { isEditing, subscribeEditMode } from "../state/edit-mode.ts";
import { pushUndoEntry } from "../engine/undo-stack.ts";

const VIEW_HINT = "Switch to Edit to change parameters.";
const NEWER_RUNTIME = "This part was made with a newer CAD runtime — refresh the page.";
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export interface CadParamRow {
  name: string;
  label: string;
  kind: "length" | "color";
  value: number | string;
  min?: number;
  max?: number;
  /** A slider is shown only when both bounds are known. */
  hasRange: boolean;
}

export interface CadParamsState {
  visible: boolean;
  nodeId: string | null;
  rows: CadParamRow[];
  /** The design can't run in this build (guard rejected it): read-only. */
  blocked: boolean;
  editable: boolean;
  hint: string;
  status: "saved" | "rendering" | "ok" | "error";
  statusText: string;
}

let _state: CadParamsState | null = null;

/** The section's reactive state (an Alpine store). */
// Read by test/frontend/cad-params-panel.test.js, which the fallow graph cannot see.
// fallow-ignore-next-line unused-export
export function cadParamsState(): CadParamsState {
  if (!_state) {
    if (!Alpine.store("cadParams")) {
      Alpine.store("cadParams", {
        visible: false, nodeId: null, rows: [], blocked: false, editable: false,
        hint: "", status: "saved", statusText: "",
      });
    }
    _state = Alpine.store("cadParams") as CadParamsState;
  }
  return _state;
}

/** The node's saved design, set by showCadParams. */
let _saved: CadDesign | null = null;
/** The shown parameter names. */
let _names: string[] = [];
/** Values at the last commit: an undo entry's `before`. */
let _committed: CadParamValues = {};
/** Values the panel itself last applied; anything else moving them is external (undo). */
let _applied: CadParamValues = {};
/** Mesh name → colour parameter, resolved once per shown node so a drag keeps its target. */
const _routes = new Map<string, string | null>();
/** Bumped per showCadParams so a slow design fetch for an old node is dropped. */
let _showSeq = 0;

function toRow(name: string, p: CadParameter, value: number | string): CadParamRow {
  if (p.type === "color") return { name, label: p.label || name, kind: "color", value, hasRange: false };
  const hasRange = typeof p.min === "number" && typeof p.max === "number";
  return {
    name, label: p.label || name, kind: "length", value,
    ...(typeof p.min === "number" ? { min: p.min } : {}),
    ...(typeof p.max === "number" ? { max: p.max } : {}),
    hasRange,
  };
}

function currentValues(): CadParamValues {
  const s = cadParamsState();
  const edit = s.nodeId ? getCadParamEdit(s.nodeId) : undefined;
  return cadParamValues(edit?.design ?? _saved!);
}

function statusOf(nodeId: string): Pick<CadParamsState, "status" | "statusText"> {
  const edit = getCadParamEdit(nodeId);
  if (!edit) return { status: "saved", statusText: "Saved values" };
  if (edit.status === "rendering") return { status: "rendering", statusText: "Rebuilding…" };
  if (edit.status === "ok") return { status: "ok", statusText: "Preview up to date · not saved" };
  return { status: "error", statusText: edit.error || "CAD rendering failed." };
}

/** Re-reads rows, status and editability from the stores. */
function refresh(): void {
  const s = cadParamsState();
  if (!s.visible || !s.nodeId || !_saved) return;
  // A save moves the base on (cad-param-save → setCadParamBase).
  _saved = getCadParamBase(s.nodeId) ?? _saved;
  const values = currentValues();
  s.rows = _names.map((n) => toRow(n, _saved!.parameters[n], values[n]));
  s.editable = isEditing() && !s.blocked;
  s.hint = s.blocked ? "" : isEditing() ? "" : VIEW_HINT;
  Object.assign(s, s.blocked ? { status: "error", statusText: NEWER_RUNTIME } : statusOf(s.nodeId));
}

/**
 * Shows the section for a node when it is a CAD part whose design resolves.
 * @remarks Hidden (and a console warning) when the design can't be read.
 */
export async function showCadParams(nodeId: string): Promise<void> {
  const seq = ++_showSeq;
  const manifest = getCurrentManifest() as any;
  const node = (manifest?.scene?.nodes || []).find((n: any) => n.node_id === nodeId);
  if (!manifest?.metadata?.cad || !node?.source?.cid) return hideCadParams();
  const design = getCadParamEdit(nodeId)?.savedDesign ?? (await resolveCadDesign(node.source.cid));
  if (seq !== _showSeq) return;
  if (!design) {
    console.warn(`[CAD-PARAMS] no design in source ${node.source.cid} | node=${nodeId}`);
    return hideCadParams();
  }
  const { usedParameterNames, guardScript, PRELUDE_NAMES } = await import("@arbesk/cad-gen");
  if (seq !== _showSeq) return;
  const used = usedParameterNames(design.code);
  const declared = Object.keys(design.parameters);
  _saved = design;
  _names = used.dynamic ? declared : declared.filter((n) => used.names.includes(n));
  setCadParamBase(nodeId, design);
  const s = cadParamsState();
  Object.assign(s, { visible: true, nodeId, blocked: !guardScript(design.code, PRELUDE_NAMES).ok });
  _committed = currentValues();
  _applied = _committed;
  _routes.clear();
  refresh();
}

export function hideCadParams(): void {
  _showSeq++;
  _saved = null;
  Object.assign(cadParamsState(), { visible: false, nodeId: null, rows: [] });
}

/** A row's raw input as a parameter value, clamped; null when unusable. */
function parseValue(name: string, raw: string, clamp: boolean): number | string | null {
  const p = _saved?.parameters[name];
  if (!p) return null;
  if (p.type === "color") return HEX_COLOR.test(raw) ? raw.toLowerCase() : null;
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (!clamp) return n;
  return Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, n));
}

function apply(values: CadParamValues): void {
  const s = cadParamsState();
  _applied = { ...currentValues(), ...values };
  setCadParamValues(s.nodeId!, _saved!, values);
  scheduleCadPreview(s.nodeId!);
  refresh();
}

/** Values moved by something other than the panel (an undo/redo): the baseline follows. */
function followExternalChange(): void {
  if (!_saved) return;
  const now = currentValues();
  if (Object.keys(now).some((k) => now[k] !== _applied[k])) {
    _committed = now;
    _applied = now;
  }
}

/** Pushes one undo entry from the last commit to now. */
function commitUndo(label: string): void {
  const after = currentValues();
  const before = _committed;
  _committed = after;
  const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
  if (changed.length === 0) return;
  const pick = (v: CadParamValues) => Object.fromEntries(changed.map((k) => [k, v[k]]));
  pushUndoEntry({
    type: "cad-params",
    label,
    items: [{ nodeId: cadParamsState().nodeId!, before: pick(before), after: pick(after) }],
  });
}

function canEdit(): boolean {
  const s = cadParamsState();
  return s.visible && s.editable && !!s.nodeId && !!_saved;
}

/** Per-channel tolerance when matching a shown colour to a parameter (8-bit rounding). */
const COLOR_TOLERANCE = 1;

function channels(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/**
 * The first colour parameter (table order) whose value is the part's colour.
 * @returns its name, or null when no colour parameter matches.
 */
// Unit-tested directly in test/frontend/cad-params-panel.test.js.
// fallow-ignore-next-line unused-export
export function colorParameterForPart(design: CadDesign, partColor: string | undefined): string | null {
  if (!partColor || !HEX_COLOR.test(partColor)) return null;
  const want = channels(partColor.toLowerCase());
  for (const [name, p] of Object.entries(design.parameters)) {
    if (p.type !== "color") continue;
    const have = channels(p.value);
    if (have.every((c, i) => Math.abs(c - want[i]) <= COLOR_TOLERANCE)) return name;
  }
  return null;
}

/**
 * The colour parameter behind a part, matched once per shown node.
 * @remarks A rendered edit's part colours describe its current design; before
 *   any render, the part shows the saved design's colours.
 */
function routeFor(nodeId: string, meshName: string, shownColor: string | undefined): string | null {
  if (_routes.has(meshName)) return _routes.get(meshName)!;
  const edit = getCadParamEdit(nodeId);
  const index = cadPartIndex(meshName);
  const rendered = index === null ? undefined : edit?.partColors?.[index];
  const name = rendered
    ? colorParameterForPart(edit!.design, rendered)
    : colorParameterForPart(edit?.savedDesign ?? _saved!, shownColor);
  _routes.set(meshName, name);
  return name;
}

/**
 * Sends a Studio part-colour edit to the part's colour parameter.
 * @param shownColor - the colour the part showed when the Inspector opened
 * @param commit - true at the end of the gesture (change): pushes the undo entry
 * @returns true when handled; false leaves the edit to the source-colour bake.
 */
export function routeCadPartColor(
  nodeId: string, meshName: string, shownColor: string | undefined, hex: string, commit = false,
): boolean {
  const s = cadParamsState();
  if (s.nodeId !== nodeId || !canEdit()) return false;
  const name = routeFor(nodeId, meshName, shownColor);
  const value = name ? parseValue(name, hex, true) : null;
  if (!name || value === null) return false;
  apply({ [name]: value });
  if (commit) commitUndo("Colour");
  return true;
}

/** The section component (x-data="cadParamsPanel"). */
// Consumed by the Pug x-data attribute (via registerAlpineComponent) and the
// panel tests, neither of which the fallow graph can see.
// fallow-ignore-next-line unused-export
export function cadParamsPanel() {
  return {
    get visible() { return cadParamsState().visible; },
    get rows() { return cadParamsState().rows; },
    get editable() { return cadParamsState().editable; },
    get hint() { return cadParamsState().hint; },
    get status() { return cadParamsState().status; },
    get statusText() { return cadParamsState().statusText; },
    get canReset() { return canEdit() && !!getCadParamEdit(cadParamsState().nodeId!); },
    /** Live typing / dragging: preview, no undo entry, no clamping of typed text. */
    onInput(name: string, raw: string) {
      if (!canEdit()) return;
      const value = parseValue(name, raw, false);
      if (value !== null) apply({ [name]: value });
    },
    /** A finished edit (change event): clamp, preview, one undo entry. */
    onCommit(name: string, raw: string) {
      if (!canEdit()) return;
      const value = parseValue(name, raw, true);
      if (value === null) return refresh();
      apply({ [name]: value });
      commitUndo("Parameter");
    },
    reset() {
      if (!canEdit()) return;
      apply(cadParamValues(_saved!));
      commitUndo("Reset parameters");
    },
  };
}
registerAlpineComponent("cadParamsPanel", cadParamsPanel);

on(EVENTS.CAD_PARAMS_CHANGED, (e: any) => {
  if (!e?.nodeId || e.nodeId !== cadParamsState().nodeId) return;
  followExternalChange();
  refresh();
});
subscribeEditMode(refresh);
