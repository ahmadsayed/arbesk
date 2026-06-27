import { jest } from "@jest/globals";
import { createKuboAdapter } from "../../src/api/storage/kubo-adapter.js";
import { createPinataAdapter } from "../../src/api/storage/pinata-adapter.js";

describe("kubo adapter", () => {
  function fakeIpfs() {
    return {
      add: jest.fn(async () => ({ cid: { toString: () => "bafyFakeCid" } })),
      addAll: jest.fn(async function* () {
        // Simulate wrapWithDirectory: yields per-file results, then a root
        // node whose path is "" (the directory itself).
        yield { path: "composite.gltf", cid: { toString: () => "bafyFile1" } };
        yield { path: "buffer_0.bin", cid: { toString: () => "bafyFile2" } };
        yield { path: "", cid: { toString: () => "bafyDirRoot" } };
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
    expect(cid).toBe("bafyFakeCid");
    expect(ipfs.pin.add).toHaveBeenCalledWith("bafyFakeCid");
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
    expect(root).toBe("bafyDirRoot");
    // addAll must be called with path+content entries and wrapWithDirectory.
    expect(ipfs.addAll).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ path: "composite.gltf" }),
        expect.objectContaining({ path: "buffer_0.bin" }),
      ]),
      expect.objectContaining({ wrapWithDirectory: true }),
    );
    expect(ipfs.pin.add).toHaveBeenCalledWith("bafyDirRoot");
  });

  it("cat() concatenates the async-iterable chunks into a string", async () => {
    const a = createKuboAdapter(fakeIpfs(), {
      apiUrl: "http://127.0.0.1:5001",
      gatewayBase: "http://127.0.0.1:8080/ipfs/",
    });
    expect(await a.cat("bafyX")).toBe('{"hello":"world"}');
  });

  it("catBytes() returns raw bytes without text decoding", async () => {
    const a = createKuboAdapter(fakeIpfs(), {
      apiUrl: "http://127.0.0.1:5001",
      gatewayBase: "http://127.0.0.1:8080/ipfs/",
    });
    const bytes = await a.catBytes("bafyX");
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.toString("utf-8")).toBe('{"hello":"world"}');
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
    expect(await a.unpin("bafyX")).toBe(true);
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

  it("catBytes() returns raw bytes from the gateway", async () => {
    const savedFetch = global.fetch;
    const payload = Buffer.from('{"hello":"world"}', "utf-8");
    global.fetch = jest.fn(async () => ({
      ok: true,
      arrayBuffer: async () => payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
    }));
    try {
      const a = createPinataAdapter(fakePinata(), {
        gatewayBase: "https://gw.mypinata.cloud/ipfs/",
        uploadTtl: 60,
      });
      const bytes = await a.catBytes("bafyWorld");
      expect(Buffer.isBuffer(bytes)).toBe(true);
      expect(bytes.toString("utf-8")).toBe('{"hello":"world"}');
    } finally {
      global.fetch = savedFetch;
    }
  });

  it("cat() returns text from the gateway", async () => {
    const savedFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      text: async () => '{"hello":"world"}',
    }));
    try {
      const a = createPinataAdapter(fakePinata(), {
        gatewayBase: "https://gw.mypinata.cloud/ipfs/",
        uploadTtl: 60,
      });
      expect(await a.cat("bafyText")).toBe('{"hello":"world"}');
      expect(global.fetch).toHaveBeenCalledWith(
        "https://gw.mypinata.cloud/ipfs/bafyText",
        { cache: "no-store" },
      );
    } finally {
      global.fetch = savedFetch;
    }
  });

  it("cat() throws when the gateway responds with an error", async () => {
    const savedFetch = global.fetch;
    global.fetch = jest.fn(async () => ({ ok: false, status: 504 }));
    try {
      const a = createPinataAdapter(fakePinata(), {
        gatewayBase: "https://gw.mypinata.cloud/ipfs/",
        uploadTtl: 60,
      });
      await expect(a.cat("bafyFail")).rejects.toThrow("pinata gateway 504");
    } finally {
      global.fetch = savedFetch;
    }
  });

  it("catBytes() throws when the gateway responds with an error", async () => {
    const savedFetch = global.fetch;
    global.fetch = jest.fn(async () => ({ ok: false, status: 503 }));
    try {
      const a = createPinataAdapter(fakePinata(), {
        gatewayBase: "https://gw.mypinata.cloud/ipfs/",
        uploadTtl: 60,
      });
      await expect(a.catBytes("bafyFail")).rejects.toThrow("pinata gateway 503");
    } finally {
      global.fetch = savedFetch;
    }
  });

  it("add() propagates upload errors", async () => {
    const p = fakePinata();
    p.upload.public.file = jest.fn(async () => {
      throw new Error("pinata upload refused");
    });
    const a = createPinataAdapter(p, {
      gatewayBase: "https://gw.mypinata.cloud/ipfs/",
      uploadTtl: 60,
    });
    await expect(a.add("payload")).rejects.toThrow("pinata upload refused");
  });

  it("addDirectory() propagates upload errors", async () => {
    const p = fakePinata();
    p.upload.public.fileArray = jest.fn(async () => {
      throw new Error("pinata directory upload refused");
    });
    const a = createPinataAdapter(p, {
      gatewayBase: "https://gw.mypinata.cloud/ipfs/",
      uploadTtl: 60,
    });
    await expect(
      a.addDirectory([{ name: "x.bin", data: "x" }]),
    ).rejects.toThrow("pinata directory upload refused");
  });

  it("mintUploadCredential() propagates signed URL errors", async () => {
    const p = fakePinata();
    p.upload.public.createSignedURL = jest.fn(async () => {
      throw new Error("signing failed");
    });
    const a = createPinataAdapter(p, {
      gatewayBase: "https://gw.mypinata.cloud/ipfs/",
      uploadTtl: 60,
    });
    await expect(a.mintUploadCredential()).rejects.toThrow("signing failed");
  });

  it("unpin() propagates list errors", async () => {
    const p = fakePinata();
    p.files.public.list = jest.fn(() => ({
      cid: async () => {
        throw new Error("list failed");
      },
    }));
    const a = createPinataAdapter(p, {
      gatewayBase: "https://gw.mypinata.cloud/ipfs/",
      uploadTtl: 60,
    });
    await expect(a.unpin("bafyFail")).rejects.toThrow("list failed");
  });

  it("unpin() propagates delete errors", async () => {
    const p = fakePinata();
    p.files.public.delete = jest.fn(async () => {
      throw new Error("delete failed");
    });
    const a = createPinataAdapter(p, {
      gatewayBase: "https://gw.mypinata.cloud/ipfs/",
      uploadTtl: 60,
    });
    await expect(a.unpin("bafyFakeCid")).rejects.toThrow("delete failed");
  });

  it("listPinned() paginates through files and respects maxPages", async () => {
    const p = fakePinata();
    const previousEnv = process.env.PINATA_GC_MAX_PAGES;
    process.env.PINATA_GC_MAX_PAGES = "2";

    let page = 0;
    p.files.public.list = jest.fn(() => ({
      limit() {
        return this;
      },
      pageToken() {
        return this;
      },
      then(resolve) {
        page++;
        if (page === 1) {
          resolve({
            files: [{ id: "f1", cid: "cid-1" }],
            next_page_token: "token-1",
          });
        } else if (page === 2) {
          resolve({
            files: [{ id: "f2", cid: "cid-2" }],
            next_page_token: "token-2",
          });
        } else {
          resolve({
            files: [{ id: "f3", cid: "cid-3" }],
            next_page_token: null,
          });
        }
      },
    }));

    const a = createPinataAdapter(p, {
      gatewayBase: "https://gw.mypinata.cloud/ipfs/",
      uploadTtl: 60,
    });

    try {
      const cids = await a.listPinned();
      expect(cids).toEqual(["cid-1", "cid-2"]);
    } finally {
      process.env.PINATA_GC_MAX_PAGES = previousEnv;
    }
  });

  it("listPinned() skips entries without a cid", async () => {
    const p = fakePinata();
    p.files.public.list = jest.fn(() => ({
      limit() {
        return this;
      },
      pageToken() {
        return this;
      },
      then(resolve) {
        resolve({
          files: [{ id: "f1" }, { id: "f2", cid: "cid-2" }],
          next_page_token: null,
        });
      },
    }));

    const a = createPinataAdapter(p, {
      gatewayBase: "https://gw.mypinata.cloud/ipfs/",
      uploadTtl: 60,
    });
    expect(await a.listPinned()).toEqual(["cid-2"]);
  });

  it("gatewayBase() returns the configured gateway", async () => {
    const a = createPinataAdapter(fakePinata(), {
      gatewayBase: "https://gw.example.com/ipfs/",
      uploadTtl: 60,
    });
    expect(a.gatewayBase()).toBe("https://gw.example.com/ipfs/");
  });
});
