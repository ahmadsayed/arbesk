/**
 * Port + config types for @arbesk/authz. No runtime code here.
 */
export interface ChainReadPort {
  ownerOf(tokenId: string): Promise<string>;
  editorRoot(tokenId: string): Promise<string>;
  editorSetVersion(tokenId: string): Promise<string>;
  tokenURI(tokenId: string): Promise<string>;
}

export interface AssetAccessOptions {
  /** Merkle proof (bytes32 hex strings). */
  proof?: string[];
  /** Claimed collaborator role (1=Viewer, 2=Editor). */
  requiredRole?: number;
  /** Explicit contract address override. */
  contractAddress?: string;
  /** Editor-grant scope: `bytes32(0)` = collection-wide, `keccak256(assetId)` = asset-scoped. */
  assetScope?: string;
}

export interface AssetAccessResult {
  allowed: boolean;
  assetId: string;
  chainId: number | null;
  isOwner: boolean;
  role: number;
}

/** A contract resolved for a chain, with its read port. */
export interface ResolvedContract {
  chainId: number | null;
  contractAddress: string;
  chain: ChainReadPort;
}

export interface AuthzConfig {
  validateSession: (token: string) => string | null;
  defaultChainId: number;
  resolveContract(chainId: number | null, contractAddressOverride?: string): ResolvedContract;
}
