import { jest } from "@jest/globals";
import { createKuboAdapter } from "../../src/api/storage/kubo-adapter.js";
import { createPinataAdapter } from "../../src/api/storage/pinata-adapter.js";

describe("kubo adapter", () => {
  function fakeIpfs() {
    return {
      add: jest.fn(async () => ({ cid: { toString: () => "QmFakeCid" } })),
      addAll: jest.fn(async function* () {
        // Simulate wrapWithDirectory: yields per-file results, then a root
        // node whose path is "" (the directory itself).
        yield { path: "composite.gltf", cid: { toString: () => "QmFile1" } };
        yield { path: "buffer_0.bin", cid: { toString: () => "QmFile2" } };
        yield { path: "", cid: { toString: () => "QmDirRoot" } };
      }),
      pin: {
        add: jest.fn(async () => {}),
        rm: jest.fn(async () => {}),
      },
      cat: jest.fn(async function* () {
        yield new TextEncoder().encode('{"hello":"world"}');
      }),
    };
  }

  it("add() stores, pins, and returns the cid string", async () => {
    const ipfs = fakeIpfs();
    const a = createKuboAdapter(ipfs, {
      apiUrl: "http://127.0.0.1:5001",
      gatewayBase: "http://127.0.0.1:8080/ipfs/",
    });
    const cid = await a.add("payload");
    expect(cid).toBe("QmFakeCid");
    expect(ipfs.pin.add).toHaveBeenCalledWith("QmFakeCid");
  });

  it("addDirectory() uploads files with wrapWithDirectory, pins and returns the root", async () => {
    const ipfs = fakeIpfs();
    const a = createKuboAdapter(ipfs, {
      apiUrl: "http://127.0.0.1:5001",
      gatewayBase: "http://127.0.0.1:8080/ipfs/",
    });
    const files = [
      { name: "composite.gltf", data: "{}" },
      { name: "buffer_0.bin", data: new Uint8Array([1, 2, 3]) },
    ];
    const root = await a.addDirectory(files);
    expect(root).toBe("QmDirRoot");
    // addAll must be called with path+content entries and wrapWithDirectory.
    expect(ipfs.addAll).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ path: "composite.gltf" }),
        expect.objectContaining({ path: "buffer_0.bin" }),
      ]),
      expect.objectContaining({ wrapWithDirectory: true }),
    );
    expect(ipfs.pin.add).toHaveBeenCalledWith("QmDirRoot");
  });

  it("cat() concatenates the async-iterable chunks into a string", async () => {
    const a = createKuboAdapter(fakeIpfs(), {
      apiUrl: "http://127.0.0.1:5001",
      gatewayBase: "http://127.0.0.1:8080/ipfs/",
    });
    expect(await a.cat("QmX")).toBe('{"hello":"world"}');
  });

  it("unpin() treats 'not pinned' as success", async () => {
    const ipfs = fakeIpfs();
    ipfs.pin.rm = jest.fn(async () => {
      throw new Error("not pinned or pinned indirectly");
    });
    const a = createKuboAdapter(ipfs, {
      apiUrl: "http://127.0.0.1:5001",
      gatewayBase: "http://127.0.0.1:8080/ipfs/",
    });
    expect(await a.unpin("QmX")).toBe(true);
  });

  it("mintUploadCredential() returns the kubo shape", async () => {
    const a = createKuboAdapter(fakeIpfs(), {
      apiUrl: "http://127.0.0.1:5001",
      gatewayBase: "http://127.0.0.1:8080/ipfs/",
    });
    expect(await a.mintUploadCredential()).toEqual({
      backend: "kubo",
      apiUrl: "http://127.0.0.1:5001",
      gateway: "http://127.0.0.1:8080/ipfs/",
      reusable: true,
    });
  });
});

describe("pinata adapter", () => {
  function fakePinata() {
    return {
      upload: {
        public: {
          file: jest.fn(async () => ({ id: "id-1", cid: "bafyFakeCid" })),
          fileArray: jest.fn(async () => ({ id: "id-dir", cid: "bafyDirRoot" })),
          createSignedURL: jest.fn(
            async () => "https://uploads.pinata.cloud/signed",
          ),
        },
      },
      files: {
        public: {
          list: jest.fn(() => ({
            cid: async (_c) => ({ files: [{ id: "id-1", cid: "bafyFakeCid" }] }),
          })),
          delete: jest.fn(async () => [{ id: "id-1", status: "OK" }]),
        },
      },
      gateways: { public: {} },
    };
  }

  it("add() uploads to public IPFS and returns the cid", async () => {
    const p = fakePinata();
    const a = createPinataAdapter(p, {
      gatewayBase: "https://gw.mypinata.cloud/ipfs/",
      uploadTtl: 60,
    });
    expect(await a.add("payload")).toBe("bafyFakeCid");
    expect(p.upload.public.file).toHaveBeenCalled();
  });

  it("addDirectory() uploads a file array and returns the directory root cid", async () => {
    const p = fakePinata();
    const a = createPinataAdapter(p, {
      gatewayBase: "https://gw.mypinata.cloud/ipfs/",
      uploadTtl: 60,
    });
    const files = [
      { name: "composite.gltf", data: "{}" },
      { name: "texture_0.png", data: new Uint8Array([1, 2]) },
    ];
    const root = await a.addDirectory(files);
    expect(root).toBe("bafyDirRoot");
    expect(p.upload.public.fileArray).toHaveBeenCalledTimes(1);
    // Each entry must be wrapped in a File with the right name.
    const arg = p.upload.public.fileArray.mock.calls[0][0];
    expect(arg).toHaveLength(2);
    expect(arg.map((f) => f.name).sort()).toEqual([
      "composite.gltf",
      "texture_0.png",
    ]);
  });

  it("mintUploadCredential() returns a presigned url and gateway, never the JWT", async () => {
    const p = fakePinata();
    const a = createPinataAdapter(p, {
      gatewayBase: "https://gw.mypinata.cloud/ipfs/",
      uploadTtl: 90,
    });
    const cred = await a.mintUploadCredential();
    expect(cred).toEqual({
      backend: "pinata",
      url: "https://uploads.pinata.cloud/signed",
      gateway: "https://gw.mypinata.cloud/ipfs/",
      reusable: false,
    });
    expect(p.upload.public.createSignedURL).toHaveBeenCalledWith({ expires: 90 });
    expect(JSON.stringify(cred)).not.toMatch(/jwt|JWT|Bearer/);
  });

  it("unpin() resolves cid -> file id(s) and deletes them", async () => {
    const p = fakePinata();
    const a = createPinataAdapter(p, {
      gatewayBase: "https://gw.mypinata.cloud/ipfs/",
      uploadTtl: 60,
    });
    expect(await a.unpin("bafyFakeCid")).toBe(true);
    expect(p.files.public.delete).toHaveBeenCalledWith(["id-1"]);
  });

  it("unpin() returns true when no file matches the cid", async () => {
    const p = fakePinata();
    p.files.public.list = jest.fn(() => ({ cid: async () => ({ files: [] }) }));
    const a = createPinataAdapter(p, {
      gatewayBase: "https://gw.mypinata.cloud/ipfs/",
      uploadTtl: 60,
    });
    expect(await a.unpin("bafyMissing")).toBe(true);
    expect(p.files.public.delete).not.toHaveBeenCalled();
  });
});
