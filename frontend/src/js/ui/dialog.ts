/**
 * Modal dialog that replaces browser prompt().
 * @remarks Reactive state lives in an Alpine.store so template expressions
 *   and the imperative show*() entry points mutate the same proxy. The host
 *   shows one dialog at a time: requests that arrive while one is open are
 *   parked in a FIFO queue and each caller's promise resolves with its own
 *   dialog's result.
 */

import { Alpine, registerAlpineComponent } from "./alpine.ts";

interface DialogButton {
  text: string;
  value: string;
  className: string;
}

interface DialogOption {
  value: string;
  label: string;
  checked: boolean;
  countsTowardMax: boolean;
}

interface DialogState {
  open: boolean;
  kind: "" | "prompt" | "confirm" | "info" | "checkbox" | "custom" | "burn";
  title: string;
  /** plain-text instructional line (escaped via x-text) */
  body: string;
  /** trusted HTML body (info dialogs only) */
  bodyHtml: string;
  inputValue: string;
  placeholder: string;
  buttons: DialogButton[];
  options: DialogOption[];
  /** max selectable checkboxes that count toward the cap */
  max: number;
  collectionName: string;
  /** id of the .dialog-title element (aria-labelledby) */
  titleId: string;
}

interface DialogSpec {
  kind: "prompt" | "confirm" | "info" | "checkbox" | "custom" | "burn";
  title: string;
  body?: string;
  bodyHtml?: string;
  inputValue?: string;
  placeholder?: string;
  buttons?: DialogButton[];
  options?: DialogOption[];
  max?: number;
  collectionName?: string;
  /** caller-supplied body (custom dialogs) */
  bodyEl?: HTMLElement;
}

/** reactive Alpine.store proxy */
let _state: DialogState | null = null;

/**
 * Get (or lazily create) the reactive dialog state store.
 */
function state(): DialogState {
  if (!_state) {
    // Alpine.store(name, value) is a setter (returns undefined); read it back.
    if (!Alpine.store("dialog")) {
      Alpine.store("dialog", {
        open: false,
        kind: "",
        title: "",
        body: "",
        bodyHtml: "",
        inputValue: "",
        placeholder: "",
        buttons: [],
        options: [],
        max: Infinity,
        collectionName: "",
        titleId: "",
      });
    }
    _state = Alpine.store("dialog") as DialogState;
  }
  return _state;
}

// ── Non-template plumbing (module-level, never in the store) ────────────────
// The store is deeply reactive: DOM nodes stored there would be proxied and
// fail DOM brand checks (appendChild etc.), so the caller body element, the
// pending resolver, and the focus-trap teardown stay module-level.

/** resolver of the currently open dialog */
let _resolve: ((value: any) => void) | null = null;
/** focus-trap deactivate fn for the open dialog */
let _removeTrap: (() => void) | null = null;
/** caller-supplied body of the open custom dialog */
let _customBodyEl: HTMLElement | null = null;
/** Monotonic id invalidating pending post-render work of superseded dialogs. */
let _openSeq = 0;
/** parked open requests (FIFO) */
const _queue: Array<() => void> = [];

// ── Shared infrastructure ────────────────────────────────────────────────────

function _trapFocus(dialog: Element, initialFocusEl?: Element | null): () => void {
  const trap = (window as any).focusTrap.createFocusTrap(dialog, {
    initialFocus: initialFocusEl,
    escapeDeactivates: false, // Escape is handled by the global keydown listener
    allowOutsideClick: true, // lets MetaMask overlays receive clicks without breaking the trap
  });
  trap.activate();
  return () => trap.deactivate();
}

/**
 * Run `fn` after Alpine has flushed the x-if insertion into the DOM.
 */
function _afterRender(fn: () => void): void {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => fn());
  } else {
    queueMicrotask(() => queueMicrotask(fn));
  }
}

/**
 * Returns the element that receives initial focus for a dialog kind.
 * @remarks Matches the pre-Alpine focus behavior.
 */
