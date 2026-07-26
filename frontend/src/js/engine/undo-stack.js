// @ts-nocheck
/**
 * Arbesk Undo Stack
 *
 * Headless, scene-agnostic undo/redo stacks shared by every Studio edit type
 * (transforms, parametric colors). Capture sites push one snapshot entry per
 * completed gesture; engine/undo-controller.js pops entries and applies them.
 * In-memory only — survives Save Draft/Publish, cleared on scene reload.
 */

/**
 * @typedef {Object} UndoItem
 * @property {string} nodeId
 * @property {string} [meshName] - color entries only
 * @property {*} before - transform: number[16] column-major matrix; color: hex string
 * @property {*} after
 *
 * @typedef {Object} UndoEntry
 * @property {'transform'|'color'} type
 * @property {string} label - human label for tooltips/logs ("Move", "Rotate", "Scale", "Color")
 * @property {UndoItem[]} items
 */

const MAX_UNDO = 50;

/** @type {UndoEntry[]} */
const undoStack = [];
/** @type {UndoEntry[]} */
const redoStack = [];
/** @type {Set<() => void>} */
const listeners = new Set();

function _notify() {
  for (const cb of listeners) cb();
}

/**
 * Push a completed edit. Clears the redo stack (standard invalidation).
 * @param {UndoEntry} entry - must not be mutated after push (stored by reference)
 */
export function pushUndoEntry(entry) {
  if (!entry || !Array.isArray(entry.items) || entry.items.length === 0) return;
  undoStack.push(entry);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
  _notify();
}

/** @returns {UndoEntry|null} entry to apply with direction "before" */
export function popUndoEntry() {
  const entry = undoStack.pop();
  if (!entry) return null;
  redoStack.push(entry);
  _notify();
  return entry;
}

/** @returns {UndoEntry|null} entry to apply with direction "after" */
export function popRedoEntry() {
  const entry = redoStack.pop();
  if (!entry) return null;
  undoStack.push(entry);
  _notify();
  return entry;
}

export function canUndo() {
  return undoStack.length > 0;
}

export function canRedo() {
  return redoStack.length > 0;
}

/** @returns {string|null} */
export function peekUndoLabel() {
  return undoStack.at(-1)?.label ?? null;
}

/** @returns {string|null} */
export function peekRedoLabel() {
  return redoStack.at(-1)?.label ?? null;
}

export function clearUndoStacks() {
  if (undoStack.length === 0 && redoStack.length === 0) return;
  undoStack.length = 0;
  redoStack.length = 0;
  _notify();
}

/**
 * @param {() => void} cb called after every stack mutation
 * @returns {() => void} unsubscribe
 */
export function onUndoStackChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
