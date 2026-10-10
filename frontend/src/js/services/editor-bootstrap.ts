/**
 * Initial editor-list bootstrap for a brand new token: the owner as sole
 * Editor, its Merkle root, and the list persisted to IPFS. Shared by the
 * publish path (asset-save/editor-publish) and collection mint
 * (library-ops); callers decide how to handle a failed IPFS write and do
 * their own saveEditorList bookkeeping.
 */

import { computeRoot } from "@arbesk/asset-core/formats/gltf/merkle-editors.js";
import { CollaboratorRole } from "../blockchain/wallet.ts";
import { writeJSONToIPFS } from "../ipfs/write-to-ipfs.ts";

/**
 * @returns editorList, its version-1 Merkle root, and the IPFS URI of the
 *   persisted list ("" when the write failed).
 */
export async function mintInitialEditorState(
  tokenId: string | number,
  walletAddr: string
) {
  const editorList = [{ address: walletAddr, role: CollaboratorRole.Editor }];
  const editorRoot = computeRoot(editorList, tokenId, 1);
  const editorListUri =
    (await writeJSONToIPFS(editorList, null as any, {
      compress: true,
      type: "editors",
      assetId: `token_${tokenId}_v1`,
    })) || "";
  return { editorList, editorRoot, editorListUri };
}
