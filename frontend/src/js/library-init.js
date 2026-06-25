/**
 * Library Page Initializer
 *
 * Mirrors engine/studio-init.js: top-level script, no CSP unsafe-inline needed.
 */

import { on, EVENTS } from "./events/bus.js";
import {
  initWallet,
  autoConnectWallet,
  connectWallet,
  contract as walletContract,
} from "./blockchain/wallet.js";
import { CHAIN_IDS } from "./constants/chains.js";
import { initWalletPopover } from "./ui/wallet-popover.js";
import { initTheme, toggleTheme } from "./engine/theme.js";
import { walletState } from "./state/wallet-state.js";
import { libraryState } from "./state/library-state.js";
import { truncateAddress } from "./utils/format.js";
import { getCachedSession } from "./services/api.js";
import { getFromRemoteIPFS } from "./ipfs/remote-ipfs.js";
import {
  fetchAssetLibrary,
  expandTokenToAssets,
} from "./ui/asset-library.js";
import { initLibraryGrid } from "./ui/library-grid.js";
import { initLibraryToolbar } from "./ui/library-toolbar.js";
import { initLibraryContextMenu } from "./ui/library-context-menu.js";

function applyWalletGate(connected) {
  const gate = document.getElementById("libraryGate");
  const main = document.getElementById("libraryMain");
  if (!gate || !main) return;
  gate.classList.toggle("hidden", connected);
  main.classList.toggle("hidden", !connected);

  const createBtn = document.getElementById("libraryCreateCollectionBtn");
  const uploadBtn = document.getElementById("libraryUploadBtn");
  if (createBtn) createBtn.hidden = !connected;
  if (uploadBtn) uploadBtn.hidden = !connected;
}

function updateWalletButtonState(address, isAuthenticated) {
  const d = document.getElementById("disconnectWalletBtn");
  if (!d) return;
  const text = d.querySelector("span") || d;
  if (!address) {
    if (text) text.textContent = "Disconnect";
    return;
  }
  const truncated = truncateAddress(address);
  if (text) {
    text.textContent = isAuthenticated ? truncated : `${truncated} • Sign In`;
  }
  d.classList.toggle("auth-required", !isAuthenticated);
}

function extractThumbnailCid(thumbnail) {
  if (!thumbnail) return "";
  if (typeof thumbnail === "string") return thumbnail;
  return thumbnail.cid || thumbnail.source?.cid || "";
}

/**
 * Derive the wallet's default collection token ID. Matches the contract and
 * create-panel.js/asset-save.js derivation so the UI can label it "Default".
 */
function deriveDefaultCollectionId(walletAddr) {
  if (!walletAddr || !window.Web3?.utils?.soliditySha3) return null;
  return window.Web3.utils.soliditySha3({
    type: "address",
    value: walletAddr,
  });
}

async function fetchCollectionMetadata(tokenId) {
  const c = walletContract || walletState.get().contract;
  if (!c) return null;
  try {
    const cid = await c.methods.tokenURI(tokenId).call();
    if (!cid) return null;
    const manifest = await getFromRemoteIPFS(cid);
    return {
      tokenId: String(tokenId),
      manifestCid: cid,
      name: manifest?.name || `Collection #${tokenId}`,
      thumbnail: manifest?.thumbnail || null,
    };
  } catch (err) {
    console.warn(`[LIBRARY] Failed to load collection metadata for ${tokenId}`, err);
    return null;
  }
}

async function isTokenOwnedBy(tokenId, address) {
  const c = walletContract || walletState.get().contract;
  if (!c || !address) return false;
  try {
    const owner = await c.methods.ownerOf(tokenId).call();
    return owner.toLowerCase() === address.toLowerCase();
  } catch {
    return false;
  }
}

async function buildCollectionEntries(tokenIds, role, walletAddr) {
  const entries = await Promise.all(
    tokenIds.map((tokenId) => fetchCollectionMetadata(tokenId))
  );
  const defaultIdHex = deriveDefaultCollectionId(walletAddr);
  // tokenIds come from the contract as decimal strings; soliditySha3 returns hex.
  const defaultId = defaultIdHex ? BigInt(defaultIdHex).toString() : null;
  return entries
    .filter(Boolean)
    .map((meta) => {
      const isDefault = defaultId && String(meta.tokenId) === defaultId;
      return {
        id: `collection-${meta.tokenId}`,
        type: "collection",
        tokenId: meta.tokenId,
        manifestCid: meta.manifestCid,
        name: isDefault
          ? "Default"
          : meta.name || `Collection #${meta.tokenId}`,
        thumbnailCid: extractThumbnailCid(meta.thumbnail),
        status: "besked",
        role,
      };
    });
}

async function loadCurrentAssets() {
  const state = libraryState.get();
  const tokenId = state.currentCollectionTokenId;
  if (!tokenId) {
    libraryState.set({ assets: [] });
    return;
  }

  libraryState.set({ isLoading: true });
  try {
    const collection = state.collections.find(
      (c) => String(c.tokenId) === String(tokenId)
    );
    const role = collection?.role || "owner";
    const entries = await expandTokenToAssets(tokenId);
    const assets = entries.map((entry) => ({
      id: `asset-${entry.tokenId}-${entry.assetId}`,
      type: "asset",
      tokenId: entry.tokenId,
      assetId: entry.assetId,
      manifestCid: entry.manifestCid,
      name: entry.name || entry.assetId || `Asset`,
      thumbnailCid: extractThumbnailCid(entry.thumbnail),
      status: "besked",
      role,
    }));
    libraryState.set({ assets, isLoading: false });
  } catch (err) {
    console.error("[LIBRARY] Failed to load collection assets", err);
    libraryState.set({ assets: [], isLoading: false });
  }
}

