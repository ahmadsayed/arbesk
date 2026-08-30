/**
 * Environment adapters: the host half of the asset-core ports for the CLI.
 * listTokens → backend indexer; tokenURI → viem readContract; IPFS → gateway
 * (reads, auto-gunzip) and backend-minted upload credentials (writes,
 * gzip-compressed) — kubo-api locally, Pinata presigned-put on testnet.
 */
import { createPublicClient, http } from "viem";
import { encodePacked, keccak256 } from "viem/utils";
import type { PublicClient, Address } from "viem";
import { gzipSync, gunzipSync } from "zlib";
import { uploadToIPFSWithCredential } from "@arbesk/asset-core/storage/ipfs/upload-with-credential.js";
import type { UploadCredential } from "@arbesk/asset-core/storage/ipfs/upload-with-credential.js";
import { BACKEND_URL, CHAIN_ID } from "./config.ts";
import { debug, trace } from "./debug.ts";
import { loadSession } from "./session.ts";

export interface BackendConfig {
  contractAddress: string;
  ipfsGatewayUrl: string;
  networkConfigs: Record<number, { contractAddress: string; rpcUrl: string }>;
}

let _config: BackendConfig | null = null;
export async function getBackendConfig(): Promise<BackendConfig> {
  if (_config) return _config;
  debug("backend config fetch:", BACKEND_URL);
  const res = await fetch(BACKEND_URL + "/api/v1/config");
  _config = (await res.json()) as BackendConfig;
  return _config;
}

const TOKEN_URI_ABI = [
  { name: "tokenURI", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "string" }] },
];

let _client: PublicClient | null = null;
async function publicClient(): Promise<PublicClient> {
  if (_client) return _client;
  const cfg = await getBackendConfig();
  const rpcUrl = cfg.networkConfigs[CHAIN_ID]?.rpcUrl || process.env.ARBESK_RPC_URL;
  if (!rpcUrl) throw new Error("No RPC URL for chain " + CHAIN_ID);
  _client = createPublicClient({ transport: http(rpcUrl) });
  return _client;
}

export function createCollectionReadPort() {
  return {
    tokenURI: async (tokenId: string, chainId?: number) => {
      debug("tokenURI read: token", tokenId);
      const cfg = await getBackendConfig();
      const client = await publicClient();
      const address =
        cfg.networkConfigs[chainId ?? CHAIN_ID]?.contractAddress ?? cfg.contractAddress;
      const uri = await client.readContract({
        address: address as Address,
        abi: TOKEN_URI_ABI,
        functionName: "tokenURI",
        args: [BigInt(tokenId)],
      });
      return String(uri);
    },
    listTokens: async (opts: { address: string; chainId?: number; scope: "owned" | "shared" }) => {
      const q =
        "address=" +
        encodeURIComponent(opts.address) +
        "&chainId=" +
        (opts.chainId ?? CHAIN_ID);
      const res = await fetch(BACKEND_URL + "/api/v1/indexer/" + opts.scope + "?" + q);
      const body = (await res.json()) as Record<string, unknown>;
      const tokens = (body[opts.scope] ?? []) as string[];
      debug("indexer", opts.scope + ":", tokens.length, "tokens");
      return tokens;
    },
  };
}

