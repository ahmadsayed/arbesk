/**
 * Optimistic collection-creation flow.
 * @remarks The card appears with a "minting" spinner as soon as the manifest
 *   is written to IPFS, then flips to confirmed on success or is removed if
 *   the mint fails or the user rejects the wallet prompt. Identical for EOA
 *   and smart-account wallets.
 * Used by the toolbar button and the library context menu.
 */

import { libraryState } from "../state/library-state.ts";
import { showToast } from "./toasts.ts";
import { showDialog } from "./dialog.ts";
import { createNamedCollection } from "../services/library-ops.ts";

function announce(text: string): void {
  const region = document.getElementById("libraryLiveRegion");
  if (region) region.textContent = text;
}

function collectionCardId(tokenId: string | number): string {
  return `collection-${tokenId}`;
}

/**
 * Inserts an optimistic "minting" collection card without navigating into it.
 * @remarks No-op if a card for this token already exists.
 */
function addPendingCollectionCard({
  tokenId,
  manifestCid,
  name,
}: {
  tokenId: string | number;
  manifestCid: string;
  name: string;
}): string {
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

/**
 * Flips a pending collection card to the confirmed state.
 */
function markCollectionConfirmed(tokenId: string | number): void {
  libraryState.set({
    collections: libraryState
      .get()
      .collections.map((c) =>
        String(c.tokenId) === String(tokenId) ? { ...c, status: "besked" } : c
      ),
  });
}

/**
 * Removes an optimistic collection card.
 * @remarks Removal happens on mint failure or user cancellation.
 */
function removePendingCollectionCard(id: string): void {
  libraryState.set({
    collections: libraryState.get().collections.filter((c) => c.id !== id),
    selectedIds: [],
  });
}

/**
 * Prompts for a name and creates a collection optimistically.
 * @remarks Resolves without waiting for the mint transaction, which is
 *   reconciled in the background.
 */
export async function createCollectionFlow(): Promise<void> {
  const name = await showDialog(
    "New Collection",
    "Choose a name for the new collection.",
    ""
  );
  if (!name) return;

  let pendingId: string | null = null;

  // Fire-and-forget: the card is shown via onPending and the result is
  // reconciled on the returned promise. We intentionally do not await the mint.
  createNamedCollection(name, {
    onPending: ({ tokenId, manifestCid }: { tokenId: string; manifestCid: string }) => {
      pendingId = addPendingCollectionCard({ tokenId, manifestCid, name });
      announce(`Creating collection ${name}`);
    },
  })
    .then(({ tokenId, isNew }: { tokenId: string; isNew: boolean }) => {
      if (!isNew) {
        announce(`Collection ${name} already exists`);
        showToast({
          type: "info",
          title: "Collection Already Exists",
          message: `"${name}" already exists in your library.`,
        });
        import("./library-controller.ts").then(({ refreshLibraryData }) =>
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
