/**
 * Live preview of CAD parameter edits: debounced worker renders whose 3MF
 * replaces the node's meshes in the viewport.
 * @remarks At most one worker render runs at a time (each one loads the
 *   Manifold WASM). A render whose design was superseded while it ran is
 *   dropped, and the node renders again with the newest values. Reverting to
 *   the saved values reloads the stored model.
 */
import type { CadDesign } from "@arbesk/cad-gen";
import { getCurrentManifest } from "@arbesk/asset-core/domain/asset.js";
import { renderCadDesignInWorker } from "./cad-render.ts";
import { reloadNodeModel, replaceNodeModelFromBytes } from "../engine/scene-loader.ts";
import type { AssetSourceRef } from "../engine/scene-loader.ts";
import { registerUndoApplier } from "../engine/undo-controller.ts";
import {
  getCadParamEdit,
  markCadParamFailed,
  markCadParamRendered,
  setCadParamValues,
} from "../state/cad-param-edits.ts";

const CAD_PREVIEW_DEBOUNCE_MS = 300;

const _timers = new Map<string, ReturnType<typeof setTimeout>>();
const _dirty = new Set<string>();
/** Nodes whose viewport shows a preview rather than the stored model. */
const _previewed = new Set<string>();
/** The saved design per node, for undo entries applied after the edit is gone. */
const _bases = new Map<string, CadDesign>();
let _inFlight: Promise<void> | null = null;

/** Records the saved design a node's edits start from. */
export function setCadParamBase(nodeId: string, design: CadDesign): void {
  _bases.set(nodeId, design);
}

export function getCadParamBase(nodeId: string): CadDesign | undefined {
  return _bases.get(nodeId);
}

function sourceOf(nodeId: string): AssetSourceRef | null {
  const manifest = getCurrentManifest() as any;
  const node = (manifest?.scene?.nodes || []).find((n: any) => n.node_id === nodeId);
  return node?.source?.cid ? node.source : null;
}

async function restoreStored(nodeId: string): Promise<void> {
  const source = sourceOf(nodeId);
  if (_previewed.delete(nodeId) && source) await reloadNodeModel(nodeId, source);
}

async function renderOne(nodeId: string): Promise<void> {
  const edit = getCadParamEdit(nodeId);
  if (!edit) return restoreStored(nodeId);
  const design = edit.design;
  const current = () => getCadParamEdit(nodeId)?.design === design;
  try {
    const result: any = await renderCadDesignInWorker(design, {});
    if (!current()) return;
    markCadParamRendered(nodeId, { bytes: result.bytes, stats: result.stats, partColors: result.partColors });
    const source = sourceOf(nodeId);
    if (source && (await replaceNodeModelFromBytes(nodeId, source, result.bytes))) _previewed.add(nodeId);
  } catch (err) {
    if (!current()) return;
    const e = err as { code?: string; message?: string };
    markCadParamFailed(nodeId, e.code ?? "CAD_KERNEL_FAILED", e.message ?? "CAD rendering failed.");
  }
}

function pump(): void {
  if (_inFlight) return;
  const nodeId = _dirty.values().next().value;
  if (nodeId === undefined) return;
  _dirty.delete(nodeId);
  _inFlight = renderOne(nodeId).finally(() => {
    _inFlight = null;
    pump();
  });
}

/** Renders the node's current edit after a pause in changes. */
export function scheduleCadPreview(nodeId: string): void {
  clearTimeout(_timers.get(nodeId));
  _timers.set(nodeId, setTimeout(() => {
    _timers.delete(nodeId);
    _dirty.add(nodeId);
    pump();
  }, CAD_PREVIEW_DEBOUNCE_MS));
}

/** Runs any debounced render now and resolves once no render is queued or running. */
export async function whenCadPreviewsSettled(): Promise<void> {
  for (const [nodeId, timer] of _timers) {
    clearTimeout(timer);
    _dirty.add(nodeId);
  }
  _timers.clear();
  pump();
  while (_inFlight) await _inFlight;
}

registerUndoApplier("cad-params", (item, direction) => {
  const base = _bases.get(item.nodeId);
  if (!base) return;
  setCadParamValues(item.nodeId, base, direction === "before" ? item.before : item.after);
  scheduleCadPreview(item.nodeId);
});
