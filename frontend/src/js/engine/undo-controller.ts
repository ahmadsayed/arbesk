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

import { on, emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { MOD } from "../utils/platform.ts";
import { state } from "./state.ts";
import { applyTransformMatrix, stageNodeTransform } from "./transforms.ts";
import {
  popUndoEntry,
  popRedoEntry,
  canUndo,
  canRedo,
  peekUndoLabel,
  peekRedoLabel,
  clearUndoStacks,
  onUndoStackChange,
} from "./undo-stack.ts";
import type { UndoItem, UndoEntry } from "./undo-stack.ts";

type UndoDirection = "before" | "after";
type UndoApplier = (item: UndoItem, direction: UndoDirection) => void;

const _appliers = new Map<string, UndoApplier>();

/**
 * Register the applier for one entry type. Called per item with the direction
 * being applied ("before" for undo, "after" for redo).
 *
 * @param type - e.g. "transform", "color"
 */
export function registerUndoApplier(type: string, applier: UndoApplier) {
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

function _applyEntry(entry: UndoEntry, direction: UndoDirection) {
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

// ── Toolbar button state (buttons live in ui/transform-gizmo.ts) ──
function _syncToolbarButtons() {
  const undoBtn = document.getElementById("undoBtn") as HTMLButtonElement | null;
  if (undoBtn) {
    undoBtn.disabled = !canUndo();
    const label = peekUndoLabel();
    undoBtn.title = label ? `Undo ${label} (${MOD}+Z)` : "Nothing to undo";
  }
  const redoBtn = document.getElementById("redoBtn") as HTMLButtonElement | null;
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

/**
 * Decide whether a Ctrl/Cmd+Z / Ctrl/Cmd+Y keydown should trigger undo/redo.
 * Returns null when the key is not z/y or the focus is in a text-editing
 * context (a color input is the one exception — undo is allowed there).
 * @param {string} key - lowercased key
 * @param {boolean} shiftKey
 * @param {HTMLElement|null} activeEl
 */
function resolveUndoKeydown(
  key: string,
  shiftKey: boolean,
  activeEl: HTMLElement | null,
): { wantsRedo: boolean } | null {
  if (key !== "z" && key !== "y") return null;
  const tag = activeEl?.tagName?.toLowerCase();
  // Allow undo when a color input is focused; block for text fields.
  const isColorInput =
    tag === "input" && (activeEl as HTMLInputElement).type === "color";
  if (!isColorInput) {
    const editing =
      activeEl?.isContentEditable ||
      tag === "textarea" ||
      tag === "select" ||
      tag === "input";
    if (editing) return null;
  }
  const wantsRedo = (key === "z" && shiftKey) || key === "y";
  return { wantsRedo };
}

// Single Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y dispatcher.
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const decision = resolveUndoKeydown(
    e.key.toLowerCase(),
    e.shiftKey,
    document.activeElement as HTMLElement | null,
  );
  if (!decision) return;
  if (decision.wantsRedo && !canRedo()) return;
  if (!decision.wantsRedo && !canUndo()) return;
  e.preventDefault();
  if (decision.wantsRedo) redo();
  else undo();
});
