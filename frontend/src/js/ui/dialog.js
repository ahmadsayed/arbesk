/**
 * Arbesk Dialog Utility — Alpine.js component
 *
 * GNOME HIG-styled modal dialog that replaces browser prompt().
 * Uses the popover surface tokens, backdrop blur, and
 * keyboard-accessible focus trap (Escape to cancel, Enter to confirm).
 *
 * The DOM lives in app.pug (#appDialogHost fragment, `x-data="dialog"`).
 * Reactive state lives in an Alpine.store so template expressions and the
 * imperative show*() entry points mutate the same reactive proxy. The host
 * shows one dialog at a time: show*() calls that arrive while a dialog is
 * open are parked in a FIFO queue and opened after the current one resolves
 * (each caller's promise resolves with its own dialog's result).
 *
 * Usage:
 *   import { showDialog } from "./ui/dialog.js";
 *   const result = await showDialog("Name your asset", "Enter a name:", "My Asset");
 *   if (result === null) { /&#42; cancelled &#42;/ }
 */

import { Alpine, registerAlpineComponent } from "./alpine.js";

/**
 * @typedef {object} DialogState
 * @property {boolean} open
 * @property {""|"prompt"|"confirm"|"info"|"checkbox"|"custom"|"burn"} kind
 * @property {string} title
 * @property {string} body - plain-text instructional line (escaped via x-text)
 * @property {string} bodyHtml - trusted HTML body (info dialogs only)
 * @property {string} inputValue
 * @property {string} placeholder
 * @property {Array<{text: string, value: string, className: string}>} buttons
 * @property {Array<{value: string, label: string, checked: boolean, countsTowardMax: boolean}>} options
 * @property {number} max - max selectable checkboxes that count toward the cap
 * @property {string} collectionName
 * @property {string} titleId - id of the .dialog-title element (aria-labelledby)
 */

/**
 * @typedef {object} DialogSpec
 * @property {"prompt"|"confirm"|"info"|"checkbox"|"custom"|"burn"} kind
 * @property {string} title
 * @property {string} [body]
 * @property {string} [bodyHtml]
 * @property {string} [inputValue]
 * @property {string} [placeholder]
 * @property {Array<{text: string, value: string, className: string}>} [buttons]
 * @property {Array<{value: string, label: string, checked: boolean, countsTowardMax: boolean}>} [options]
 * @property {number} [max]
 * @property {string} [collectionName]
 * @property {HTMLElement} [bodyEl] - caller-supplied body (custom dialogs)
 */

/** @type {DialogState|null} reactive Alpine.store proxy */
let _state = null;

/**
 * Get (or lazily create) the reactive dialog state store.
 * @returns {DialogState}
 */
function state() {
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
    _state = /** @type {DialogState} */ (Alpine.store("dialog"));
  }
  return /** @type {DialogState} */ (_state);
}

// ── Non-template plumbing (module-level, never in the store) ────────────────
// The store is deeply reactive: DOM nodes stored there would be proxied and
// fail DOM brand checks (appendChild etc.), so the caller body element, the
// pending resolver, and the focus-trap teardown stay module-level.

/** @type {((value: any) => void)|null} resolver of the currently open dialog */
let _resolve = null;
/** @type {(() => void)|null} focus-trap deactivate fn for the open dialog */
let _removeTrap = null;
/** @type {HTMLElement|null} caller-supplied body of the open custom dialog */
let _customBodyEl = null;
/** Monotonic id invalidating pending post-render work of superseded dialogs. */
let _openSeq = 0;
/** @type {Array<() => void>} parked open requests (FIFO) */
const _queue = [];

// ── Shared infrastructure ────────────────────────────────────────────────────

/**
 * @param {Element} dialog
 * @param {Element|null} [initialFocusEl]
 */
function _trapFocus(dialog, initialFocusEl) {
  const trap = /** @type {any} */ (window).focusTrap.createFocusTrap(dialog, {
    initialFocus: initialFocusEl,
    escapeDeactivates: false, // Escape is handled by the global keydown listener
    allowOutsideClick: true, // lets MetaMask overlays receive clicks without breaking the trap
  });
  trap.activate();
  return () => trap.deactivate();
}

/**
 * Run `fn` after Alpine has flushed the x-if insertion into the DOM.
 * @param {() => void} fn
 */
function _afterRender(fn) {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => fn());
  } else {
    queueMicrotask(() => queueMicrotask(fn));
  }
}

/**
 * The element that receives initial focus for a dialog kind, matching the
 * pre-Alpine implementation: input (prompt/burn), first action button
 * (confirm), close button (info/custom), confirm button (checkbox).
 * @param {DialogSpec["kind"]} kind
 * @param {Element} dialogEl
 * @returns {Element|null}
 */
function _initialFocusEl(kind, dialogEl) {
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
 * @param {KeyboardEvent} e
 */
function _onGlobalKey(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    _close(null);
  }
}

/**
 * Populate the store from `spec`, flip the host open, and schedule the focus
 * trap for after Alpine inserts the dialog DOM.
 * @param {DialogSpec} spec
 * @param {(value: any) => void} resolve
 */
function _open(spec, resolve) {
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
    /** @type {any} */ (_customBodyEl).closeDialog = _close;
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
        /** @type {Error} */ (err)
      );
    }
  });
}

/**
 * Close the open dialog, resolving its promise exactly once (resolve-once
 * guard: a second Escape/Close/backdrop click is a no-op). Deactivates the
 * focus trap before the dialog leaves the DOM, then drains the FIFO queue.
 * @param {any} value
 */
