/**
 * Header "New ▾" menu: Upload model / Generate with AI / Parametric CAD /
 * Empty asset.
 * @remarks "Empty asset" keeps the legacy #newAssetBtn id, so scene-graph's
 *   existing click listener (and Ctrl+N) remain the single new-asset path.
 *   Upload reuses the viewport file-drop pipeline (ASSET_FILE_DROPPED) after
 *   clearing the scene, so it always creates a new draft rather than
 *   replacing the open asset's model.
 */
import { emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import {
  closeAsset,
  getActiveAssetManifestCid,
} from "@arbesk/asset-core/domain/asset.js";
import { navigate } from "../app/router.ts";
import { clearScene } from "../engine/cleanup.ts";
import { state } from "../engine/state.ts";
import { isTypingInField } from "../utils/typing-guard.ts";
import { showConfirmDialog } from "./dialog.ts";
import { initMenuButton } from "./menu-button.ts";
import { switchView } from "./sidebar.ts";

const SCENE_WAIT_MS = 15000;

function onStudio(): boolean {
  return location.pathname.startsWith("/studio");
}

/** Navigate to Studio if needed and resolve once the Babylon scene exists. */
async function ensureStudioScene(): Promise<boolean> {
  if (!onStudio()) navigate("/studio");
  const start = Date.now();
  while (!state.scene) {
    if (Date.now() - start > SCENE_WAIT_MS) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
  return true;
}

function cadAvailable(): boolean {
  return !!document.querySelector('#providerSelect option[value="cad"]');
}

/** Pick the provider for the Create panel: CAD, or the first non-CAD one. */
function selectProvider(select: HTMLSelectElement, provider: "cad" | "default"): void {
  if (provider === "cad") {
    select.value = "cad";
  } else if (select.value === "cad") {
    const firstNonCad = Array.from(select.options).find((o) => o.value !== "cad");
    if (firstNonCad) select.value = firstNonCad.value;
  }
  select.dispatchEvent(new Event("change"));
}

async function openCreate(provider: "cad" | "default"): Promise<void> {
  if (!onStudio()) navigate("/studio");
  switchView("chat");
  const select = document.getElementById("providerSelect") as HTMLSelectElement | null;
  if (select) selectProvider(select, provider);
  await Promise.resolve();
  (document.getElementById("promptInput") as HTMLElement | null)?.focus();
}

async function confirmDiscardOpenAsset(): Promise<boolean> {
  if (!getActiveAssetManifestCid()) return true;
  const choice = await showConfirmDialog(
    "Start a new asset?",
    "A new draft will be created from this file. Unsaved changes to the open asset will be lost.",
    [
      { text: "Cancel", value: "cancel" },
      { text: "New asset", value: "new" },
    ],
  );
  return choice === "new";
}

async function startUpload(file: File): Promise<void> {
  if (!(await confirmDiscardOpenAsset())) return;
  if (!(await ensureStudioScene())) return;
  clearScene();
  closeAsset();
  emit(EVENTS.SCENE_EMPTY);
  emit(EVENTS.ASSET_FILE_DROPPED, { file });
}

/** kbd hints are written for Ctrl; show ⌘ on Apple platforms. */
function localiseShortcutHints(menu: HTMLElement): void {
  if (!/Mac|iPhone|iPad/.test(navigator.platform)) return;
  menu.querySelectorAll("kbd").forEach((k) => {
    k.textContent = (k.textContent || "").replace("Ctrl+", "⌘");
  });
}

export function initNewMenu(): void {
  const button = document.getElementById("newMenuBtn");
  const menu = document.getElementById("newMenu");
  const input = document.getElementById("newMenuUploadInput") as HTMLInputElement | null;
  if (!button || !menu) return;
  localiseShortcutHints(menu);

  const actions: Record<string, () => void> = {
    newMenuUpload: () => input?.click(),
    newMenuAi: () => void openCreate("default"),
    newMenuCad: () => void openCreate("cad"),
    // scene-graph.ts owns this id's click listener (startNewAsset).
    newAssetBtn: () => {
      if (!onStudio()) navigate("/studio");
    },
  };

  initMenuButton(button, menu, {
    align: "start",
    onOpen() {
      const cad = document.getElementById("newMenuCad");
      if (cad) cad.hidden = !cadAvailable();
    },
    onSelect(item) {
      actions[item.id]?.();
    },
  });

  // Keyboard activation of "Empty asset": convert to a real click so
  // scene-graph's #newAssetBtn listener runs (the click then reaches the
  // menu's click handler → close + onSelect exactly once).
  menu.addEventListener(
    "keydown",
    (e) => {
      const el = document.activeElement as HTMLElement | null;
      if ((e.key === "Enter" || e.key === " ") && el?.id === "newAssetBtn") {
        e.preventDefault();
        e.stopImmediatePropagation();
        el.click();
      }
    },
    true,
  );

  input?.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void startUpload(file);
    input.value = "";
  });

  // Ctrl/Cmd+O — Upload model…, unless typing in a field or New is hidden.
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "o") return;
    if (isTypingInField() || button.hidden) return;
    e.preventDefault();
    input?.click();
  });
}
