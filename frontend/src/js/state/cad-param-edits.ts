/**
 * Pending CAD parameter edits: the values a user changed in the Inspector's
 * Parameters section, and the last preview render of them.
 * @remarks One entry per edited node. An entry whose values equal the saved
 *   design is dropped, so "edited back" is not unsaved. Save
 *   (manifest-builder → applyCadParameterEdits) uploads `bytes`, which is why
 *   it requires `status === "ok"`.
 */
import type { CadDesign, CadParameter, CadStats } from "@arbesk/cad-gen";
import { emit, on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { notifyPendingEditsChanged, registerPendingSource } from "./unsaved-changes.ts";

export type CadParamValues = Record<string, number | string>;

export interface CadParamEdit {
  nodeId: string;
  savedDesign: CadDesign;
  design: CadDesign;
  /** The 3MF of the last successful render of `design`; null until one lands. */
  bytes: Uint8Array | null;
  stats: CadStats | null;
  /** Per-part color() tags from that render, in part order. */
  partColors?: (string | undefined)[];
  status: "rendering" | "ok" | "error";
  error?: string;
  errorCode?: string;
}

const _edits = new Map<string, CadParamEdit>();

registerPendingSource(() => _edits.size > 0);
// A new scene (open, new, time travel) invalidates every pending edit.
on(EVENTS.SCENE_CLEARED, () => clearCadParamEdits());

function changed(nodeId: string): void {
  notifyPendingEditsChanged();
  emit(EVENTS.CAD_PARAMS_CHANGED, { nodeId });
}

/** Every parameter value of a design, by name. */
export function cadParamValues(design: CadDesign): CadParamValues {
  const values: CadParamValues = {};
  for (const [name, p] of Object.entries(design.parameters)) values[name] = p.value;
  return values;
}

function withValues(design: CadDesign, values: CadParamValues): CadDesign {
  const parameters: Record<string, CadParameter> = {};
  for (const [name, p] of Object.entries(design.parameters)) {
    parameters[name] = name in values ? ({ ...p, value: values[name] } as CadParameter) : p;
  }
  return { ...design, parameters };
}

function sameValues(a: CadParamValues, b: CadParamValues): boolean {
  return Object.keys(a).every((k) => a[k] === b[k]);
}

export function getCadParamEdit(nodeId: string): CadParamEdit | undefined {
  return _edits.get(nodeId);
}

export function getPendingCadParamEdits(): Map<string, CadParamEdit> {
  return _edits;
}

/**
 * Applies changed values (a subset is fine) on top of the node's current edit.
 * @returns the new entry, or undefined when the values are back to saved.
 */
export function setCadParamValues(
  nodeId: string,
  savedDesign: CadDesign,
  values: CadParamValues,
): CadParamEdit | undefined {
  const current = _edits.get(nodeId);
  const from = current && current.savedDesign === savedDesign ? current.design : savedDesign;
  const design = withValues(from, values);
  if (sameValues(cadParamValues(design), cadParamValues(savedDesign))) {
    _edits.delete(nodeId);
    changed(nodeId);
    return undefined;
  }
  const edit: CadParamEdit = { nodeId, savedDesign, design, bytes: null, stats: null, status: "rendering" };
  _edits.set(nodeId, edit);
  changed(nodeId);
  return edit;
}

/** Records a successful render of the edit's current design. */
export function markCadParamRendered(
  nodeId: string,
  result: { bytes: Uint8Array; stats: CadStats; partColors?: (string | undefined)[] },
): void {
  const edit = _edits.get(nodeId);
  if (!edit) return;
  Object.assign(edit, { ...result, status: "ok", error: undefined, errorCode: undefined });
  changed(nodeId);
}

/** Records a failed render; the last good preview stays in the viewport. */
export function markCadParamFailed(nodeId: string, errorCode: string, error: string): void {
  const edit = _edits.get(nodeId);
  if (!edit) return;
  Object.assign(edit, { status: "error", errorCode, error });
  changed(nodeId);
}

/** Drops the edits of the given nodes, or of every node. */
export function clearCadParamEdits(nodeIds?: string[]): void {
  const ids = nodeIds ?? [..._edits.keys()];
  for (const id of ids) _edits.delete(id);
  if (ids.length > 0) {
    notifyPendingEditsChanged();
    for (const id of ids) emit(EVENTS.CAD_PARAMS_CHANGED, { nodeId: id });
  }
}

/**
 * The 0-based CAD part a viewer mesh name stands for.
 * @remarks The CAD exporter numbers objects 1..n in part order and names them
 *   part-n when there are several; to-gltf names an unnamed object's mesh
 *   object_<id> and its node item_<i>.
 */
export function cadPartIndex(meshName: string): number | null {
  const m = /^(?:part-|object_)(\d+)$/.exec(meshName);
  if (m) return Number(m[1]) - 1;
  const item = /^item_(\d+)$/.exec(meshName);
  return item ? Number(item[1]) : null;
}