function _close(value) {
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
 * @param {() => void} openRequest
 */
function _enqueue(openRequest) {
  _queue.push(openRequest);
  _drainQueue();
}

/** Open the next parked request when no dialog is open. */
function _drainQueue() {
  if (state().open || _queue.length === 0) return;
  const next = _queue.shift();
  if (next) next();
}

/**
 * Open a dialog for `spec`, preserving the legacy error contract: log with a
 * [DIALOG] prefix and resolve with `errorValue` instead of throwing.
 * @param {DialogSpec} spec
 * @param {(value: any) => void} resolve
 * @param {string} errorLabel - e.g. "dialog", "confirm dialog"
 * @param {any} [errorValue=null]
 */
function _openGuarded(spec, resolve, errorLabel, errorValue = null) {
  try {
    _open(spec, resolve);
  } catch (err) {
    console.error(
      `[DIALOG] error creating ${errorLabel}:`,
      /** @type {Error} */ (err)
    );
    resolve(errorValue);
    _drainQueue();
  }
}

// ── Component factory (template-facing) ─────────────────────────────────────

/**
 * Alpine data factory for the shared dialog host (`x-data="dialog"`).
 * Getters read the reactive store, so Alpine effects track them; methods
 * delegate to the module functions above.
 * @returns {object}
 */
export function dialog() {
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

    /** @param {any} value */
    closeWithValue(value) {
      _close(value);
    },

    /** Prompt confirm: read the live input (trimmed; blank resolves null). */
    confirm() {
      const input = /** @type {HTMLInputElement|null} */ (
        document.querySelector("#appDialogHost .dialog-input")
      );
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
     * @param {{checked: boolean, countsTowardMax: boolean}} opt
     * @param {Event} event
     */
    onOptionToggle(opt, event) {
      const s = state();
      const input = /** @type {HTMLInputElement} */ (event.target);
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

    /** @param {string} value */
    onBurnInput(value) {
      state().inputValue = value;
    },

    /** Burn confirm via Enter, only while the burn button would be enabled. */
    /** @param {KeyboardEvent} event */
    onBurnEnter(event) {
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
 * Create and show a GNOME HIG-styled dialog.
 *
 * @param {string} title    - Dialog heading
 * @param {string} body     - Instructional text above the input
 * @param {string} [defaultValue=""] - Pre-filled input value
 * @returns {Promise<string|null>} User input or null if cancelled
 */
export function showDialog(title, body, defaultValue = "") {
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
 * Show a confirmation-style dialog with custom buttons.
 *
 * Replaces the input prompt with one or more action buttons.
 *
 * @param {string} title
 * @param {string} body
 * @param {Array<{text: string, value: string, className?: string}>} [buttons=[]]
 * @returns {Promise<string|null>} The `value` of the clicked button, or null if cancelled.
 */
export function showConfirmDialog(title, body, buttons = []) {
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
 * Ask the user whether to fork (copy) or create a live reference to
 * another collection's asset. Fork freezes the CID at copy time;
 * live-ref points back to the original collection and auto-updates.
 *
 * @param {string} assetID
 * @param {{allowLiveRef?: boolean}} [options] - allowLiveRef: false hides the
 *   live-reference button (used when the drop targets the asset itself, where
 *   a live-ref would be a guaranteed cycle).
 * @returns {Promise<"fork"|"live-ref"|null>}
 */
export function showForkOrLiveRefDialog(assetID, { allowLiveRef = true } = {}) {
  if (!allowLiveRef) {
    return /** @type {Promise<"fork"|"live-ref"|null>} */ (showConfirmDialog(
      "Link Asset",
      `"${assetID}" is the asset currently open, so it can only be added as a frozen copy - a live reference to itself would loop forever.`,
      [{ text: "Fork (copy)", value: "fork", className: "btn btn-primary" }]
    ));
  }
  return /** @type {Promise<"fork"|"live-ref"|null>} */ (showConfirmDialog(
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
  ));
}

/**
 * Show a read-only informational dialog with trusted internal HTML content.
 * Do NOT pass user-supplied strings as bodyHtml - use showConfirmDialog for that.
 *
 * @param {string} title
 * @param {string} bodyHtml  - Trusted HTML string (no user content)
 * @returns {Promise<void>}
 */
export function showInfoDialog(title, bodyHtml) {
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
 * Show a dialog with a checkbox group and Confirm/Cancel actions.
 *
 * @param {string} title
 * @param {string} body - instructional text (plain text, escaped)
 * @param {Array<{value: string, label: string, checked?: boolean, countsTowardMax?: boolean}>} options
 * @param {{max?: number}} [opts] - max selectable; extra checks are refused
 * @returns {Promise<string[]|null>} selected values, or null if cancelled
 */
export function showCheckboxDialog(title, body, options, { max = Infinity } = {}) {
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
 * Show a dialog whose body is a caller-supplied DOM element.
 *
 * Useful when the body needs its own internal state and event handling.
 * The dialog resolves with `null` when closed via the Close button, Escape,
 * or a backdrop click. A body-internal action button can instead close the
 * dialog early with a value by calling `bodyEl.closeDialog(value)` (attached
 * before the dialog opens; idempotent — a later Close/Escape is a no-op).
 *
 * @param {string} title
 * @param {HTMLElement} bodyEl
 * @returns {Promise<*>} the value passed to bodyEl.closeDialog, or null
 */
export function showCustomDialog(title, bodyEl) {
  return new Promise((resolve) => {
    _enqueue(() =>
      _openGuarded({ kind: "custom", title, bodyEl }, resolve, "custom dialog")
    );
  });
}

/**
 * Show a destructive confirmation dialog that requires typing the collection
 * name before the burn button is enabled.
 *
 * @param {string} collectionName
 * @returns {Promise<"burn"|null>} "burn" if confirmed, null if cancelled.
 */
export function showBurnCollectionDialog(collectionName) {
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
