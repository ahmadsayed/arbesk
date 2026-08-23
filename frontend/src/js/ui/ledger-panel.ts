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

import { truncateAddress, truncateCid } from "../utils/format.ts";
import { on, EVENTS } from "../asset-core/events/bus.ts";
import { getActiveAssetManifestCid } from "../asset-core/domain/asset.ts";
import { walletState } from "../state/wallet-state.ts";
import { walkManifestChain } from "../engine/time-travel.ts";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.ts";
import { Alpine, registerAlpineComponent } from "./alpine.ts";

const ACTIVITY_CONFIG = {
  GENERATION: { label: "Generation", icon: "✦" },
  PARAMETRIC: { label: "Parametric", icon: "◐" },
  SAVE: { label: "Save", icon: "⬇" },
  PUBLISH: { label: "Publish", icon: "⬆" },
  LOAD: { label: "Load", icon: "→" },
};

export interface LedgerPanelState {
  /** extracted chain entries, most recent first */
  activities: any[];
  /** opType filter bound to #ledgerFilter ("" = all) */
  filter: string;
  /** "# ops · # assets" line; kept stale when the last load yielded no
   * entries (legacy render() only updated it on a non-empty list) */
  statsText: string;
}

/** One extracted activity entry from the manifest chain. */
interface ActivityEntry {
  id: string;
  timestamp: number;
  opType: string;
  manifestId: string;
  cid: string | null;
  prevCid: string | null;
  actorType: string;
  actorAddress: string;
  payload: Record<string, any>;
}

/** View-model row rendered by the x-for template. */
interface LedgerRow {
  id: string;
  icon: string;
  label: string;
  opType: string;
  cid: string | null;
  cidShort: string;
  actor: string;
  actorShort: string;
  timeText: string;
}

/** reactive Alpine.store proxy */
let _state: LedgerPanelState | null = null;

let initialized = false;

/**
 * Get (or lazily create) the reactive ledger state store.
 */
function state(): LedgerPanelState {
  if (!_state) {
    // Alpine.store(name, value) is a setter (returns undefined); read it back.
    if (!Alpine.store("ledgerPanel")) {
      Alpine.store("ledgerPanel", {
        activities: [],
        filter: "",
        statsText: "",
      });
    }
    _state = Alpine.store("ledgerPanel") as LedgerPanelState;
  }
  return _state as LedgerPanelState;
}

function formatTime(ts: number | string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(ts: number | string): string {
  const d = new Date(ts);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Map a raw activity entry to the view model rendered by the x-for template.
 */
function toRow(entry: any): LedgerRow {
  const config = ACTIVITY_CONFIG[entry.opType as keyof typeof ACTIVITY_CONFIG] || {
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
 */
function extractActivities(chain: any[]): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  const seen = new Set<string>();

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

async function loadActivities(): Promise<void> {
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
      summaries.map((s: any) =>
        getFromRemoteIPFS(s.cid).then((manifest: any) => ({
          cid: s.cid,
          manifest,
        }))
      )
    );
    const chain = manifestResults
      .filter((r) => r.status === "fulfilled")
      .map((r) => (r as PromiseFulfilledResult<any>).value);

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
    console.warn("[LEDGER] failed to load manifest history:", (err as Error).message);
    state().activities = [];
  }
}

function onAnchorClicked(): void {
  console.warn("[LEDGER] anchorManifest() not available in current contract");
}

// ─── Component factory (template-facing) ─────────────────────────────

/** Alpine component shape for the ledger panel (`x-data="ledgerPanel"`). */
interface LedgerPanelComponent {
  /** View-model rows for the x-for template, honoring the opType filter. */
  readonly rows: LedgerRow[];
  filter: string;
  readonly statsText: string;
  anchor(): void;
}

/**
 * Alpine data factory for the ledger panel (`x-data="ledgerPanel"`).
 * Getters read the reactive store, so Alpine effects track them; methods
 * delegate to the module functions above.
 */
export function ledgerPanel(): LedgerPanelComponent {
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

    set filter(value: string) {
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

function initLedgerPanel(): void {
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

function refreshLedger(): void {
  loadActivities();
}

export { initLedgerPanel, refreshLedger };