function _initialFocusEl(kind: DialogSpec["kind"], dialogEl: Element): Element | null {
  switch (kind) {
    case "prompt":
    case "burn":
      return dialogEl.querySelector(".dialog-input");
    case "confirm":
      return dialogEl.querySelector(".dialog-action-btn");
    case "checkbox":
      return dialogEl.querySelector(".dialog-confirm-btn");
    case "info":
    case "custom":
      return dialogEl.querySelector(".dialog-close-btn");
    default:
      return null;
  }
}

/**
 * Global Escape handler, bound while a dialog is open.
 */
function _onGlobalKey(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    e.preventDefault();
    _close(null);
  }
}

/**
 * Populate the store from `spec`, flip the host open, and schedule the focus
 * trap for after Alpine inserts the dialog DOM.
 */
function _open(spec: DialogSpec, resolve: (value: any) => void): void {
  if (!document.getElementById("appDialogHost")) {
    throw new Error("#appDialogHost is missing from the DOM");
  }
  const s = state();
  s.kind = spec.kind;
  s.title = spec.title;
  s.body = spec.body || "";
  s.bodyHtml = spec.bodyHtml || "";
  s.inputValue = spec.inputValue || "";
  s.placeholder = spec.placeholder || "";
  s.buttons = spec.buttons || [];
  s.options = spec.options || [];
  s.max = spec.max ?? Infinity;
  s.collectionName = spec.collectionName || "";
  s.titleId = "dialog-title-" + Date.now();
  _resolve = resolve;
  _customBodyEl = spec.bodyEl || null;
  if (_customBodyEl) {
    // Attach before the dialog opens so body-internal action buttons can
    // close it early with a value; _close's resolve-once guard keeps a later
    // Close/Escape a no-op.
    (_customBodyEl as any).closeDialog = _close;
  }
  document.addEventListener("keydown", _onGlobalKey);
  s.open = true;
  const seq = ++_openSeq;
  _afterRender(() => {
    if (seq !== _openSeq || !state().open) return; // superseded or already closed
    try {
      const dialogEl = document.querySelector("#appDialogHost .dialog");
      if (!dialogEl) return;
      if (spec.kind === "custom" && _customBodyEl) {
        dialogEl
          .querySelector("#appDialogCustomBody")
          ?.appendChild(_customBodyEl);
      }
      _removeTrap = _trapFocus(dialogEl, _initialFocusEl(spec.kind, dialogEl));
    } catch (err) {
      console.error(
        "[DIALOG] error activating focus trap:",
        err as Error
      );
    }
  });
}

/**
 * Closes the open dialog, resolving its promise exactly once.
 * @remarks A second Escape/Close/backdrop click is a no-op.
 */
function _close(value: any): void {
  const s = state();
  if (!s.open) return;
  const resolve = _resolve;
  _resolve = null;
  document.removeEventListener("keydown", _onGlobalKey);
  if (_removeTrap) {
    _removeTrap();
    _removeTrap = null;
  }
  if (_customBodyEl) {
    _customBodyEl.remove();
    _customBodyEl = null;
  }
  s.open = false;
  if (resolve) resolve(value);
  _drainQueue();
}

/**
 * Park an open request; it runs immediately when no dialog is open.
 */
function _enqueue(openRequest: () => void): void {
  _queue.push(openRequest);
  _drainQueue();
}

/** Open the next parked request when no dialog is open. */
function _drainQueue(): void {
  if (state().open || _queue.length === 0) return;
  const next = _queue.shift();
  if (next) next();
}

/**
 * Opens a dialog for `spec`.
 * @remarks Preserves the legacy error contract: logs with a [DIALOG] prefix
 *   and resolves with `errorValue` instead of throwing.
 */
function _openGuarded(
  spec: DialogSpec,
  resolve: (value: any) => void,
  errorLabel: string,
  errorValue: any = null
): void {
  try {
    _open(spec, resolve);
  } catch (err) {
    console.error(
      `[DIALOG] error creating ${errorLabel}:`,
      err as Error
    );
    resolve(errorValue);
    _drainQueue();
  }
}

// ── Component factory (template-facing) ─────────────────────────────────────

