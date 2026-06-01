/**
 * Arbesk glTF Buffer URI Translation
 * 
 * Backend-only write operations; frontend only reads (converts CID refs back to base64).
 * 
 * For Phase 1 (pragmatic): assets are stored as GLB binaries directly.
 * These helpers become active in Phase 2 when the full glTF JSON + CID-separated
 * buffer pipeline is wired to Babylon.js.
 */

import { getBase64FromRemoteIPFS } from '../ipfs/remote-ipfs.js';

const BASE64_PREFIX = "data:application/octet-stream;base64,";
const CID_PREFIX = "data:application/cid;base64,";

/**
 * Prepare glTF JSON for rendering: resolve CID references back to base64 data URIs.
 * Fetches buffer payloads from the private Kubo gateway via HTTP.
 */
async function convertToDataURI(gltf) {
    let cloned = JSON.parse(JSON.stringify(gltf));
    if (!cloned.buffers) return cloned;

    for (const buffer of cloned.buffers) {
        const current_uri = buffer.uri;
        if (current_uri && current_uri.startsWith(CID_PREFIX)) {
            const cid_uri = current_uri.replace(CID_PREFIX, "");
            const base64 = await getBase64FromRemoteIPFS(cid_uri);
            buffer.uri = BASE64_PREFIX + base64;
        }
    }
    return cloned;
}

/**
 * Convert base64 buffer URIs to CID references before storage.
 * This is a **backend** operation in Arbesk; kept here for data-format reference.
 */
async function convertURItoCID(gltf, saveToRemoteIPFS) {
    let cloned = JSON.parse(JSON.stringify(gltf));
    if (!cloned.buffers) return cloned;

    for (const buffer of cloned.buffers) {
        const current_uri = buffer.uri;
        if (current_uri && current_uri.startsWith(BASE64_PREFIX)) {
            const base64_data = current_uri.replace(BASE64_PREFIX, "");
            const cid = await saveToRemoteIPFS(base64_data);
            buffer.uri = CID_PREFIX + cid;
        }
    }
    return cloned;
}

export { convertToDataURI, convertURItoCID };
