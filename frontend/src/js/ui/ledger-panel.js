/**
 * Arbesk UI Activity Panel (Manifest-Driven) — Alpine.js component
 *
 * Derives the activity feed entirely from the asset manifest chain.
 * No localStorage. No server-side ledger. No event accumulation.
 * The manifest file (and its version chain via prev_manifest_cid)
 * is the single source of truth.
 *
 * The DOM lives in app.pug ([data-view="ledger"] fragment,
 * `x-data="ledgerPanel"`). Reactive state lives in an Alpine.store so that
 * BOTH template expressions and external code (the bus-event reload
 * subscriptions) mutate the same reactive proxy — mutating a component's
 * captured `this` from outside Alpine's expression evaluation does not
 * trigger reactivity, but store writes always do.
 */

import { truncateAddress, truncateCid } from "../utils/format.js";
import { on, EVENTS } from "../events/bus.js";
import { getActiveAssetManifestCid } from "../domain/asset.js";
import { walletState } from "../state/wallet-state.js";
import { walkManifestChain } from "../engine/time-travel.js";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";
import { Alpine, registerAlpineComponent } from "./alpine.js";

const ACTIVITY_CONFIG = {
  GENERATION: { label: "Generation", icon: "✦" },
  PARAMETRIC: { label: "Parametric", icon: "◐" },
  SAVE: { label: "Save", icon: "⬇" },
  PUBLISH: { label: "Publish", icon: "⬆" },
  LOAD: { label: "Load", icon: "→" },
};

/**
 * @typedef {object} LedgerPanelState
 * @property {any[]} activities - extracted chain entries, most recent first
 * @property {string} filter - opType filter bound to #ledgerFilter ("" = all)
 * @property {string} statsText - "# ops · # assets" line; kept stale when the
 *   last load yielded no entries (legacy render() only updated it on a
 *   non-empty list)
 */

/** @type {LedgerPanelState|null} reactive Alpine.store proxy */
let _state = null;

let initialized = false;

/**
 * Get (or lazily create) the reactive ledger state store.
 * @returns {LedgerPanelState}
 */
function state() {
  if (!_state) {
    // Alpine.store(name, value) is a setter (returns undefined); read it back.
    if (!Alpine.store("ledgerPanel")) {
      Alpine.store("ledgerPanel", {
        activities: [],
        filter: "",
        statsText: "",
      });
    }
    _state = /** @type {LedgerPanelState} */ (Alpine.store("ledgerPanel"));
  }
  return /** @type {LedgerPanelState} */ (_state);
}

/** @param {number|string} ts */
function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** @param {number|string} ts */
function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Map a raw activity entry to the view model rendered by the x-for template.
 * @param {any} entry
 * @returns {{id: string, icon: string, label: string, opType: string, cid: string, cidShort: string, actor: string, actorShort: string, timeText: string}}
 */
function toRow(entry) {
  const config = ACTIVITY_CONFIG[/** @type {keyof typeof ACTIVITY_CONFIG} */ (entry.opType)] || {
    label: entry.opType,
    icon: "·",
  };
  return {
    id: entry.id,
    icon: config.icon,
    label: config.label,
    opType: entry.opType,
    cid: entry.cid,
    cidShort: truncateCid(entry.cid),
    actor: entry.actorAddress,
    actorShort: truncateAddress(entry.actorAddress),
    timeText: `${formatDate(entry.timestamp)} ${formatTime(entry.timestamp)}`,
  };
}

/**
 * Extract activity entries from a manifest chain response.
 * The manifest chain is walked client-side via walkManifestChain() and each
 * manifest is fetched from remote IPFS with getFromRemoteIPFS(); there is no
 * server endpoint such as /api/v1/manifests/:cid/history.
 * @param {any[]} chain
 */