/** Alpine component object for the shared dialog host (`x-data="dialog"`). */
interface DialogComponent {
  readonly open: boolean;
  readonly kind: DialogState["kind"];
  readonly title: string;
  readonly body: string;
  readonly bodyHtml: string;
  readonly inputValue: string;
  readonly placeholder: string;
  readonly buttons: DialogButton[];
  readonly options: DialogOption[];
  readonly collectionName: string;
  readonly titleId: string;
  readonly burnEnabled: boolean;
  cancel(): void;
  closeWithValue(value: any): void;
  confirm(): void;
  confirmCheckbox(): void;
  onOptionToggle(
    opt: { checked: boolean; countsTowardMax: boolean },
    event: Event
  ): void;
  onBurnInput(value: string): void;
  onBurnEnter(event: KeyboardEvent): void;
}

/**
 * Alpine data factory for the shared dialog host.
 */
export function dialog(): DialogComponent {
  return {
    get open() {
      return state().open;
    },
    get kind() {
      return state().kind;
    },
    get title() {
      return state().title;
    },
    get body() {
      return state().body;
    },
    get bodyHtml() {
      return state().bodyHtml;
    },
    get inputValue() {
      return state().inputValue;
    },
    get placeholder() {
      return state().placeholder;
    },
    get buttons() {
      return state().buttons;
    },
    get options() {
      return state().options;
    },
    get collectionName() {
      return state().collectionName;
    },
    get titleId() {
      return state().titleId;
    },
    get burnEnabled() {
      const s = state();
      return s.inputValue.trim() === s.collectionName.trim();
    },

    cancel() {
      _close(null);
    },

    closeWithValue(value: any) {
      _close(value);
    },

    /** Prompt confirm: read the live input (trimmed; blank resolves null). */
    confirm() {
      const input = document.querySelector(
        "#appDialogHost .dialog-input"
      ) as HTMLInputElement | null;
      const raw = input ? input.value : state().inputValue;
      _close(raw.trim() || null);
    },

    /** Checkbox confirm: resolve with the checked values. */
    confirmCheckbox() {
      const selected = state()
        .options.filter((o) => o.checked)
        .map((o) => o.value);
      _close(selected);
    },

    /**
     * Checkbox toggle with max enforcement; options that don't count toward
     * the max (e.g. "in place") never consume slots.
     */
    onOptionToggle(
      opt: { checked: boolean; countsTowardMax: boolean },
      event: Event
    ) {
      const s = state();
      const input = event.target as HTMLInputElement;
      // Only options that count toward the max can be refused; toggles like
      // "in place" never consume slots.
      if (input.checked && opt.countsTowardMax) {
        const count = s.options.filter(
          (o) => o.checked && o.countsTowardMax
        ).length;
        if (count >= s.max) {
          input.checked = false;
          return;
        }
      }
      opt.checked = input.checked;
    },

    onBurnInput(value: string) {
      state().inputValue = value;
    },

    /** Burn confirm via Enter, only while the burn button would be enabled. */
    onBurnEnter(event: KeyboardEvent) {
      const s = state();
      if (s.inputValue.trim() === s.collectionName.trim()) {
        event.preventDefault();
        _close("burn");
      }
    },
  };
}

// ── Public exports ───────────────────────────────────────────────────────────

/**
 * Shows a prompt dialog.
 * @returns the user's input, or null if cancelled.
 */
export function showDialog(
  title: string,
  body: string,
  defaultValue = ""
): Promise<string | null> {
  return new Promise((resolve) => {
    _enqueue(() =>
      _openGuarded(
        { kind: "prompt", title, body, inputValue: defaultValue },
        resolve,
        "dialog"
      )
    );
  });
}

/**
 * Shows a confirmation dialog with custom buttons.
 * @returns the clicked button's value, or null if cancelled.
 */
