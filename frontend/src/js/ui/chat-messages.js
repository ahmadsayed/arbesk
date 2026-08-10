/**
 * Chat message builders for the AI Generation pane.
 *
 * addChatMessage renders plain text bubbles (user/system). addAssetMessage
 * renders a rich bubble for a generation result: a live 3D preview canvas,
 * the prompt caption, and a "Show in Studio" action. The bubble's lifecycle
 * mirrors the pending-generation record: while pending it can show a live
 * preview (or a static fallback), and once sent it collapses to a snapshot
 * image. The preview is orbit-only — the button is the sole way a model
 * enters the Studio, and it stays live after sending so re-clicking it
 * restores that version.
 */

const chatHistoryList = document.getElementById("chatHistoryList");

function hideWelcome() {
  const welcome = /** @type {HTMLElement | null} */ (
    chatHistoryList?.querySelector(".chat-welcome")
  );
  if (welcome) welcome.hidden = true;
}

/**
 * @param {HTMLElement} bubble
 */
function appendBubble(bubble) {
  if (!chatHistoryList) return;
  chatHistoryList.appendChild(bubble);
  chatHistoryList.scrollTop = chatHistoryList.scrollHeight;
}

/**
 * @param {Date} [date]
 * @returns {HTMLElement}
 */
function buildTimestamp(date = new Date()) {
  const time = document.createElement("time");
  time.className = "chat-bubble-time";
  time.dateTime = date.toISOString();
  time.textContent = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return time;
}

/**
 * Append a plain text chat message.
 * @param {"user"|"system"} role
 * @param {string} text
 * @param {Object} [options]
 * @param {Date} [options.timestamp] - defaults to now
 * @param {string} [options.extraClass] - extra CSS class on the bubble
 */
export function addChatMessage(role, text, options = {}) {
  if (!chatHistoryList) return;
  hideWelcome();

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble chat-bubble-${role}${options.extraClass ? ` ${options.extraClass}` : ""}`;

  const content = document.createElement("span");
  content.className = "chat-bubble-content";
  content.textContent = text;
  bubble.appendChild(content);

  bubble.appendChild(buildTimestamp(options.timestamp));
  appendBubble(bubble);
}

/**
 * Append a chat message containing an image (e.g. a reference photo attached
 * for image-to-3D), with an optional caption below it. When `options.images`
 * is given (multiview), the bubble renders a 2-column thumbnail grid with a
 * small view caption under each thumb instead of the single image.
 * @param {"user"|"system"} role
 * @param {string} src - image URL or data URI (single-image mode)
 * @param {string} [caption]
 * @param {Object} [options]
 * @param {Date} [options.timestamp] - defaults to now
 * @param {Array<{src: string, caption?: string}>} [options.images] - multiview thumbnails
 */
export function addImageMessage(role, src, caption, options = {}) {
  if (!chatHistoryList) return;
  hideWelcome();

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble chat-bubble-${role} chat-bubble-image`;

  if (Array.isArray(options.images) && options.images.length > 0) {
    const grid = document.createElement("div");
    grid.className = "chat-image-grid";
    for (const entry of options.images) {
      const cell = document.createElement("figure");
      cell.className = "chat-image-cell";
      const img = document.createElement("img");
      img.className = "chat-image-thumb";
      img.src = entry.src;
      img.alt = entry.caption || caption || "Attached image";
      cell.appendChild(img);
      if (entry.caption) {
        const viewCaption = document.createElement("figcaption");
        viewCaption.className = "chat-image-view";
        viewCaption.textContent = entry.caption;
        cell.appendChild(viewCaption);
      }
      grid.appendChild(cell);
    }
    bubble.appendChild(grid);
  } else {
    const img = document.createElement("img");
    img.className = "chat-image-thumb";
    img.src = src;
    img.alt = caption || "Attached image";
    bubble.appendChild(img);
  }

  if (caption) {
    const content = document.createElement("span");
    content.className = "chat-bubble-content";
    content.textContent = caption;
    bubble.appendChild(content);
  }

  bubble.appendChild(buildTimestamp(options.timestamp));
  appendBubble(bubble);
}