function extractActivities(chain) {
  const entries = [];
  const seen = new Set();

  for (const item of chain) {
    const manifest = item.manifest;
    if (!manifest) continue;

    const manifestCid = item.cid;

    // Manifest-level entry: each version in the chain represents a saved state.
    if (manifestCid && !seen.has(`manifest-${manifestCid}`)) {
      seen.add(`manifest-${manifestCid}`);
      entries.push({
        id: `manifest-${manifestCid}`,
        timestamp: manifest.timestamp || 0,
        opType: manifest.version === 1 ? "SAVE" : "LOAD",
        manifestId: manifest.asset_id || manifest.manifest_id || "-",
        cid: manifestCid,
        prevCid: manifest.prev_manifest_cid || null,
        actorType: "USER",
        actorAddress: walletState.get().walletAddress || "system",
        payload: {
          version: manifest.version,
          nodeCount: manifest.nodes?.length || 0,
        },
      });
    }

    // Chat provenance entries. metadata.chat is version-scoped and the walk
    // covers every version, so each prompt appears exactly once. Entry
    // timestamps are unix seconds; normalize to ms for sorting.
    for (const [index, h] of (manifest.metadata?.chat || []).entries()) {
      const key = `chat-${manifestCid}-${h.timestamp}-${index}-${h.prompt}`;
      if (seen.has(key)) continue;
      seen.add(key);

      entries.push({
        id: key,
        timestamp: (h.timestamp || 0) * 1000,
        opType: "AI",
        manifestId: manifest.asset_id || manifest.manifest_id || "-",
        cid: manifestCid,
        prevCid: null,
        actorType: "USER",
        actorAddress: walletState.get().walletAddress || "system",
        payload: {
          prompt: h.prompt,
          provider: h.provider,
          task: h.task,
          taskId: h.taskId,
        },
      });
    }
  }

  // Most recent first
  return entries.sort((a, b) => b.timestamp - a.timestamp);
}

async function loadActivities() {
  const cid = getActiveAssetManifestCid();
  if (!cid) {
    state().activities = [];
    return;
  }

  try {
    // Walk the manifest chain client-side via IPFS gateway.
    const summaries = await walkManifestChain(cid);

    // Fetch full manifests for activity extraction concurrently.
    const manifestResults = await Promise.allSettled(
      summaries.map((s) =>
        getFromRemoteIPFS(s.cid).then((manifest) => ({
          cid: s.cid,
          manifest,
        }))
      )
    );
    const chain = manifestResults
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value);

    const s = state();
    s.activities = extractActivities(chain);
    // Legacy render() only refreshed the stats line when the list was
    // non-empty; keep that here so an empty load leaves the previous text.
    if (s.activities.length) {
      const uniqueCids = new Set(s.activities.map((a) => a.cid).filter(Boolean))
        .size;
      s.statsText = `${s.activities.length} ops · ${uniqueCids} assets`;
    }
  } catch (err) {
    console.warn("[LEDGER] failed to load manifest history:", /** @type {Error} */ (err).message);
    state().activities = [];
  }
}

function onAnchorClicked() {
  console.warn("[LEDGER] anchorManifest() not available in current contract");
}

// ─── Component factory (template-facing) ─────────────────────────────

/**
 * Alpine data factory for the ledger panel (`x-data="ledgerPanel"`).
 * Getters read the reactive store, so Alpine effects track them; methods
 * delegate to the module functions above.
 * @returns {object}
 */
export function ledgerPanel() {
  return {
    /** View-model rows for the x-for template, honoring the opType filter. */
    get rows() {
      const s = state();
      const filtered = s.filter
        ? s.activities.filter((a) => a.opType === s.filter)
        : s.activities;
      return filtered.map(toRow);
    },

    get filter() {
      return state().filter;
    },

    /** @param {string} value */
    set filter(value) {
      state().filter = value;
    },

    get statsText() {
      return state().statsText;
    },

    anchor() {
      onAnchorClicked();
    },
  };
}

// ─── Initialization ──────────────────────────────────────────────────

function initLedgerPanel() {
  registerAlpineComponent("ledgerPanel", ledgerPanel);

  if (initialized) return;
  if (!document.getElementById("ledgerBody")) return;

  // Refresh when the scene changes or the asset is saved/published
  on(EVENTS.SCENE_READY, () => loadActivities());
  on(EVENTS.ASSET_DRAFT_SAVED, () => loadActivities());
  on(EVENTS.ASSET_PUBLISHED, () => loadActivities());
  on(EVENTS.WALLET_GENERATION_PAID, () => loadActivities());

  initialized = true;
  loadActivities();
}

function refreshLedger() {
  loadActivities();
}

export { initLedgerPanel, refreshLedger };
