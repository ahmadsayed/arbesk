/** @jest-environment jsdom */
import { jest } from "@jest/globals";

async function loadModule(credential, uploadResponse) {
  jest.resetModules();
  const getUploadCredential = jest.fn(async () => credential);
  jest.unstable_mockModule("../../frontend/src/js/services/api.js", () => ({
    __esModule: true,
    getUploadCredential,
  }));
  const fetchMock = jest.fn(async () => uploadResponse);
  global.fetch = fetchMock;
  const mod = await import("../../frontend/src/js/ipfs/write-to-ipfs.js");
  return { mod, fetchMock, getUploadCredential };
}

describe("writeToIPFS - pinata mode", () => {
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

  it("reuses an explicitly provided credential and skips getUploadCredential", async () => {
    const explicit = { backend: "pinata", url: "https://uploads.pinata.cloud/explicit", gateway: "https://gw/ipfs/" };
    const { mod, fetchMock, getUploadCredential } = await loadModule(
      { backend: "pinata", url: "https://uploads.pinata.cloud/signed", gateway: "https://gw/ipfs/" },
      { ok: true, json: async () => ({ data: { cid: "bafyExplicit", id: "id-2" } }) },
    );
    const cid = await mod.writeToIPFS("hello", "asset.bin", explicit);
    expect(cid).toBe("bafyExplicit");
    expect(getUploadCredential).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toBe("https://uploads.pinata.cloud/explicit");
  });
});

describe("writeToIPFS - kubo mode", () => {
  it("POSTs multipart to the kubo /api/v0/add endpoint and returns the hash", async () => {
    const { mod, fetchMock } = await loadModule(
      { backend: "kubo", apiUrl: "http://127.0.0.1:5001" },
      { ok: true, json: async () => ({ Hash: "bafyKubo", Size: "5" }) },
    );
    // second fetch (pin) also resolves ok
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ Hash: "bafyKubo", Size: "5" }) });
    const cid = await mod.writeToIPFS("hello", "asset.bin");
    expect(cid).toBe("bafyKubo");
    expect(fetchMock.mock.calls[0][0]).toMatch(/127\.0\.0\.1:5001\/api\/v0\/add/);
  });

  it("reuses an explicitly provided kubo credential and skips getUploadCredential", async () => {
    const explicit = { backend: "kubo", apiUrl: "http://127.0.0.1:5001", reusable: true };
    const { mod, fetchMock, getUploadCredential } = await loadModule(
      { backend: "kubo", apiUrl: "http://127.0.0.1:5001" },
      { ok: true, json: async () => ({ Hash: "bafyReuse", Size: "5" }) },
    );
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ Hash: "bafyReuse", Size: "5" }) });
    const cid = await mod.writeToIPFS("hello", "asset.bin", explicit);
    expect(cid).toBe("bafyReuse");
    expect(getUploadCredential).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toMatch(/127\.0\.0\.1:5001\/api\/v0\/add/);
  });
});

describe("writeJSONToIPFS", () => {
  it("passes an optional credential through to writeToIPFS", async () => {
    const explicit = { backend: "kubo", apiUrl: "http://127.0.0.1:5001", reusable: true };
    const { mod, fetchMock, getUploadCredential } = await loadModule(
      { backend: "kubo", apiUrl: "http://127.0.0.1:5001" },
      { ok: true, json: async () => ({ Hash: "bafyJson", Size: "10" }) },
    );
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ Hash: "bafyJson", Size: "10" }) });
    const cid = await mod.writeJSONToIPFS({ hello: "world" }, explicit);
    expect(cid).toBe("bafyJson");
    expect(getUploadCredential).not.toHaveBeenCalled();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toMatch(/127\.0\.0\.1:5001\/api\/v0\/add/);
  });
});
