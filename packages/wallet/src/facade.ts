/**
 * @arbesk/wallet facade — createWalletFacade: sign, getSiwe, getMerkleProof
 *   over an injected Signer (EOA or CDP).
 * @remarks The facade is signer-agnostic: it never branches on wallet kind.
 */
import type { Signer, UserIdentity } from "./types.ts";
import { buildSiweMessage, generateNonce } from "./siwe.ts";
import { getProof, type EditorEntry } from "./merkle.ts";

export interface SiweProof {
  kind: "siwe";
  message: string;
  signature: string;
  eoaAddress: string;
}

export interface GetSiweOptions {
  domain: string;
  chainId: number;
  statement?: string;
}

export interface GetMerkleProofOptions {
  tokenId: string | number;
  /** Full editor list fetched from IPFS via the token's editorListURI. */
  editors: EditorEntry[];
  /** On-chain editorSetVersion[tokenId]. */
  editorSetVersion: string | number;
  /** Optional minimum role the signer must hold (1=Viewer, 2=Editor). */
  role?: number;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Builds a UserIdentity for a connected wallet.
 * @remarks Identity is the "who" and the Signer is the "how-on-chain"; they
 *   are stored separately so an OAuth login can have identity without a signer.
 */
export function buildUserIdentity(opts: {
  address: string;
  email?: string | null;
  source: "cdp" | "walletconnect" | "injected" | null;
}): UserIdentity {
  return {
    id: opts.address.toLowerCase(),
    kind: "ethereum-address",
    displayName: opts.email || shortAddress(opts.address),
    email: opts.email || undefined,
  };
}

export interface WalletFacade {
  /** Sign an arbitrary UTF-8 message (EIP-191 personal_sign semantics). */
  sign(message: string): Promise<string>;
  /** Build + sign the SIWE proof for session creation. */
  getSiwe(opts: GetSiweOptions): Promise<SiweProof>;
  /** @remarks Pure: the editor list and version are supplied, so no chain/IPFS
   *  reads happen here. */
  getMerkleProof(opts: GetMerkleProofOptions): string[];
}

/**
 * Builds and signs a SIWE proof for a raw Signer.
 * @remarks Standalone form of the facade's getSiwe, so callers with a raw
 *   Signer can produce a proof without a WalletFacade.
 */
export async function buildSiweProof(opts: {
  signer: Signer;
  domain: string;
  chainId: number;
  statement?: string;
  /** On-chain owner address (defaults to signer.getAddress()). */
  address?: string;
}): Promise<SiweProof> {
  const address = opts.address ?? opts.signer.getAddress();
  const message = buildSiweMessage(
    opts.domain,
    address,
    generateNonce(),
    opts.chainId,
    opts.statement,
  );
  const signature = await opts.signer.signMessage(message);
  return {
    kind: "siwe",
    message,
    signature,
    eoaAddress: opts.signer.getSignerAddress(),
  };
}

export function createWalletFacade({ signer }: { signer: Signer }): WalletFacade {
  return {
    sign: (message) => signer.signMessage(message),

    getSiwe: ({ domain, chainId, statement }) =>
      buildSiweProof({ signer, domain, chainId, statement }),

    getMerkleProof: ({ tokenId, editors, editorSetVersion, role }) => {
      const result = getProof(
        editors,
        signer.getAddress(),
        tokenId,
        editorSetVersion,
      );
      if (!result) {
        throw new Error(
          `getMerkleProof: signer ${signer.getAddress()} is not in the editor list for token ${tokenId}`,
        );
      }
      if (role !== undefined && result.role < role) {
        throw new Error(
          `getMerkleProof: signer role ${result.role} is below the required ${role}`,
        );
      }
      return result.proof;
    },
  };
}