function isGzipped(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export function createIpfsReadPort(gatewayUrl: string) {
  // Gateway URLs differ: local Kubo is "http://127.0.0.1:8080" (append /ipfs/),
  // Pinata is "https://…mypinata.cloud/ipfs/" (already has /ipfs/). Handle both.
  const urlFor = (cid: string) => {
    const base = gatewayUrl.replace(/\/+$/, "");
    return base.endsWith("/ipfs") ? base + "/" + cid : base + "/ipfs/" + cid;
  };
  // Every asset-core read (tokenURI manifest, version-chain walk, asset
  // manifests, buffers) funnels through here — one instrumented fetch covers
  // the whole manifest exploration tree in verbose mode.
  const fetchRaw = async (cid: string): Promise<Uint8Array> => {
    return trace("ipfs fetch " + cid, async () => {
      const res = await fetch(urlFor(cid));
      const buf = new Uint8Array(await res.arrayBuffer());
      debug("ipfs http", res.status, buf.length + " bytes", isGzipped(buf) ? "(gzipped)" : "");
      return buf;
    });
  };
  return {
    getJSON: async (cid: string) => {
      const buf = await fetchRaw(cid);
      const plain = isGzipped(buf) ? new Uint8Array(gunzipSync(buf)) : buf;
      return JSON.parse(new TextDecoder().decode(plain));
    },
    getBytes: async (cid: string) => {
      const buf = await fetchRaw(cid);
      const plain = isGzipped(buf) ? new Uint8Array(gunzipSync(buf)) : buf;
      return plain.buffer;
    },
    getRawBytes: async (cid: string) => {
      const buf = await fetchRaw(cid);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  };
}

async function toBytes(data: unknown): Promise<Uint8Array> {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  throw new Error("besk: unsupported write data type");
}

/** Mint one upload credential from the backend with the CLI session token. */
async function mintUploadCredential(): Promise<UploadCredential> {
  const s = loadSession();
  if (!s) throw new Error("Not logged in. Run `besk login <email>`.");
  debug("minting IPFS upload credential");
  const res = await fetch(BACKEND_URL + "/api/v1/ipfs/upload-url", {
    method: "POST",
    headers: { Authorization: "Session " + s.token },
  });
  if (!res.ok) throw new Error("upload credential mint failed: " + res.status);
  return (await res.json()) as UploadCredential;
}

/**
 * Write port: every upload goes through a backend-minted credential, so the
 * same code path serves local dev (kubo-api strategy) and testnet (Pinata
 * presigned-put). Presigned URLs are single-use — only a credential that
 * declares itself reusable (kubo) is cached.
 */
export function createIpfsWritePort() {
  let reusable: UploadCredential | null = null;
  const credentialFor = async (): Promise<UploadCredential> => {
    if (reusable) return reusable;
    const c = await mintUploadCredential();
    if (c.strategy === "kubo-api" && c.reusable !== false) reusable = c;
    return c;
  };
  return {
    write: async (data: unknown, filename?: string, _credential?: unknown, options?: { compress?: boolean }) => {
      let bytes = await toBytes(data);
      if (options?.compress !== false) bytes = new Uint8Array(gzipSync(bytes));
      return trace("ipfs write " + (filename ?? "blob") + " (" + bytes.length + " bytes)", async () =>
        uploadToIPFSWithCredential(bytes, (filename ?? "blob") + ".gz", await credentialFor()));
    },
    writeJSON: async (json: Record<string, unknown>) => {
      const bytes = new Uint8Array(gzipSync(Buffer.from(JSON.stringify(json))));
      return trace("ipfs write manifest.json (" + bytes.length + " bytes)", async () =>
        uploadToIPFSWithCredential(bytes, "manifest.json.gz", await credentialFor()));
    },
  };
}

/**
 * Unpin an IPFS footprint (collection manifest chain, sources, thumbnails) via
 * the backend. The backend verifies on-chain ownership/editor rights, so this
 * must run while the token is still live — i.e. before a burn.
 */
export async function unpinCids(
  session: { token: string },
  cid: string,
  tokenId: string,
): Promise<{ count: number; errors?: string[] }> {
  return trace("unpin token=" + tokenId + " cid=" + cid, async () => {
    const cfg = await getBackendConfig();
    const res = await fetch(BACKEND_URL + "/api/v1/ipfs/unpin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Session " + session.token,
      },
      body: JSON.stringify({
        cid,
        tokenId: String(tokenId),
        chainId: CHAIN_ID,
        contractAddress: cfg.networkConfigs[CHAIN_ID]?.contractAddress ?? cfg.contractAddress,
      }),
    });
    const body = (await res.json()) as Record<string, any>;
    if (!res.ok) throw new Error(body?.error?.message ?? "unpin failed: HTTP " + res.status);
    debug("unpinned:", body.count, "CIDs");
    return body as { count: number; errors?: string[] };
  });
}

/**
 * viem-backed HashPort. Address values are lowercased before packing so the
 * output is byte-identical to Web3.utils.soliditySha3 (checksum-exempt) and to
 * packages/wallet/src/merkle.ts — the contract's expectation.
 */
export function createHashPort() {
  return {
    soliditySha3: (...args: any[]) =>
      keccak256(
        encodePacked(
          args.map((a: any) => a.type) as any,
          args.map((a: any) =>
            a.type === "address" ? String(a.value).toLowerCase() : a.value
          ) as any,
        ),
      ),
    keccak256: (data: any) => keccak256(data),
  };
}
