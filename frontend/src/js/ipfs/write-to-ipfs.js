/**
 * Arbesk Browser-Side IPFS Writer
 *
 * POSTs binary data to the private Kubo node at 127.0.0.1:5001.
 * Only works because both the browser and IPFS run on the same machine
 * in the development Docker setup.
 *
 * API: POST /api/v0/add with multipart/form-data
 * Returns: { Hash, Name, Size }
 */

const IPFS_API_URL =
  typeof process !== "undefined" && process.env?.IPFS_API_URL
    ? process.env.IPFS_API_URL
    : "http://127.0.0.1:5001";

/**
 * Write raw binary data to IPFS and return its CID (v0).
 *
 * @param {Uint8Array|ArrayBuffer|Blob|string} data - The data to store
 * @param {string} [filename="asset.bin"] - Hint for IPFS (doesn't affect CID)
 * @returns {Promise<string>} The IPFS CID (Qm...)
 */
export async function writeToIPFS(data, filename = "asset.bin") {
  let blob;
  if (data instanceof Blob) {
    blob = data;
  } else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
    blob = new Blob([data]);
  } else if (typeof data === "string") {
    blob = new Blob([data], { type: "application/octet-stream" });
  } else {
    throw new Error("writeToIPFS: unsupported data type");
  }

  const formData = new FormData();
  formData.append("file", blob, filename);

  console.log(
    `[IPFS-WRITE] posting ${blob.size} bytes to ${IPFS_API_URL}/api/v0/add`
  );

  const response = await fetch(`${IPFS_API_URL}/api/v0/add`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`IPFS add failed: ${response.status} — ${text}`);
  }

  const result = await response.json();
  console.log(`[IPFS-WRITE] stored → ${result.Hash} (${result.Size} bytes)`);

  // Explicitly pin for clarity (Kubo /add defaults pin=true, but this is defense-in-depth)
  try {
    const pinResponse = await fetch(
      `${IPFS_API_URL}/api/v0/pin/add?arg=${encodeURIComponent(result.Hash)}`,
      { method: "POST" }
    );
    if (pinResponse.ok) {
      console.log(`[IPFS-WRITE] pinned → ${result.Hash}`);
    } else {
      console.warn(
        `[IPFS-WRITE] pin failed (non-fatal): HTTP ${pinResponse.status}`
      );
    }
  } catch (pinErr) {
    console.warn(`[IPFS-WRITE] pin failed (non-fatal): ${pinErr.message}`);
  }

  return result.Hash;
}

/**
 * Write JSON data to IPFS and return its CID.
 *
 * @param {object} json - The JSON-serializable object
 * @returns {Promise<string>} The IPFS CID
 */
export async function writeJSONToIPFS(json) {
  const text = JSON.stringify(json, null, 2);
  return writeToIPFS(text, "composite.gltf");
}
