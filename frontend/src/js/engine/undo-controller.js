/**
 * Arbesk Undo Controller
 *
 * Applies undo/redo entries from undo-stack.js to the live scene and owns the
 * single Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y keyboard dispatcher. Transform entries
 * are applied natively; other entry types (color) register an applier via
 * registerUndoApplier(). Stacks survive Save Draft/Publish and are cleared on
 * SCENE_CLEARED (scene load and time-travel jumps), which rebuilds the scene
 * from a manifest and invalidates every in-memory snapshot.
 */

import { on, emit, EVENTS } from "../events/bus.js";
import { MOD } from "../utils/platform.js";
import { state } from "./state.js";
import { applyTransformMatrix, stageNodeTransform } from "./transforms.js";
import {
  popUndoEntry,
  popRedoEntry,
  canUndo,
  canRedo,
  peekUndoLabel,
  peekRedoLabel,
  clearUndoStacks,
  onUndoStackChange,
} from "./undo-stack.js";

/** @typedef {import("./undo-stack.js").UndoItem} UndoApplierItem */

/** @type {Map<string, (item: UndoApplierItem, direction: 'before'|'after') => void>} */
const _appliers = new Map();

/**
 * Register the applier for one entry type. Called per item with the direction
 * being applied ("before" for undo, "after" for redo).
 *
 * @param {string} type - e.g. "transform", "color"
 * @param {(item: UndoApplierItem, direction: 'before'|'after') => void} applier
 */
export function registerUndoApplier(type, applier) {
  _appliers.set(type, applier);
}

// Transform entries: restore the matrix on the live anchor and re-stage it so
// Save writes the undone/redone state. Missing/disposed anchors are skipped.
registerUndoApplier("transform", (item, direction) => {
  const anchor = state.nodeAnchors.get(item.nodeId);
  if (!anchor || anchor.isDisposed()) return;
  applyTransformMatrix(anchor, direction === "before" ? item.before : item.after);
  stageNodeTransform(item.nodeId);
});

/**
 * @param {import("./undo-stack.js").UndoEntry} entry
 * @param {'before'|'after'} direction
 */
function _applyEntry(entry, direction) {
  const applier = _appliers.get(entry.type);
  if (!applier) return;
  for (const item of entry.items) applier(item, direction);
  if (entry.type === "transform") {
    // Refresh listeners (inspector scale fields) from the restored anchors.
    emit(EVENTS.TRANSFORM_STAGED, {
      nodeIds: entry.items.map((i) => i.nodeId),
    });
  }
}

export function undo() {
  if (state.isGizmoDragging) return;
  const entry = popUndoEntry();
  if (!entry) return;
  _applyEntry(entry, "before");
  console.log(`[UNDO] ${entry.label}`);
}

export function redo() {
  if (state.isGizmoDragging) return;
  const entry = popRedoEntry();
  if (!entry) return;
  _applyEntry(entry, "after");
  console.log(`[REDO] ${entry.label}`);
}

// ── Toolbar button state (buttons live in ui/transform-gizmo.js) ──
function _syncToolbarButtons() {
  const undoBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("undoBtn"));
  if (undoBtn) {
    undoBtn.disabled = !canUndo();
    const label = peekUndoLabel();
    undoBtn.title = label ? `Undo ${label} (${MOD}+Z)` : "Nothing to undo";
  }
  const redoBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("redoBtn"));
  if (redoBtn) {
    redoBtn.disabled = !canRedo();
    const label = peekRedoLabel();
    redoBtn.title = label
      ? `Redo ${label} (${MOD}+Shift+Z / ${MOD}+Y)`
      : "Nothing to redo";
  }
}
onUndoStackChange(_syncToolbarButtons);

// Scene reloads (open asset, time-travel via loadVersion -> clearScene)
// invalidate every snapshot.
on(EVENTS.SCENE_CLEARED, () => clearUndoStacks());

// Single Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y dispatcher.
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key !== "z" && key !== "y") return;
  const el = /** @type {HTMLElement|null} */ (document.activeElement);
  const tag = el?.tagName?.toLowerCase();
  // Allow undo when a color input is focused; block for text fields.
  const isColorInput =
    tag === "input" && /** @type {HTMLInputElement} */ (el).type === "color";
  if (!isColorInput) {
    const editing =
      el?.isContentEditable ||
      tag === "textarea" ||
      tag === "select" ||
      tag === "input";
    if (editing) return;
  }
  const wantsRedo = (key === "z" && e.shiftKey) || key === "y";
  if (wantsRedo && !canRedo()) return;
  if (!wantsRedo && !canUndo()) return;
  e.preventDefault();
  if (wantsRedo) redo();
  else undo();
});
