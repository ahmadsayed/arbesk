/**
 * Landing page (index.html) script — the landing page ships no app bundle.
 * Built as a classic iife (frontend/scripts/bundle.js) and loaded with `defer`.
 * Fetches /api/v1/config once for the testnet banner and the CAD gate.
 */
import { initPromptForm } from "./prompt-form.ts";
import { initVersionDemo } from "./version-demo.ts";

// Mirrors ui/testnet-banner.ts (Base Sepolia).
const BASE_SEPOLIA = 84532;

const config: Promise<{ defaultChainId?: number | string; cadGeneration?: boolean } | null> = fetch(
  "/api/v1/config",
)
  .then((r) => r.json())
  .catch(() => null);

void config.then((cfg) => {
  if (Number(cfg?.defaultChainId) === BASE_SEPOLIA) {
    document.getElementById("testnetBanner")?.classList.add("visible");
  }
});

const form = document.getElementById("prompt");
if (form instanceof HTMLFormElement) {
  initPromptForm(form, { cadAvailable: config.then((cfg) => cfg?.cadGeneration !== false) });
}

const demo = document.getElementById("versionDemo");
if (demo) initVersionDemo(demo);
