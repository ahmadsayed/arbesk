/** @jest-environment jsdom */
import { jest } from "@jest/globals";

async function loadModule(credential, uploadResponse) {
  jest.resetModules();
  jest.unstable_mockModule("../../frontend/src/js/services/api.js", () => ({
    __esModule: true,
    getUploadCredential: jest.fn(async () => credential),
  }));
  const fetchMock = jest.fn(async () => uploadResponse);
  global.fetch = fetchMock;
  const mod = await import("../../frontend/src/js/ipfs/write-to-ipfs.js");
  return { mod, fetchMock };
}

describe("writeToIPFS — pinata mode", () => {
  it("POSTs the file to the presigned URL and returns the CIDv1", async () => {
    const { mod, fetchMock } = await loadModule(
      { backend: "pinata", url: "https://uploads.pinata.cloud/signed", gateway: "https://gw/ipfs/" },
      { ok: true, json: async () => ({ data: { cid: "bafyNew", id: "id-1" } }) },
    );
    const cid = await mod.writeToIPFS("hello", "asset.bin");
    expect(cid).toBe("bafyNew");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://uploads.pinata.cloud/signed");
    expect(opts.method).toBe("POST");
    expect(opts.body).toBeInstanceOf(FormData);
  });
});

describe("writeToIPFS — kubo mode", () => {
  it("POSTs multipart to the kubo /api/v0/add endpoint and returns the hash", async () => {
    const { mod, fetchMock } = await loadModule(
      { backend: "kubo", apiUrl: "http://127.0.0.1:5001" },
      { ok: true, json: async () => ({ Hash: "QmKubo", Size: "5" }) },
    );
    // second fetch (pin) also resolves ok
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ Hash: "QmKubo", Size: "5" }) });
    const cid = await mod.writeToIPFS("hello", "asset.bin");
    expect(cid).toBe("QmKubo");
    expect(fetchMock.mock.calls[0][0]).toMatch(/127\.0\.0\.1:5001\/api\/v0\/add/);
  });
});