/**
 * Remove all chat bubbles and restore the welcome placeholder. Used by the
 * Clear Chat action; preview disposal and store resets live in the caller
 * (create-panel) since it owns that state.
 */
export function clearChatMessages() {
  if (!chatHistoryList) return;
  chatHistoryList
    .querySelectorAll(".chat-bubble")
    .forEach((el) => el.remove());
  const welcome = /** @type {HTMLElement | null} */ (
    chatHistoryList.querySelector(".chat-welcome")
  );
  if (welcome) welcome.hidden = false;
}

/**
 * Append a system message with a row of single-use choice buttons. Clicking
 * a choice disables the whole row and invokes onPick with the choice value.
 * Used for in-chat follow-up actions (e.g. rig & animate presets).
 * @param {string} text
 * @param {Array<{label: string, value: any}>} choices
 * @param {(value: any) => void} onPick
 * @returns {{bubble: HTMLElement} | null}
 */
export function addChoiceMessage(text, choices, onPick) {
  if (!chatHistoryList) return null;
  hideWelcome();

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble chat-bubble-system chat-bubble-choices";

  const content = document.createElement("span");
  content.className = "chat-bubble-content";
  content.textContent = text;
  bubble.appendChild(content);

  const row = document.createElement("div");
  row.className = "chat-choices";
  for (const choice of choices) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary chat-choice-btn";
    btn.textContent = choice.label;
    btn.addEventListener("click", () => {
      row
        .querySelectorAll("button")
        .forEach((b) => (b.disabled = true));
      btn.classList.add("picked");
      onPick(choice.value);
    });
    row.appendChild(btn);
  }
  bubble.appendChild(row);
  bubble.appendChild(buildTimestamp());
  appendBubble(bubble);
  return { bubble };
}

/**
 * @typedef {Object} WorkingMessageHandle
 * @property {HTMLElement} bubble
 * @property {(text: string) => void} setText
 * @property {() => void} remove
 */

/**
 * Append a transient work-in-progress indicator (spinner + status text).
 * The caller removes it when the operation settles. When `onCancel` is
 * given, a Stop button rides along; clicking it disables itself and invokes
 * the callback (which owns confirm + teardown).
 * @param {string} text
 * @param {Object} [options]
 * @param {() => void} [options.onCancel]
 * @returns {WorkingMessageHandle | null}
 */
export function addWorkingMessage(text, options = {}) {
  if (!chatHistoryList) return null;
  hideWelcome();

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble chat-bubble-system chat-bubble-working";
  bubble.setAttribute("role", "status");

  const spinner = document.createElement("span");
  spinner.className = "chat-working-spinner";
  spinner.setAttribute("aria-hidden", "true");

  const content = document.createElement("span");
  content.className = "chat-bubble-content";
  content.textContent = text;

  bubble.appendChild(spinner);
  bubble.appendChild(content);

  const onCancel = options.onCancel;
  if (typeof onCancel === "function") {
    const stopBtn = document.createElement("button");
    stopBtn.type = "button";
    stopBtn.className = "btn btn-secondary chat-working-cancel";
    stopBtn.textContent = "Stop";
    stopBtn.addEventListener("click", () => {
      stopBtn.disabled = true;
      onCancel();
    });
    bubble.appendChild(stopBtn);
  }

  appendBubble(bubble);

  return {
    bubble,
    setText(next) {
      content.textContent = next;
    },
    remove() {
      bubble.remove();
    },
  };
}

/**
 * @typedef {Object} AssetMessageHandle
 * @property {HTMLElement} bubble
 * @property {HTMLCanvasElement} canvas - host for the live 3D preview
 * @property {HTMLButtonElement} sendButton
 * @property {(snapshot: Blob|null) => void} collapsePreview - swap the live
 *   canvas for a static image, keeping the Show-in-Studio action active
 *   (used when the preview cap evicts this bubble, or on preview teardown)
 * @property {(snapshot: Blob|null) => void} markSent - collapse the preview
 *   to a snapshot and tag the bubble sent; the Show-in-Studio button stays
 *   live so it doubles as the explicit restore path
 * @property {() => void} markFallback - replace the canvas with a static
 *   format badge when no live preview is available
 * @property {() => void} markSaved - annotate the bubble with a "Saved" pill
 *   once the asset has been saved to the library
 */

