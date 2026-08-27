import { getRuntime } from "../../runtime.ts";
import type { UploadCredential } from "../../storage/ipfs/upload-with-credential.ts";
import { compose } from "./composer.ts";
import { decompose as decomposeMain, isComposite } from "./decomposer.ts";
import { decompose as decomposeGlbMain, isGLB } from "./glb-parser.ts";
import { editSourceColors as editSourceColorsMain } from "./source-color-editor.ts";
import type { DecomposeResult } from "../codec.ts";

type PooledUploadCredential = UploadCredential;

function credentialPort() {
  const c = getRuntime().credentials;
  if (!c) {
    throw new Error(
      "asset-core: upload requires a CredentialPort (createArbeskCore({ credentials }))"
    );
  }
  return c;
}

async function checkExecutorAvailable() {
  return getRuntime().executor.available();
}

function sanitizeAsyncName(name: any) {
  return (
    String(name || "asset")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .slice(0, 40) || "asset"
  );
}

function estimateUploadCount(gltfJson: any) {
  return (gltfJson?.buffers?.length || 0) + (gltfJson?.images?.length || 0) + 1;
}

const GLB_MAGIC = 0x46546c67;
const GLB_HEADER_LENGTH = 12;
const GLB_CHUNK_HEADER_LENGTH = 8;

function estimateGlbUploadCount(arrayBuffer: ArrayBuffer) {
  try {
    const view = new DataView(arrayBuffer);
    if (view.getUint32(0, true) !== GLB_MAGIC) return 8;
    const jsonChunkLength = view.getUint32(GLB_HEADER_LENGTH, true);
    const jsonBytes = new Uint8Array(
      arrayBuffer,
      GLB_HEADER_LENGTH + GLB_CHUNK_HEADER_LENGTH,
      jsonChunkLength
    );
    return estimateUploadCount(
      JSON.parse(new TextDecoder().decode(jsonBytes))
    );
  } catch {
    return 8;
  }
}

const MAX_POOLED_CREDENTIALS = 200;

async function getPooledUploadCredential(count: number): Promise<PooledUploadCredential> {
  const clamped = Math.min(Math.max(count, 1), MAX_POOLED_CREDENTIALS);
  const credentials = await credentialPort().getUploadCredentials(clamped);
  const first = credentials[0];
  if (!first) {
    throw new Error("getPooledUploadCredential: no credentials returned");
  }
  if (first.reusable) return first;
  return {
    strategy: "presigned-put",
    gateway: first.gateway,
    urls: credentials.map((c) => (c.url as string)),
    reusable: true,
  };
}

function reserveFollowUpCredential(credential: PooledUploadCredential): {
  workerCredential: PooledUploadCredential;
  followUpCredential: PooledUploadCredential;
} {
  if (credential?.urls && credential.urls.length > 1) {
    const urls = credential.urls.slice();
    const reservedUrl = urls.pop();
    return {
      workerCredential: { ...credential, urls },
      followUpCredential: {
        strategy: "presigned-put",
        url: reservedUrl,
        gateway: credential.gateway,
        reusable: false,
      },
    };
  }
  return { workerCredential: credential, followUpCredential: credential };
}

export async function composeAsync(compositeJson: any): Promise<Uint8Array> {
  if (!compositeJson) throw new Error("composeAsync: gltfJson is null");

  if (await checkExecutorAvailable()) {
    try {
      const { composedBytes } = await getRuntime().executor.exec("compose", [
        { compositeJson },
      ]);
      return composedBytes as Uint8Array;
    } catch (error) {
      console.warn(
        "[ASYNC-GLTF] compose executor failed, falling back:",
        (error as Error).message
      );
    }
  }

  return compose(compositeJson);
}

function toArrayBuffer(input: unknown): ArrayBuffer | null {
  if (input instanceof ArrayBuffer) return input;
  if (input instanceof Uint8Array) {
    return input.buffer.slice(
      input.byteOffset,
      input.byteOffset + input.byteLength
    ) as ArrayBuffer;
  }
  return null;
}

export async function decomposeAsync(
  input: unknown,
  options: { assetName?: string; assetId?: string; dedupMap?: Map<string, string> | null; store?: boolean } = {}
): Promise<DecomposeResult> {
  const { assetName, assetId, dedupMap = null, store = true } = options;

  const bytes = toArrayBuffer(input);
  if (bytes && isGLB(bytes)) {
    return decomposeGlb(bytes, store, { assetName, assetId, dedupMap });
  }

  const gltf = bytes
    ? JSON.parse(new TextDecoder().decode(bytes))
    : (input as Record<string, unknown>);
  return decomposeGltf(gltf, { assetName, assetId, dedupMap });
}

