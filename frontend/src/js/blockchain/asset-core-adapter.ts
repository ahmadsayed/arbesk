/**
 * Browser platform ports for asset-core — HashPort (viem), StoragePort
 * (localStorage), and ChainPort (wallet.ts contract access + backend email
 * resolution). Lives outside asset-core by design: this file IS the
 * environment-specific implementation.
 */
import type { ChainPort, HashPort, StoragePort } from "../asset-core/types.ts";
import { encodePacked, keccak256 } from "viem/utils";
import { getActiveContract } from "./wallet.ts";
import { resolveUserEmail } from "../services/api.ts";

/**
 * HashPort backed by viem. `soliditySha3` mirrors Web3.utils.soliditySha3
 * semantics for the ONE argument shape the editor Merkle flow uses:
 * `{type, value}` pairs (abi-packed keccak256). No general ABI mapper —
 * plain-value inference is intentionally not implemented (YAGNI).
 */
export function createBrowserHashPort(): HashPort {
  return {
    soliditySha3: (...args: any[]) =>
      keccak256(
        encodePacked(
          args.map((a) => a.type) as any,
          // viem enforces EIP-55 checksums on mixed-case addresses where
          // Web3 did not; lowercase is checksum-exempt and encodes to the
          // same 20 bytes, keeping output byte-identical with Web3.
          args.map((a) =>
            a.type === "address" ? String(a.value).toLowerCase() : a.value
          ) as any
        )
      ),
    keccak256: (data) => keccak256(data),
  };
}

export function createBrowserStoragePort(): StoragePort {
  return {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: (key) => localStorage.removeItem(key),
  };
}

/**
 * ChainPort over the active wallet contract. The contract calls are the
 * exact ones that used to live in domain/editors.ts.
 */
export function createBrowserChainPort(): ChainPort {
  return {
    getEditorListURI: async (assetTag) => {
      const contract = getActiveContract();
      if (!contract) return null;
      const cid = await contract.methods.editorListURI(assetTag).call();
      return cid || null;
    },
    getEditorListVersion: async (assetTag) => {
      const contract = getActiveContract();
      if (!contract) return 1;
      const version = await contract.methods.editorSetVersion(assetTag).call();
      return Number(version);
    },
    resolveEmail: async (email) => {
      const result = await resolveUserEmail(email);
      if (!result.exists || !result.address) {
        throw new Error(`No wallet found for email: ${email}`);
      }
      return result.address;
    },
  };
}

export function createBrowserPlatformPorts(): {
  hash: HashPort;
  storage: StoragePort;
  chain: ChainPort;
} {
  return {
    hash: createBrowserHashPort(),
    storage: createBrowserStoragePort(),
    chain: createBrowserChainPort(),
  };
}