/**
 * Append a rich asset message for a generation result.
 * @param {{prompt: string, format?: string}} opts
 * @returns {AssetMessageHandle | null}
 */
export function addAssetMessage({ prompt, format }) {
  if (!chatHistoryList) return null;
  hideWelcome();

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble chat-bubble-asset";

  const previewWrap = document.createElement("div");
  previewWrap.className = "chat-asset-preview";

  const canvas = document.createElement("canvas");
  canvas.className = "chat-asset-canvas";
  canvas.setAttribute("aria-label", `3D preview of ${prompt}`);
  previewWrap.appendChild(canvas);

  const caption = document.createElement("span");
  caption.className = "chat-asset-caption";
  caption.textContent = prompt;

  const actions = document.createElement("div");
  actions.className = "chat-asset-actions";

  const sendButton = document.createElement("button");
  sendButton.type = "button";
  sendButton.className = "btn btn-primary chat-asset-send";
  sendButton.textContent = "Show in Studio";
  actions.appendChild(sendButton);

  bubble.appendChild(previewWrap);
  bubble.appendChild(caption);
  bubble.appendChild(actions);
  bubble.appendChild(buildTimestamp());
  appendBubble(bubble);

  /**
   * Replace the live canvas with a static snapshot image (or a format badge
   * when no snapshot is available).
   * @param {Blob|null} snapshot
   */
  function swapPreview(snapshot) {
    previewWrap.innerHTML = "";
    if (snapshot) {
      const img = document.createElement("img");
      img.className = "chat-asset-snapshot";
      img.src = URL.createObjectURL(snapshot);
      img.alt = `Snapshot of ${prompt}`;
      previewWrap.appendChild(img);
    } else {
      const badge = document.createElement("div");
      badge.className = "chat-asset-badge";
      badge.textContent = (format || "3D Model").toUpperCase();
      previewWrap.appendChild(badge);
    }
  }

  return {
    bubble,
    canvas,
    sendButton,
    collapsePreview(snapshot) {
      swapPreview(snapshot);
    },
    markSent(snapshot) {
      swapPreview(snapshot);
      sendButton.disabled = false;
      bubble.classList.add("chat-bubble-asset-sent");
    },
    markFallback() {
      swapPreview(null);
    },
    markSaved() {
      if (bubble.classList.contains("chat-bubble-asset-saved")) return;
      bubble.classList.add("chat-bubble-asset-saved");
      const pill = document.createElement("span");
      pill.className = "chat-asset-saved-pill";
      pill.textContent = "Saved";
      caption.appendChild(pill);
    },
  };
}

/**
 * Append a compact follow-up action row (Retexture · Retopo · Auto-rig ·
 * Animate…) to an asset bubble's action area. History bubbles have no
 * actions container — one is created so the same row works there.
 * @param {AssetMessageHandle | {bubble: HTMLElement}} handle
 * @param {Array<{id: string, label: string, onPick: () => void}>} actions
 */
export function addAssetActionRow(handle, actions) {
  if (actions.length === 0) return;
  let actionsEl = handle.bubble.querySelector(".chat-asset-actions");
  if (!actionsEl) {
    actionsEl = document.createElement("div");
    actionsEl.className = "chat-asset-actions";
    handle.bubble.appendChild(actionsEl);
  }
  const row = document.createElement("div");
  row.className = "chat-asset-followups";
  for (const action of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary chat-asset-followup-btn";
    btn.dataset.action = action.id;
    btn.textContent = action.label;
    btn.addEventListener("click", action.onPick);
    row.appendChild(btn);
  }
  actionsEl.appendChild(row);
}
