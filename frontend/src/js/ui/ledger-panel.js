/**
 * Arbesk UI Activity Panel (Manifest-Driven)
 *
 * Derives the activity feed entirely from the asset manifest chain.
 * No localStorage. No server-side ledger. No event accumulation.
 * The manifest file (and its version chain via prev_manifest_cid)
 * is the single source of truth.
 */

const ACTIVITY_CONFIG = {
  GENERATION: { label: "Generation", icon: "✦" },
  PARAMETRIC: { label: "Parametric", icon: "◐" },
  SAVE: { label: "Save", icon: "⬇" },
  PUBLISH: { label: "Publish", icon: "⬆" },
  LOAD: { label: "Load", icon: "→" },
};

let body, list, filterSelect, statsEl, anchorBtn;
let initialized = false;
let activities = [];

function ensureDOM() {
  body = document.getElementById("ledgerBody");
  list = document.getElementById("ledgerList");
  filterSelect = document.getElementById("ledgerFilter");
  statsEl = document.getElementById("ledgerStats");
  anchorBtn = document.getElementById("ledgerAnchorBtn");
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function truncateCid(cid) {
  if (!cid) return "—";
  return `${cid.slice(0, 8)}…${cid.slice(-6)}`;
}

function truncateAddress(addr) {
  if (!addr || addr === "system") return addr || "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function renderEntry(entry) {
  const config = ACTIVITY_CONFIG[entry.opType] || {
    label: entry.opType,
    icon: "·",
  };

  const li = document.createElement("li");
  li.className = "ledger-entry";
  li.innerHTML = `
    <span class="ledger-entry-icon">${config.icon}</span>
    <span class="ledger-entry-type" title="${entry.opType}">${config.label}</span>
    <span class="ledger-entry-cid" title="${entry.cid}">${truncateCid(
      entry.cid
    )}</span>
    <span class="ledger-entry-actor" title="${
      entry.actorAddress
    }">${truncateAddress(entry.actorAddress)}</span>
    <span class="ledger-entry-time">${formatDate(entry.timestamp)} ${formatTime(
      entry.timestamp
    )}</span>
  `;
  return li;
}

function render() {
  if (!list) return;

  const opType = filterSelect?.value || "";
  const filtered = opType
    ? activities.filter((a) => a.opType === opType)
    : activities;

  list.innerHTML = "";
  if (filtered.length === 0) {
    list.innerHTML =
      '<li class="ledger-empty">No operations recorded yet.</li>';
    return;
  }
  for (const entry of filtered) {
    list.appendChild(renderEntry(entry));
  }

  if (statsEl) {
    const total = activities.length;
    const uniqueCids = new Set(
      activities.map((a) => a.cid).filter(Boolean)
    ).size;
    statsEl.textContent = `${total} ops · ${uniqueCids} assets`;
  }
}

/**
 * Extract activity entries from a manifest chain response.
 * The manifest chain is walked by the server via /api/v1/manifests/:cid/history,
 * which simply follows prev_manifest_cid links — no separate ledger store.
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
        manifestId: manifest.asset_id || manifest.manifest_id || "—",
        cid: manifestCid,
        prevCid: manifest.prev_manifest_cid || null,
        actorType: "USER",
        actorAddress: window.walletAddress || "system",
        payload: {
          version: manifest.version,
          nodeCount: manifest.nodes?.length || 0,
        },
      });
    }

    // Node-level history entries (generation, parametric)
    for (const node of manifest.nodes || []) {
      for (const h of node.history || []) {
        const key = `${node.node_id}-v${h.v}-${h.timestamp}`;
        if (seen.has(key)) continue;
        seen.add(key);

        entries.push({
          id: key,
          timestamp: h.timestamp || 0,
          opType: h.type?.toUpperCase() || "GENERATION",
          manifestId: manifest.asset_id || manifest.manifest_id || "—",
          cid: h.src?.cid || manifestCid,
          prevCid: null,
          actorType: "USER",
          actorAddress: h.txHash ? window.walletAddress || "system" : "system",
          payload: {
            prompt: h.prompt,
            provider: h.provider,
            txHash: h.txHash,
            nodeId: node.node_id,
            params: h.params,
          },
        });
      }
    }
  }

  // Most recent first
  return entries.sort((a, b) => b.timestamp - a.timestamp);
}

async function loadActivities() {
  const cid = window.activeAssetManifestCid;
  if (!cid) {
    activities = [];
    render();
    return;
  }

  try {
    const { getManifestHistory } = await import("../services/api.js");
    const result = await getManifestHistory(cid);
    const chain = result?.chain || [];
    activities = extractActivities(chain);
  } catch (err) {
    console.warn("[LEDGER] failed to load manifest history:", err.message);
    activities = [];
  }

  render();
}

function onAnchorClicked() {
  console.warn("[LEDGER] anchorManifest() not available in current contract");
}

function initLedgerPanel() {
  if (initialized) return;
  ensureDOM();
  if (!body) return;

  if (filterSelect) {
    filterSelect.addEventListener("change", render);
  }

  if (anchorBtn) {
    anchorBtn.addEventListener("click", onAnchorClicked);
  }

  // Refresh when the scene changes or the asset is saved/published
  document.addEventListener("scene:ready", () => loadActivities());
  document.addEventListener("asset:draftSaved", () => loadActivities());
  document.addEventListener("asset:published", () => loadActivities());

  initialized = true;
  loadActivities();
}

function refreshLedger() {
  loadActivities();
}

export { initLedgerPanel, refreshLedger };