async function decomposeGltf(
  gltfJson: any,
  options: { assetName?: string; assetId?: string; dedupMap?: Map<string, string> | null }
): Promise<DecomposeResult> {
  const { assetName, assetId, dedupMap = null } = options;
  const credential = await getPooledUploadCredential(
    estimateUploadCount(gltfJson)
  );
  const reusableCredential = credential?.reusable ? credential : null;

  if (reusableCredential && (await checkExecutorAvailable())) {
    try {
      const { workerCredential, followUpCredential } =
        reserveFollowUpCredential(reusableCredential);
      const { composite } = await getRuntime().executor.exec(
        "decomposeAndUploadGltf",
        [{ gltfJson, credential: workerCredential, options: { dedupMap } }]
      );
      const compositeCid = await getRuntime().ipfsWrite.writeJSON(
        composite,
        followUpCredential,
        {
          compress: true,
          assetId,
          filename:
            assetName || assetId
              ? sanitizeAsyncName(assetName || assetId) + "_composite.gltf"
              : undefined,
        }
      );
      return { composite, compositeCid };
    } catch (error) {
      console.warn(
        "[ASYNC-GLTF] decomposeAndUploadGltf executor failed, falling back:",
        (error as Error).message
      );
    }
  }

  return decomposeMain(gltfJson, {
    compress: true,
    assetName,
    assetId,
    dedupMap,
    credential: reusableCredential,
    store: true,
  });
}

async function decomposeGlb(
  arrayBuffer: ArrayBuffer,
  storeComposite: boolean,
  options: { assetName?: string; assetId?: string; dedupMap?: Map<string, string> | null }
): Promise<DecomposeResult> {
  const { assetName, assetId, dedupMap = null } = options;
  const credential = await getPooledUploadCredential(
    estimateGlbUploadCount(arrayBuffer)
  );
  const reusableCredential = credential?.reusable ? credential : null;

  if (reusableCredential && (await checkExecutorAvailable())) {
    try {
      const { composite, compositeCid } = await getRuntime().executor.exec(
        "decomposeAndUploadGlb",
        [{
          arrayBuffer,
          credential: reusableCredential,
          options: {
            storeComposite,
            assetName,
            assetId,
            dedupMap,
          },
        }]
      );
      return { composite, compositeCid };
    } catch (error) {
      console.warn(
        "[ASYNC-GLTF] decomposeAndUploadGlb executor failed, falling back:",
        (error as Error).message
      );
    }
  }

  const { composite, compositeCid } = await decomposeGlbMain(
    arrayBuffer,
    undefined,
    {
      storeComposite,
      credential: reusableCredential,
      compress: true,
      assetName,
      assetId,
      dedupMap,
    }
  );
  return { composite, compositeCid };
}

export async function editSourceColorsAsync(
  sourceCid: string,
  nodeColors: any,
  options: { assetName?: string; assetId?: string; dedupMap?: Map<string, string> | null } = {}
) {
  const { assetName, assetId, dedupMap = null } = options;
  if (!sourceCid)
    throw new Error("editSourceColorsAsync: sourceCid is required");
  if (!nodeColors || Object.keys(nodeColors).length === 0) {
    return { sourceCid, modified: 0, skipped: 0 };
  }

  let gltf: any = null;
  let decomposedFromGlb = false;

  try {
    const buffer = await getRuntime().ipfsRead.getBytes(sourceCid);
    if (getRuntime().kernels.glb.isGLB(buffer)) {
      const { composite } = await decomposeGlb(buffer, false, {
        dedupMap,
      });
      gltf = composite;
      decomposedFromGlb = true;
    } else {
      gltf = JSON.parse(new TextDecoder().decode(buffer));
    }
  } catch (err) {
    console.warn(
      "[ASYNC-GLTF] failed to fetch " + sourceCid + ": " + (err as Error).message
    );
    throw err;
  }

  if (await checkExecutorAvailable()) {
    try {
      const result = await getRuntime().executor.exec("bakeSourceColors", [
        {
          gltfJson: gltf,
          nodeColors,
        },
      ]);
      gltf = result.bakedJson;
      const newCid = await getRuntime().ipfsWrite.writeJSON(gltf, null, {
        compress: true,
        assetId,
        filename:
          assetName || assetId
            ? (assetName || assetId) + "_colored.gltf"
            : undefined,
      });
      const out: {
        sourceCid: string;
        format: string;
        path?: string;
        modified: number;
        skipped: number;
      } = {
        sourceCid: newCid,
        format: "gltf",
        modified: result.modified,
        skipped: result.skipped,
      };
      if (decomposedFromGlb) out.path = "composite.gltf";
      return out;
    } catch (error) {
      console.warn(
        "[ASYNC-GLTF] bakeSourceColors executor failed, falling back:",
        (error as Error).message
      );
    }
  }

  return editSourceColorsMain(sourceCid, nodeColors, options);
}

export {
  isComposite,
  estimateUploadCount,
  estimateGlbUploadCount,
  reserveFollowUpCredential,
};
