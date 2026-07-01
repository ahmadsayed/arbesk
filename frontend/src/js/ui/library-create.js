// @ts-nocheck
/**
 * Optimistic collection-creation flow shared by the toolbar button and the
 * library context menu.
 *
 * The collection card appears with a "minting" spinner the moment the manifest
 * is written to IPFS, the mint transaction runs in the background, and the card
 * flips to confirmed on success or is removed if the transaction fails or the
 * user rejects the wallet prompt. This is identical for EOA and smart-account
 * (social login) wallets: on an EOA the card simply appears just before the
 * wallet popup, and rejecting the popup removes it again.
 */

import { libraryState } from "../state/library-state.js";
import { showToast } from "./toasts.js";
import { showDialog } from "./dialog.js";
import { createNamedCollection } from "../services/library-ops.js";

function announce(text) {
  const region = document.getElementById("libraryLiveRegion");
  if (region) region.textContent = text;
}

function collectionCardId(tokenId) {
  return `collection-${tokenId}`;
}

/**
 * Insert an optimistic "minting" collection card at the top of the list without
 * navigating into it. No-op if a card for this token already exists.
 * @returns {string} the card id
 */
function addPendingCollectionCard({ tokenId, manifestCid, name }) {
  const id = collectionCardId(tokenId);
  const existing = libraryState.get().collections;
  if (!existing.some((c) => String(c.tokenId) === String(tokenId))) {
    libraryState.set({
      collections: [
        {
          id,
          type: "collection",
          tokenId: String(tokenId),
          manifestCid,
          name,
          thumbnailCid: "",
          status: "minting",
          role: "owner",
          createdAt: Date.now(),
        },
        ...existing,
      ],
      selectedIds: [],
    });
  }
  return id;
}

/** Flip a pending collection card to the confirmed (besked) state. */
function markCollectionConfirmed(tokenId) {
  libraryState.set({
    collections: libraryState
      .get()
      .collections.map((c) =>
        String(c.tokenId) === String(tokenId) ? { ...c, status: "besked" } : c
      ),
  });
}

/** Remove an optimistic collection card (mint failed or the user cancelled). */
function removePendingCollectionCard(id) {
  libraryState.set({
    collections: libraryState.get().collections.filter((c) => c.id !== id),
    selectedIds: [],
  });
}

/**
 * Prompt for a name and create a collection optimistically. Resolves as soon as
 * the dialog is dismissed or the create has been kicked off — it never blocks
 * the caller on the mint transaction, which is reconciled in the background.
 */
export async function createCollectionFlow() {
  const name = await showDialog(
    "New Collection",
    "Choose a name for the new collection.",
    ""
  );
  if (!name) return;

  let pendingId = null;

  // Fire-and-forget: the card is shown via onPending and the result is
  // reconciled on the returned promise. We intentionally do not await the mint.
  createNamedCollection(name, {
    onPending: ({ tokenId, manifestCid }) => {
      pendingId = addPendingCollectionCard({ tokenId, manifestCid, name });
      announce(`Creating collection ${name}`);
    },
  })
    .then(({ tokenId, isNew }) => {
      if (!isNew) {
        announce(`Collection ${name} already exists`);
        showToast({
          type: "info",
          title: "Collection Already Exists",
          message: `"${name}" already exists in your library.`,
        });
        import("./library-controller.js").then(({ refreshLibraryData }) =>
          refreshLibraryData()
        );
        return;
      }
      // library-init.js no longer subscribes to ASSET_PUBLISHED, so a full refresh
      // does not run here; flip the card to confirmed directly for instant feedback.
      markCollectionConfirmed(tokenId);
      announce(`Created collection ${name}`);
      showToast({
        type: "success",
        title: "Collection Created",
        message: `"${name}" has been minted on-chain.`,
      });
    })
    .catch((err) => {
      console.error("[LIBRARY-CREATE] create collection failed:", err);
      if (pendingId) removePendingCollectionCard(pendingId);
      showToast({
        type: "error",
        title: "Create Collection Failed",
        message: err?.message || "Could not create the collection.",
      });
    });
}
