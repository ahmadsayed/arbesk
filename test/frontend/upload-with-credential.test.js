/** @jest-environment jsdom */
import { jest } from "@jest/globals";
import {
  uploadToIPFSWithCredential,
  uploadBatchToIPFSWithCredential,
} from "../../frontend/src/js/ipfs/upload-with-credential.js";

describe("uploadToIPFSWithCredential", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it("uploads a single file to Kubo and pins the CID", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Hash: "bafyOne", Size: "5" }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const cid = await uploadToIPFSWithCredential(
      new Uint8Array([1, 2, 3]),
      "one.bin",
      { backend: "kubo", apiUrl: "http://127.0.0.1:5001" }
    );

    expect(cid).toBe("bafyOne");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [addUrl, addOpts] = fetchMock.mock.calls[0];
    expect(addUrl).toBe("http://127.0.0.1:5001/api/v0/add?cid-version=1");
    expect(addOpts.method).toBe("POST");
    expect(addOpts.body).toBeInstanceOf(FormData);
  });

  it("uploads a single file to Pinata", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { cid: "bafyPinata" } }),
    });

    const cid = await uploadToIPFSWithCredential(
      "hello",
      "pin.txt",
      { backend: "pinata", url: "https://uploads.pinata.cloud/signed" }
    );

    expect(cid).toBe("bafyPinata");
    expect(fetchMock.mock.calls[0][0]).toBe("https://uploads.pinata.cloud/signed");
  });
});

describe("uploadBatchToIPFSWithCredential", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it("returns an empty map for an empty file list", async () => {
    const result = await uploadBatchToIPFSWithCredential(
      [],
      { backend: "kubo", apiUrl: "http://127.0.0.1:5001" }
    );
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("batch-uploads multiple files to Kubo in one multipart POST", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        [
          JSON.stringify({ Name: "a.bin", Hash: "bafyA", Size: "3" }),
          JSON.stringify({ Name: "b.bin", Hash: "bafyB", Size: "3" }),
        ].join("\n"),
    });

    const result = await uploadBatchToIPFSWithCredential(
      [
        { name: "a.bin", data: new Uint8Array([1, 2, 3]) },
        { name: "b.bin", data: new Uint8Array([4, 5, 6]) },
      ],
      { backend: "kubo", apiUrl: "http://127.0.0.1:5001" }
    );

    expect(result.get("a.bin")).toBe("bafyA");
    expect(result.get("b.bin")).toBe("bafyB");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "http://127.0.0.1:5001/api/v0/add?cid-version=1&wrap-with-directory=false"
    );
    expect(opts.method).toBe("POST");
    expect(opts.body).toBeInstanceOf(FormData);
  });

  it("falls back to parallel single uploads for Pinata", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cid: "bafyP1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cid: "bafyP2" }),
      });

    const result = await uploadBatchToIPFSWithCredential(
      [
        { name: "x.bin", data: new Uint8Array([1]) },
        { name: "y.bin", data: new Uint8Array([2]) },
      ],
      { backend: "pinata", url: "https://uploads.pinata.cloud/signed" }
    );

    expect(result.get("x.bin")).toBe("bafyP1");
    expect(result.get("y.bin")).toBe("bafyP2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