export function showConfirmDialog(
  title: string,
  body: string,
  buttons: Array<{ text: string; value: string; className?: string }> = []
): Promise<string | null> {
  return new Promise((resolve) => {
    const normalized = (
      buttons.length
        ? buttons
        : [
            { text: "Cancel", value: "cancel" },
            { text: "Confirm", value: "confirm" },
          ]
    ).map((btn, idx) => ({
      text: btn.text,
      value: btn.value,
      className:
        btn.className || (idx === 0 ? "btn btn-secondary" : "btn btn-primary"),
    }));
    _enqueue(() =>
      _openGuarded(
        { kind: "confirm", title, body, buttons: normalized },
        resolve,
        "confirm dialog"
      )
    );
  });
}

/**
 * Asks whether to fork (copy) or live-reference another collection's asset.
 * @remarks Fork freezes the CID at copy time; live-ref points back to the
 *   original and auto-updates. allowLiveRef: false hides the live-ref button
 *   when the drop targets the asset itself, where a live-ref would cycle.
 */
export function showForkOrLiveRefDialog(
  assetID: string,
  { allowLiveRef = true }: { allowLiveRef?: boolean } = {}
): Promise<"fork" | "live-ref" | null> {
  if (!allowLiveRef) {
    return showConfirmDialog(
      "Link Asset",
      `"${assetID}" is the asset currently open, so it can only be added as a frozen copy - a live reference to itself would loop forever.`,
      [{ text: "Fork (copy)", value: "fork", className: "btn btn-primary" }]
    ) as Promise<"fork" | "live-ref" | null>;
  }
  return showConfirmDialog(
    "Link Asset",
    `How would you like to include "${assetID}" in your scene?`,
    [
      { text: "Fork (copy)", value: "fork", className: "btn btn-secondary" },
      {
        text: "Live reference",
        value: "live-ref",
        className: "btn btn-primary",
      },
    ]
  ) as Promise<"fork" | "live-ref" | null>;
}

/**
 * Shows a read-only info dialog with trusted HTML content.
 * @remarks Do not pass user-supplied strings as bodyHtml.
 */
export function showInfoDialog(title: string, bodyHtml: string): Promise<void> {
  return new Promise((resolve) => {
    _enqueue(() =>
      _openGuarded(
        { kind: "info", title, bodyHtml },
        resolve,
        "info dialog",
        undefined
      )
    );
  });
}

/**
 * Shows a dialog with a checkbox group and Confirm/Cancel actions.
 * @returns the selected values, or null if cancelled.
 */
export function showCheckboxDialog(
  title: string,
  body: string,
  options: Array<{
    value: string;
    label: string;
    checked?: boolean;
    countsTowardMax?: boolean;
  }>,
  { max = Infinity }: { max?: number } = {}
): Promise<string[] | null> {
  return new Promise((resolve) => {
    const normalized = options.map((opt) => ({
      value: opt.value,
      label: opt.label,
      checked: !!opt.checked,
      // Non-answer toggles (e.g. "in place") don't consume the max slots.
      countsTowardMax: opt.countsTowardMax !== false,
    }));
    _enqueue(() =>
      _openGuarded(
        { kind: "checkbox", title, body, options: normalized, max },
        resolve,
        "checkbox dialog"
      )
    );
  });
}

/**
 * Shows a dialog whose body is a caller-supplied DOM element.
 * @remarks Useful when the body needs its own state and event handling. The
 *   dialog resolves with null on Close/Escape/backdrop, or with a value passed
 *   to `bodyEl.closeDialog(value)`.
 */
export function showCustomDialog(title: string, bodyEl: HTMLElement): Promise<any> {
  return new Promise((resolve) => {
    _enqueue(() =>
      _openGuarded({ kind: "custom", title, bodyEl }, resolve, "custom dialog")
    );
  });
}

/**
 * Shows a destructive confirmation dialog that requires typing the collection
 * name before the burn button is enabled.
 * @returns "burn" if confirmed, otherwise null.
 */
export function showBurnCollectionDialog(
  collectionName: string
): Promise<"burn" | null> {
  return new Promise((resolve) => {
    _enqueue(() =>
      _openGuarded(
        { kind: "burn", title: "Burn Collection", collectionName, placeholder: collectionName },
        resolve,
        "burn dialog"
      )
    );
  });
}

// ── Registration ─────────────────────────────────────────────────────────────

registerAlpineComponent("dialog", dialog);
