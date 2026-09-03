/**
 * Headless, scene-agnostic undo/redo stacks for every Studio edit type.
 * @remarks In-memory only — survives Save Draft/Publish, cleared on scene
 *   reload.
 */

export interface UndoItem {
  nodeId: string;
  /** color entries only */
  meshName?: string;
  /** transform: number[16] column-major matrix; color: hex string */
  before: any;
  after: any;
}

export interface UndoEntry {
  type: "transform" | "color" | "child_ref";
  /** human label for tooltips/logs ("Move", "Rotate", "Scale", "Color") */
  label: string;
  items: UndoItem[];
}

const MAX_UNDO = 50;

const undoStack: UndoEntry[] = [];
const redoStack: UndoEntry[] = [];
const listeners = new Set<() => void>();

function _notify() {
  for (const cb of listeners) cb();
}

/**
 * Pushes a completed edit.
 * @remarks Clears the redo stack, and the entry must not be mutated after
 *   push (it is stored by reference).
 */
export function pushUndoEntry(entry: UndoEntry) {
  if (!entry || !Array.isArray(entry.items) || entry.items.length === 0) return;
  undoStack.push(entry);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
  _notify();
}

/** Returns the entry to apply with direction "before". */
export function popUndoEntry(): UndoEntry | null {
  const entry = undoStack.pop();
  if (!entry) return null;
  redoStack.push(entry);
  _notify();
  return entry;
}

/** Returns the entry to apply with direction "after". */
export function popRedoEntry(): UndoEntry | null {
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

export function peekUndoLabel(): string | null {
  return undoStack.at(-1)?.label ?? null;
}

export function peekRedoLabel(): string | null {
  return redoStack.at(-1)?.label ?? null;
}

export function clearUndoStacks() {
  if (undoStack.length === 0 && redoStack.length === 0) return;
  undoStack.length = 0;
  redoStack.length = 0;
  _notify();
}

/**
 * @remarks cb is called after every stack mutation.
 * @returns unsubscribe function.
 */
export function onUndoStackChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
