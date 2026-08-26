/**
 * Chat message builders for the AI Generation pane — Alpine.js.
 *
 * Every chat bubble is a reactive message object in Alpine.store("chat").messages,
 * rendered declaratively by the x-for template in studio-sidebar.pug. The
 * imperative entry points below (addChatMessage, addAssetMessage, …) are thin
 * wrappers that push/mutate message objects; Alpine re-renders the list.
 *
 * The one genuinely imperative path is the live 3D preview: create-panel
 * awaits Alpine's next tick, then mounts a Babylon engine onto the
 * canvas.chat-asset-canvas that x-for rendered for the asset message
 * (AGENTS.md rule #5 — a Babylon canvas must be created/disposed imperatively,
 * so it stays a post-render mount rather than store-owned DOM).
 */

import { emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { Alpine, registerAlpineComponent } from "./alpine.ts";

// ─── Message model ─────────────────────────────────────────────────────────

interface ChatMsgBase {
  id: string;
  time: string;
  dateTime: string;
}

interface TextMsg extends ChatMsgBase {
  kind: "text";
  role: "user" | "system";
  text: string;
  extraClass: string;
  manifestCid?: string;
  sourceCid?: string;
  generationId?: string;
  followups?: Array<{ id: string; label: string }>;
}

interface ImageMsg extends ChatMsgBase {
  kind: "image";
  role: "user" | "system";
  src: string;
  caption: string;
  images: Array<{ src: string; caption?: string }> | null;
}

interface ChoiceMsg extends ChatMsgBase {
  kind: "choice";
  text: string;
  choices: Array<{ label: string; value: any }>;
  picked: boolean;
  pickedValue: any;
}

interface WorkingMsg extends ChatMsgBase {
  kind: "working";
  text: string;
  progress: number | null;
  cancel: boolean;
  cancelDisabled: boolean;
}

interface AssetMsg extends ChatMsgBase {
  kind: "asset";
  prompt: string;
  format: string;
  generationId: string;
  preview: "live" | "snapshot" | "fallback";
  snapshotUrl: string | null;
  sent: boolean;
  saved: boolean;
  sendLabel: string;
  sendDisabled: boolean;
  followups: Array<{ id: string; label: string }>;
}

export type ChatMsg = TextMsg | ImageMsg | ChoiceMsg | WorkingMsg | AssetMsg;

// ─── Reactive store + handler registries ───────────────────────────────────

interface ChatStore {
  messages: ChatMsg[];
}

let _store: ChatStore | null = null;

function store(): ChatStore {
  if (!_store) {
    if (!Alpine.store("chat")) {
      Alpine.store("chat", { messages: [] as ChatMsg[] });
    }
    _store = Alpine.store("chat") as ChatStore;
  }
  return _store;
}

const assetSendHandlers = new Map<string, (generationId: string) => void>();
const followupHandlers = new Map<string, (actionId: string) => void>();
const choiceHandlers = new Map<string, (value: any) => void>();
const cancelHandlers = new Map<string, () => void>();

let seq = 0;
function nextId(): string {
  return "msg-" + ++seq;
}

function timeFor(timestamp?: Date): { time: string; dateTime: string } {
  const d = timestamp || new Date();
  return {
    time: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    dateTime: d.toISOString(),
  };
}

function push(msg: ChatMsg): void {
  store().messages.push(msg);
}

function findBy(predicate: (msg: ChatMsg) => boolean): ChatMsg | undefined {
  return store().messages.find(predicate);
}

function removeWhere(predicate: (msg: ChatMsg) => boolean): void {
  const s = store();
  s.messages = s.messages.filter((m) => !predicate(m));
}

// ─── Imperative entry points (thin store writers) ──────────────────────────

export function addChatMessage(
  role: "user" | "system",
  text: string,
  options: {
    timestamp?: Date;
    extraClass?: string;
    manifestCid?: string;
    sourceCid?: string;
    generationId?: string;
  } = {}
): TextMsg {
  const t = timeFor(options.timestamp);
  const msg: TextMsg = {
    id: nextId(),
    kind: "text",
    role,
    text,
    extraClass: options.extraClass || "",
    time: t.time,
    dateTime: t.dateTime,
    ...(options.manifestCid ? { manifestCid: options.manifestCid } : {}),
    ...(options.sourceCid ? { sourceCid: options.sourceCid } : {}),
    ...(options.generationId ? { generationId: options.generationId } : {}),
  };
  push(msg);
  return msg;
}

export function addImageMessage(
  role: "user" | "system",
  src: string,
  caption?: string,
  options: {
    timestamp?: Date;
    images?: Array<{ src: string; caption?: string }>;
  } = {}
): void {
  const t = timeFor(options.timestamp);
  push({
    id: nextId(),
    kind: "image",
    role,
    src,
    caption: caption || "",
    images:
      Array.isArray(options.images) && options.images.length
        ? options.images
        : null,
    time: t.time,
    dateTime: t.dateTime,
  });
}

export function addChoiceMessage(
  text: string,
  choices: Array<{ label: string; value: any }>,
  onPick: (value: any) => void
): void {
  const id = nextId();
  const t = timeFor();
  choiceHandlers.set(id, onPick);
  push({
    id,
    kind: "choice",
    text,
    choices,
    picked: false,
    pickedValue: null,
    time: t.time,
    dateTime: t.dateTime,
  });
}

export interface WorkingMessageHandle {
  id: string;
  setText: (text: string) => void;
  setProgress: (fraction: number, text?: string) => void;
  remove: () => void;
}

export function addWorkingMessage(
  text: string,
  options: { onCancel?: () => void } = {}
): WorkingMessageHandle | null {
  const id = nextId();
  const t = timeFor();
  if (typeof options.onCancel === "function") {
    cancelHandlers.set(id, options.onCancel);
  }
  push({
    id,
    kind: "working",
    text,
    progress: null,
    cancel: typeof options.onCancel === "function",
    cancelDisabled: false,
    time: t.time,
    dateTime: t.dateTime,
  });
  return {
    id,
    setText(next) {
      const msg = findBy((m) => m.id === id) as WorkingMsg | undefined;
      if (msg) msg.text = next;
    },
    setProgress(fraction, nextText) {
      const msg = findBy((m) => m.id === id) as WorkingMsg | undefined;
      if (!msg) return;
      msg.progress = Math.min(1, Math.max(0, fraction));
      if (typeof nextText === "string" && nextText) msg.text = nextText;
    },
    remove() {
      removeWhere((m) => m.id === id);
      cancelHandlers.delete(id);
    },
  };
}

export interface AssetMessageHandle {
  id: string;
  generationId: string;
  get bubble(): HTMLElement | null;
  get canvas(): HTMLCanvasElement | null;
  get sendButton(): HTMLButtonElement | null;
  setSendDisabled(disabled: boolean): void;
  setSendLabel(label: string): void;
  collapsePreview(snapshot: Blob | null): void;
  markSent(snapshot: Blob | null): void;
  markFallback(): void;
  markSaved(): void;
}

export function addAssetMessage(args: {
  prompt: string;
  format?: string;
  generationId: string;
}): AssetMessageHandle | null {
  const id = nextId();
  const t = timeFor();
  push({
    id,
    kind: "asset",
    prompt: args.prompt,
    format: args.format || "",
    generationId: args.generationId,
    preview: "live",
    snapshotUrl: null,
    sent: false,
    saved: false,
    sendLabel: "Show in Studio",
    sendDisabled: false,
    followups: [],
    time: t.time,
    dateTime: t.dateTime,
  });

  const findMsg = (): AssetMsg | undefined =>
    findBy((m) => m.id === id) as AssetMsg | undefined;

  function setPreview(snapshot: Blob | null): void {
    const msg = findMsg();
    if (!msg) return;
    if (snapshot) {
      msg.preview = "snapshot";
      msg.snapshotUrl = URL.createObjectURL(snapshot);
    } else {
      msg.preview = "fallback";
      msg.snapshotUrl = null;
    }
  }

  const handle: AssetMessageHandle = {
    id,
    generationId: args.generationId,
    get bubble() {
      return document.querySelector(
        '[data-msg-id="' + id + '"]'
      ) as HTMLElement | null;
    },
    get canvas() {
      return (this.bubble?.querySelector(".chat-asset-canvas") ||
        null) as HTMLCanvasElement | null;
    },
    get sendButton() {
      return (this.bubble?.querySelector(".chat-asset-send") ||
        null) as HTMLButtonElement | null;
    },
    setSendDisabled(disabled) {
      const msg = findMsg();
      if (msg) msg.sendDisabled = disabled;
    },
    setSendLabel(label) {
      const msg = findMsg();
      if (msg) msg.sendLabel = label;
    },
    collapsePreview(snapshot) {
      setPreview(snapshot);
    },
    markSent(snapshot) {
      setPreview(snapshot);
      const msg = findMsg();
      if (msg) {
        msg.sent = true;
        msg.sendDisabled = false;
      }
    },
    markFallback() {
      setPreview(null);
    },
    markSaved() {
      const msg = findMsg();
      if (msg && !msg.saved) msg.saved = true;
    },
  };
  return handle;
}

export function addAssetActionRow(
  generationId: string,
  actions: Array<{ id: string; label: string; onPick: () => void }>
): void {
  if (actions.length === 0) return;
  const msg = findBy(
    (m) =>
      (m.kind === "asset" || m.kind === "text") &&
      (m as any).generationId === generationId
  ) as (AssetMsg | TextMsg) | undefined;
  if (msg) {
    (msg as any).followups = actions.map((a) => ({ id: a.id, label: a.label }));
  }
  followupHandlers.set(generationId, (actionId) => {
    actions.find((a) => a.id === actionId)?.onPick();
  });
}

export function registerAssetSendHandler(
  generationId: string,
  handler: (generationId: string) => void
): void {
  assetSendHandlers.set(generationId, handler);
}

/** Move already-added messages to the front (history renders above live). */
export function prependChatMessages(messages: ChatMsg[]): void {
  const s = store();
  const ids = new Set(messages.map((m) => m.id));
  s.messages = messages.concat(s.messages.filter((m) => !ids.has(m.id)));
}

export function clearChatMessages(): void {
  store().messages = [];
  choiceHandlers.clear();
  cancelHandlers.clear();
  followupHandlers.clear();
  assetSendHandlers.clear();
}

export function clearHistoryMessages(): void {
  removeWhere(
    (m) => m.kind === "text" && m.extraClass.includes("chat-bubble-history")
  );
}

// ─── Component factory (template-facing) ───────────────────────────────────

interface ChatFeedComponent {
  readonly messages: ChatMsg[];
  readonly hasMessages: boolean;
  bubbleClass(msg: ChatMsg): string;
  showInStudio(msg: AssetMsg): void;
  followup(msg: AssetMsg, actionId: string): void;
  onTextClick(msg: any): void;
  pickChoice(msg: ChoiceMsg, choice: { value: any }): void;
  stopWorking(msg: WorkingMsg): void;
}

export function chatFeed(): ChatFeedComponent {
  return {
    get messages() {
      return store().messages;
    },
    get hasMessages() {
      return store().messages.length > 0;
    },

    bubbleClass(msg: ChatMsg) {
      switch (msg.kind) {
        case "text":
          return (
            "chat-bubble chat-bubble-" +
            msg.role +
            (msg.extraClass ? " " + msg.extraClass : "")
          );
        case "image":
          return "chat-bubble chat-bubble-" + msg.role + " chat-bubble-image";
        case "choice":
          return "chat-bubble chat-bubble-system chat-bubble-choices";
        case "working":
          return "chat-bubble chat-bubble-system chat-bubble-working";
        case "asset":
          return (
            "chat-bubble chat-bubble-asset" +
            (msg.sent ? " chat-bubble-asset-sent" : "") +
            (msg.saved ? " chat-bubble-asset-saved" : "")
          );
      }
    },

    showInStudio(msg: AssetMsg) {
      assetSendHandlers.get(msg.generationId)?.(msg.generationId);
    },

    followup(msg: AssetMsg, actionId: string) {
      followupHandlers.get(msg.generationId)?.(actionId);
    },

    onTextClick(msg: any) {
      if (msg && msg.kind === "text" && msg.manifestCid) {
        emit(EVENTS.HISTORY_VERSION_SELECTED, {
          cid: msg.manifestCid,
          sourceCid: msg.sourceCid,
          name: msg.text,
        });
      }
    },

    pickChoice(msg: ChoiceMsg, choice: { value: any }) {
      if (msg.picked) return;
      msg.picked = true;
      msg.pickedValue = choice.value;
      choiceHandlers.get(msg.id)?.(choice.value);
    },

    stopWorking(msg: WorkingMsg) {
      if (msg.cancelDisabled) return;
      msg.cancelDisabled = true;
      cancelHandlers.get(msg.id)?.();
    },
  };
}

registerAlpineComponent("chatFeed", chatFeed);

