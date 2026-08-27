/**
 * @arbesk/authz facade — createAuthz.
 *
 * Asset access policy (ownership or Merkle editor proof) on top of an injected
 * ChainReadPort + validateSession. Moved from src/api/authorization.ts; the
 * backend keeps the web3 contract wiring in its resolveContract adapter.
 */
import { makeLeaf, verifyEditorProof } from "@arbesk/wallet/merkle.js";
import type { AssetAccessOptions, AssetAccessResult, AuthzConfig } from "./types.ts";

const ZERO_ROOT =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export interface Authz {
  checkAssetAccess(
    tokenId: string | number,
    chainId: number | null,
    address: string,
    opts?: AssetAccessOptions,
  ): Promise<AssetAccessResult>;
  authorizeAssetAccess(
    token: string,
    tokenId: string | number,
    chainId: number | null,
    opts?: AssetAccessOptions,
  ): Promise<(AssetAccessResult & { address: string }) | null>;
  getTokenUri(
    tokenId: string | number,
    chainId: number | null,
    opts?: { contractAddress?: string },
  ): Promise<string>;
}

export function createAuthz(config: AuthzConfig): Authz {
  const { validateSession, defaultChainId, resolveContract } = config;

  async function checkAssetAccess(
    tokenId: string | number,
    chainId: number | null,
    address: string,
    opts: AssetAccessOptions = {},
  ): Promise<AssetAccessResult> {
    // Token IDs are uint256 and can exceed Number.MAX_SAFE_INTEGER.
    let id: bigint;
    try {
      id = BigInt(tokenId);
    } catch {
      throw new Error("Invalid tokenId");
    }
    if (id < 0n) {
      throw new Error("Invalid tokenId");
    }

    const { chainId: cid, contractAddress, chain } = resolveContract(
      chainId,
      opts.contractAddress,
    );

    const assetId = `${cid || defaultChainId}:${contractAddress}:${id.toString()}`;

    const owner = await chain.ownerOf(id.toString());
    const normalizedAddress = address.toLowerCase();
    if (owner.toLowerCase() === normalizedAddress) {
      return { allowed: true, assetId, chainId: cid, isOwner: true, role: 2 };
    }

    const { proof, requiredRole } = opts;
    if (Array.isArray(proof) && proof.length > 0 && requiredRole != null) {
      try {
        const [root, setVersion] = await Promise.all([
          chain.editorRoot(id.toString()),
          chain.editorSetVersion(id.toString()),
        ]);

        if (root && root !== ZERO_ROOT) {
          const leaf = makeLeaf(
            normalizedAddress,
            Number(requiredRole),
            id.toString(),
            setVersion.toString(),
          );
          if (verifyEditorProof(root, leaf, proof)) {
            return {
              allowed: true,
              assetId,
              chainId: cid,
              isOwner: false,
              role: Number(requiredRole),
            };
          }
        }
      } catch (err) {
        console.warn(
          `[AUTHZ] Merkle proof verification failed for ${assetId}:`,
          (err as Error).message,
        );
      }
    }

    return { allowed: false, assetId, chainId: cid, isOwner: false, role: 0 };
  }

  async function authorizeAssetAccess(
    token: string,
    tokenId: string | number,
    chainId: number | null,
    opts: AssetAccessOptions = {},
  ) {
    const address = validateSession(token);
    if (!address) return null;
    const access = await checkAssetAccess(tokenId, chainId, address, opts);
    return { ...access, address };
  }

  async function getTokenUri(
    tokenId: string | number,
    chainId: number | null,
    opts: { contractAddress?: string } = {},
  ): Promise<string> {
    const { chain } = resolveContract(chainId, opts.contractAddress);
    const uri = await chain.tokenURI(String(tokenId));
    return typeof uri === "string" ? uri : String(uri || "");
  }

  return { checkAssetAccess, authorizeAssetAccess, getTokenUri };
}