export async function refreshLibraryData() {
  const { walletAddress } = walletState.get();
  if (!walletAddress) return;

  libraryState.set({ isLoading: true });
  try {
    const { owned, shared } = await fetchAssetLibrary(walletAddress);
    const [ownedEntries, sharedEntries] = await Promise.all([
      buildCollectionEntries(owned, "owner", walletAddress),
      buildCollectionEntries(shared, "editor", walletAddress),
    ]);
    const fetchedCollections = [...ownedEntries, ...sharedEntries];

    const currentState = libraryState.get();
    const currentTokenId = currentState.currentCollectionTokenId;

    // getPastEvents scans can lag behind a freshly mined mint on local nodes,
    // causing optimistic collections to disappear on refresh. Verify ownership
    // of any missing collections via ownerOf before dropping them.
    const missing = currentState.collections.filter(
      (current) =>
        !fetchedCollections.some(
          (fetched) => String(fetched.tokenId) === String(current.tokenId)
        )
    );
    const keptMissing = (
      await Promise.all(
        missing.map(async (current) => {
          const stillOwned = await isTokenOwnedBy(
            current.tokenId,
            walletAddress
          );
          return stillOwned ? current : null;
        })
      )
    ).filter(Boolean);
    const collections = [...fetchedCollections, ...keptMissing];

    const stillExists = collections.some(
      (c) => String(c.tokenId) === String(currentTokenId)
    );

    libraryState.set({
      collections,
      currentCollectionTokenId: stillExists ? currentTokenId : null,
      selectedIds: [],
      isLoading: false,
    });

    if (currentTokenId) {
      await loadCurrentAssets();
    }
  } catch (err) {
    console.error("[LIBRARY] Failed to refresh library data", err);
    libraryState.set({ isLoading: false });
  }
}

initTheme();
document.getElementById("themeToggle")?.addEventListener("click", toggleTheme);

initWallet();
autoConnectWallet();
document.getElementById("connectWalletBtn")?.addEventListener("click", connectWallet);
document.getElementById("libraryConnectBtn")?.addEventListener("click", connectWallet);
initWalletPopover();

initLibraryGrid();
initLibraryToolbar();
initLibraryContextMenu();
applyWalletGate(Boolean(walletState.get().walletAddress));

on(EVENTS.WALLET_CONNECTED, async (e) => {
  const c = document.getElementById("connectWalletBtn");
  const d = document.getElementById("disconnectWalletBtn");
  const netSel = document.getElementById("headerbarNetworkSelect");
  if (c) {
    c.classList.add("hidden");
    c.classList.remove("disconnected");
  }
  if (d) d.classList.remove("hidden");

  const address = e?.address || "";
  const cached = getCachedSession();
  const isAuth = cached && cached.address === address.toLowerCase();
  updateWalletButtonState(address, isAuth);
  applyWalletGate(true);

  // Green dot + sync network selector to current chain (matches studio-init.js)
  if (netSel) {
    netSel.classList.add("connected");
    const chainId = e?.chainId;
    const keyMap = {
      [CHAIN_IDS.HARDHAT_LOCAL]: "hardhat",
      [CHAIN_IDS.MEGAETH_TESTNET]: "megaethTestnet",
    };
    const key = keyMap[chainId];
    if (key) netSel.value = key;
  }

  await refreshLibraryData();
});

on(EVENTS.WALLET_DISCONNECTED, () => {
  const c = document.getElementById("connectWalletBtn");
  const d = document.getElementById("disconnectWalletBtn");
  const netSel = document.getElementById("headerbarNetworkSelect");
  if (c) {
    c.classList.remove("hidden");
    c.classList.add("disconnected");
  }
  if (d) {
    d.classList.add("hidden");
    d.classList.remove("auth-required");
  }
  updateWalletButtonState(null, false);
  // Gray dot when disconnected (matches studio-init.js)
  if (netSel) netSel.classList.remove("connected");
  applyWalletGate(false);
  libraryState.set({
    collections: [],
    assets: [],
    currentCollectionTokenId: null,
    selectedIds: [],
  });
});

on(EVENTS.USER_AUTHENTICATED, (e) => updateWalletButtonState(e?.address, true));
on(EVENTS.USER_AUTH_REQUIRED, (e) => updateWalletButtonState(e?.address, false));

let _lastLoadedCollectionTokenId = null;
on(EVENTS.LIBRARY_STATE_CHANGED, (state) => {
  const tokenId = state?.currentCollectionTokenId ?? null;
  if (tokenId !== _lastLoadedCollectionTokenId) {
    _lastLoadedCollectionTokenId = tokenId;
    loadCurrentAssets();
  }
});

on(EVENTS.ASSET_PUBLISHED, async () => {
  await refreshLibraryData();
});
