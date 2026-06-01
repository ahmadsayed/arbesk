/**
 * Arbesk Micro-Ledger Panel
 *
 * Collapsible studio panel showing the audit trail for the current asset.
 * Filters by operation type, supports pagination, and provides an
 * "Anchor Manifest" button to record the current CID on-chain.
 */

const OP_TYPE_CONFIG = {
  GENERATION: { label: "Generation", icon: "✦" },
  PARAMETRIC: { label: "Parametric", icon: "◐" },
  SAVE: { label: "Save", icon: "⬇" },
  PUBLISH: { label: "Publish", icon: "⬆" },
  THUMBNAIL: { label: "Thumbnail", icon: "◉" },
  MINT: { label: "Mint", icon: "◆" },
  TOKEN_URI_UPDATE: { label: "URI Update", icon: "↻" },
  TEAM_EDIT: { label: "Team", icon: "◈" },
  LOAD: { label: "Load", icon: "→" },
  REVERT: { label: "Revert", icon: "←" },
  SNAPSHOT: { label: "Snapshot", icon: "◎" },
};

// ─── DOM References ──────────────────────────────────────────────────────────

let panel, body, list, filterSelect, anchorBtn, statsEl;
let initialized = false;

function ensureDOM() {
  panel = document.getElementById("ledgerPanel");
  body = document.getElementById("ledgerBody");
  list = document.getElementById("ledgerList");
  filterSelect = document.getElementById("ledgerFilter");
  anchorBtn = document.getElementById("ledgerAnchorBtn");
  statsEl = document.getElementById("ledgerStats");
}

// ─── API ─────────────────────────────────────────────────────────────────────

async function fetchLedger(manifestId, opType = "") {
  const params = new URLSearchParams({ limit: "50" });
  if (manifestId) params.set("manifestId", manifestId);
  if (opType) params.set("opType", opType);
  const res = await fetch(`/api/ledger?${params}`);
  if (!res.ok) throw new Error(`Ledger API error: ${res.status}`);
  return res.json();
}

async function fetchStats() {
  const res = await fetch("/api/ledger/stats");
  if (!res.ok) return null;
  return res.json();
}

// ─── Rendering ───────────────────────────────────────────────────────────────

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
  const config = OP_TYPE_CONFIG[entry.opType] || {
    label: entry.opType,
    icon: "·",
  };

  const li = document.createElement("li");
  li.className = "ledger-entry";
  li.innerHTML = `
    <span class="ledger-entry-icon">${config.icon}</span>
    <span class="ledger-entry-type" title="${entry.opType}">${config.label}</span>
    <span class="ledger-entry-cid" title="${entry.cid}">${truncateCid(entry.cid)}</span>
    <span class="ledger-entry-actor" title="${entry.actorAddress}">${truncateAddress(entry.actorAddress)}</span>
    <span class="ledger-entry-time">${formatDate(entry.timestamp)} ${formatTime(entry.timestamp)}</span>
  `;
  return li;
}

function renderEntries(entries) {
  if (!list) return;
  list.innerHTML = "";
  if (entries.length === 0) {
    list.innerHTML =
      '<li class="ledger-empty">No operations recorded yet.</li>';
    return;
  }
  for (const entry of entries) {
    list.appendChild(renderEntry(entry));
  }
}

function renderStats(stats) {
  if (!statsEl || !stats) return;
  statsEl.textContent = `${stats.totalOperations} ops · ${stats.uniqueManifests} assets · ${stats.uniqueActors} actors`;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function refreshLedger() {
  try {
    const manifestId = window.activeAssetManifestCid
      ? (await resolveAssetId()) || ""
      : "";
    const opType = filterSelect?.value || "";
    const result = await fetchLedger(manifestId, opType);
    renderEntries(result.entries);

    const stats = await fetchStats();
    renderStats(stats);
  } catch (err) {
    console.warn("[LEDGER] refresh failed:", err.message);
    if (list) list.innerHTML = '<li class="ledger-empty">Ledger unavailable.</li>';
  }
}

async function resolveAssetId() {
  try {
    const cid = window.activeAssetManifestCid;
    if (!cid) return null;
    const { getFromRemoteIPFS } = await import("../ipfs/remote-ipfs.js");
    const manifest = await getFromRemoteIPFS(cid);
    return manifest?.asset_id || null;
  } catch {
    return null;
  }
}

async function onAnchorClick() {
  if (!anchorBtn) return;
  const manifestId = await resolveAssetId();
  const cid = window.activeAssetManifestCid;
  if (!manifestId || !cid) {
    alert("Save your asset first before anchoring.");
    return;
  }
  if (!window.walletAddress) {
    alert("Connect your wallet first.");
    return;
  }
  try {
    anchorBtn.disabled = true;
    anchorBtn.textContent = "Anchoring…";

    const { contract } = await import("../blockchain/wallet.js");
    const c = contract || window.contract;
    if (!c) throw new Error("Contract not available");
    const tx = await c.methods
      .anchorManifest(manifestId, cid)
      .send({ from: window.walletAddress });
    console.log(`[LEDGER] anchored manifest ${manifestId} → tx ${tx.transactionHash}`);
    anchorBtn.textContent = "Anchored ✓";
    setTimeout(refreshLedger, 2000);
  } catch (err) {
    console.error("[LEDGER] anchor failed:", err);
    alert("Anchor failed: " + err.message);
    anchorBtn.textContent = "Anchor Manifest";
  } finally {
    anchorBtn.disabled = false;
  }
}

// ─── Toggle ──────────────────────────────────────────────────────────────────

function togglePanel() {
  if (!panel) return;
  panel.classList.toggle("collapsed");
  if (!panel.classList.contains("collapsed")) {
    refreshLedger();
  }
}

// ─── Init ────────────────────────────────────────────────────────────────────

function initLedgerPanel() {
  if (initialized) return;
  ensureDOM();
  if (!panel) return;

  // Toggle button
  const toggleBtn = document.getElementById("ledgerPanelToggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", togglePanel);
  }

  // Close button inside panel
  const closeBtn = panel.querySelector(".ledger-panel-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => panel.classList.add("collapsed"));
  }

  // Filter dropdown
  if (filterSelect) {
    filterSelect.addEventListener("change", refreshLedger);
  }

  // Anchor button
  if (anchorBtn) {
    anchorBtn.addEventListener("click", onAnchorClick);
  }

  // Refresh on relevant events
  document.addEventListener("asset:draftSaved", () => refreshLedger());
  document.addEventListener("asset:published", () => refreshLedger());
  document.addEventListener("scene:ready", () => refreshLedger());

  initialized = true;
}

export { initLedgerPanel, refreshLedger, togglePanel };
