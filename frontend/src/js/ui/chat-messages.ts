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
  const welcome = chatHistoryList?.querySelector<HTMLElement>(".chat-welcome");
  if (welcome) welcome.hidden = true;
}

function appendBubble(bubble: HTMLElement) {
  if (!chatHistoryList) return;
  chatHistoryList.appendChild(bubble);
  chatHistoryList.scrollTop = chatHistoryList.scrollHeight;
}

function buildTimestamp(date: Date = new Date()): HTMLElement {
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
 * @param role
 * @param text
 * @param [options]
 * @param [options.timestamp] - defaults to now
 * @param [options.extraClass] - extra CSS class on the bubble
 */
export function addChatMessage(
  role: "user" | "system",
  text: string,
  options: { timestamp?: Date; extraClass?: string } = {}
) {
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
 * @param role
 * @param src - image URL or data URI (single-image mode)
 * @param [caption]
 * @param [options]
 * @param [options.timestamp] - defaults to now
 * @param [options.images] - multiview thumbnails
 */
export function addImageMessage(
  role: "user" | "system",
  src: string,
  caption?: string,
  options: {
    timestamp?: Date;
    images?: Array<{ src: string; caption?: string }>;
  } = {}
) {
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
  const welcome = chatHistoryList.querySelector<HTMLElement>(".chat-welcome");
  if (welcome) welcome.hidden = false;
}

/**
 * Append a system message with a row of single-use choice buttons. Clicking
 * a choice disables the whole row and invokes onPick with the choice value.
 * Used for in-chat follow-up actions (e.g. rig & animate presets).
 * @param text
 * @param choices
 * @param onPick
 */
export function addChoiceMessage(
  text: string,
  choices: Array<{ label: string; value: any }>,
  onPick: (value: any) => void
): { bubble: HTMLElement } | null {
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

export interface WorkingMessageHandle {
  bubble: HTMLElement;
  setText: (text: string) => void;
  /** show a determinate progress bar at 0..1 (replacing the indeterminate
   * spinner, GNOME-style) and append the percentage to the status text */
  setProgress: (fraction: number, text?: string) => void;
  remove: () => void;
}

/**
 * Append a transient work-in-progress indicator (spinner + status text).
 * The caller removes it when the operation settles. When `onCancel` is
 * given, a Stop button rides along; clicking it disables itself and invokes
 * the callback (which owns confirm + teardown).
 * @param text
 * @param [options]
 * @param [options.onCancel]
 */
export function addWorkingMessage(
  text: string,
  options: { onCancel?: () => void } = {}
): WorkingMessageHandle | null {
  if (!chatHistoryList) return null;
  hideWelcome();

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble chat-bubble-system chat-bubble-working";
  bubble.setAttribute("role", "status");

  const spinner = document.createElement("span");
  spinner.className = "chat-working-spinner";
  spinner.setAttribute("aria-hidden", "true");

  const body = document.createElement("span");
  body.className = "chat-working-body";

  const content = document.createElement("span");
  content.className = "chat-bubble-content";
  content.textContent = text;

  const track = document.createElement("span");
  track.className = "chat-working-track";
  track.hidden = true;
  const fill = document.createElement("span");
  fill.className = "chat-working-fill";
  track.appendChild(fill);

  body.appendChild(content);
  body.appendChild(track);

  bubble.appendChild(spinner);
  bubble.appendChild(body);

  let baseText = text;

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
      baseText = next;
      content.textContent = next;
    },
    setProgress(fraction, nextText) {
      const clamped = Math.min(1, Math.max(0, fraction));
      if (typeof nextText === "string" && nextText) baseText = nextText;
      // Determinate progress replaces the spinner (one indicator, not two).
      spinner.hidden = true;
      track.hidden = false;
      track.setAttribute("role", "progressbar");
      track.setAttribute("aria-valuemin", "0");
      track.setAttribute("aria-valuemax", "100");
      track.setAttribute("aria-valuenow", String(Math.round(clamped * 100)));
      fill.style.width = `${Math.round(clamped * 100)}%`;
      content.textContent = `${baseText} ${Math.round(clamped * 100)}%`;
    },
    remove() {
      bubble.remove();
    },
  };
}

export interface AssetMessageHandle {
  bubble: HTMLElement;
  /** host for the live 3D preview */
  canvas: HTMLCanvasElement;
  sendButton: HTMLButtonElement;
  /** swap the live canvas for a static image, keeping the Show-in-Studio
   * action active (used when the preview cap evicts this bubble, or on
   * preview teardown) */
  collapsePreview: (snapshot: Blob | null) => void;
  /** collapse the preview to a snapshot and tag the bubble sent; the
   * Show-in-Studio button stays live so it doubles as the explicit
   * restore path */
  markSent: (snapshot: Blob | null) => void;
  /** replace the canvas with a static format badge when no live preview is
   * available */
  markFallback: () => void;
  /** annotate the bubble with a "Saved" pill once the asset has been saved
   * to the library */
  markSaved: () => void;
}

/**
 * Append a rich asset message for a generation result.
 */
export function addAssetMessage({
  prompt,
  format,
}: {
  prompt: string;
  format?: string;
}): AssetMessageHandle | null {
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
   */
  function swapPreview(snapshot: Blob | null) {
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
 */
export function addAssetActionRow(
  handle: AssetMessageHandle | { bubble: HTMLElement },
  actions: Array<{ id: string; label: string; onPick: () => void }>
) {
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
