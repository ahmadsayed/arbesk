/**
 * Chat message builders for the AI Generation pane.
 *
 * addChatMessage renders plain text bubbles (user/system). addAssetMessage
 * renders a rich bubble for a generation result: a live 3D preview canvas,
 * the prompt caption, and a "Show in Studio" action. The bubble's lifecycle
 * mirrors the pending-generation record: while pending it can show a live
 * preview (or a static fallback), and once sent it collapses to a snapshot
 * image with the action disabled.
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
 * @returns {HTMLElement}
 */
function buildTimestamp() {
  const now = new Date();
  const time = document.createElement("time");
  time.className = "chat-bubble-time";
  time.dateTime = now.toISOString();
  time.textContent = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return time;
}

/**
 * Append a plain text chat message.
 * @param {"user"|"system"} role
 * @param {string} text
 */
export function addChatMessage(role, text) {
  if (!chatHistoryList) return;
  hideWelcome();

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble chat-bubble-${role}`;

  const content = document.createElement("span");
  content.className = "chat-bubble-content";
  content.textContent = text;
  bubble.appendChild(content);

  bubble.appendChild(buildTimestamp());
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
 * @typedef {Object} WorkingMessageHandle
 * @property {HTMLElement} bubble
 * @property {(text: string) => void} setText
 * @property {() => void} remove
 */

/**
 * Append a transient work-in-progress indicator (spinner + status text).
 * The caller removes it when the operation settles.
 * @param {string} text
 * @returns {WorkingMessageHandle | null}
 */
export function addWorkingMessage(text) {
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
 *   and disable the action with a "Shown in Studio" caption
 * @property {() => void} markFallback - replace the canvas with a static
 *   format badge when no live preview is available
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
      sendButton.disabled = true;
      sendButton.textContent = "Shown in Studio";
      bubble.classList.add("chat-bubble-asset-sent");
    },
    markFallback() {
      swapPreview(null);
    },
  };
}
