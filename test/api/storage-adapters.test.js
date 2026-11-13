import { afterEach, beforeEach, describe, expect, it, jest, spyOn } from "bun:test";
import { createKuboAdapter } from "../../src/api/storage/kubo-adapter.ts";
import { createPinataAdapter } from "../../src/api/storage/pinata-adapter.ts";

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

  it("catHead() asks Kubo for the first bytes only and stops there", async () => {
    const ipfs = fakeIpfs();
    ipfs.cat = jest.fn(async function* () {
      yield new Uint8Array(600).fill(0x41);
      yield new Uint8Array(600).fill(0x42);
      throw new Error("read past the limit");
    });
    const a = createKuboAdapter(ipfs, { apiUrl: "http://127.0.0.1:5001", gatewayBase: "http://127.0.0.1:8080/ipfs/" });

    const head = await a.catHead("bafyX", 1024);

    expect(head.length).toBe(1024);
    expect(ipfs.cat).toHaveBeenCalledWith("bafyX", expect.objectContaining({ length: 1024 }));
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

  it("listPinned() returns recursive and direct pins, never indirect blocks", async () => {
    const ipfs = fakeIpfs();
    const byType = {
      recursive: ["bafyRoot1", "bafyRoot2"],
      direct: ["bafyDirect"],
      indirect: ["bafyChunk1", "bafyChunk2"],
    };
    ipfs.pin.ls = jest.fn(async function* ({ type } = {}) {
      const types = !type || type === "all" ? Object.keys(byType) : [type];
      for (const t of types) {
        for (const cid of byType[t]) yield { type: t, cid: { toString: () => cid } };
      }
    });
    const a = createKuboAdapter(ipfs, {
      apiUrl: "http://127.0.0.1:5001",
      gatewayBase: "http://127.0.0.1:8080/ipfs/",
    });
    expect(await a.listPinned()).toEqual([
      { cid: "bafyRoot1" },
      { cid: "bafyRoot2" },
      { cid: "bafyDirect" },
    ]);
  });

  it("pinnedBytes() returns the cumulative size under a root", async () => {
    const ipfs = fakeIpfs();
    ipfs.files = { stat: jest.fn(async () => ({ cumulativeSize: 4096n })) };
    const a = createKuboAdapter(ipfs, {
      apiUrl: "http://127.0.0.1:5001",
      gatewayBase: "http://127.0.0.1:8080/ipfs/",
    });

    expect(await a.pinnedBytes("bafyRoot1")).toBe(4096);
    expect(ipfs.files.stat).toHaveBeenCalledWith("/ipfs/bafyRoot1", { timeout: 5000 });
  });

  it("mintUploadCredential() returns the kubo shape", async () => {
    const a = createKuboAdapter(fakeIpfs(), {
      apiUrl: "http://127.0.0.1:5001",
      gatewayBase: "http://127.0.0.1:8080/ipfs/",
    });
    expect(await a.mintUploadCredential()).toEqual({
      strategy: "kubo-api",
      apiUrl: "http://127.0.0.1:5001",
      gateway: "http://127.0.0.1:8080/ipfs/",
      reusable: true,
    });
  });

  it("mintUploadCredentials(count) returns count copies of the reusable kubo credential", async () => {
    const a = createKuboAdapter(fakeIpfs(), {
      apiUrl: "http://127.0.0.1:5001",
      gatewayBase: "http://127.0.0.1:8080/ipfs/",
    });
    const creds = await a.mintUploadCredentials(3);
    expect(creds).toHaveLength(3);
    for (const cred of creds) {
      expect(cred).toEqual({
        strategy: "kubo-api",
        apiUrl: "http://127.0.0.1:5001",
        gateway: "http://127.0.0.1:8080/ipfs/",
        reusable: true,
      });
    }
  });
});

describe("pinata adapter", () => {
  function fakePinata() {
    let signCalls = 0;
    return {
      config: { pinataJwt: "jwt-test" },
      upload: {
        public: {
          file: jest.fn(async () => ({ id: "id-1", cid: "bafyFakeCid" })),
          fileArray: jest.fn(async () => ({ id: "id-dir", cid: "bafyDirRoot" })),
          createSignedURL: jest.fn(async () => {
            signCalls += 1;
            return `https://uploads.pinata.cloud/signed-${signCalls}`;
          }),
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
      gateways: {
        public: {
          get: jest.fn(async (cid) => ({
            data: `{"hello":"world","cid":"${cid}"}`,
            contentType: "application/json",
          })),
        },
      },
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
      strategy: "presigned-put",
      url: "https://uploads.pinata.cloud/signed-1",
      gateway: "https://gw.mypinata.cloud/ipfs/",
      reusable: false,
    });
    expect(p.upload.public.createSignedURL).toHaveBeenCalledWith({ expires: 90 });
    expect(JSON.stringify(cred)).not.toMatch(/jwt|JWT|Bearer/);
  });

  it("mintUploadCredentials(count) mints one signed URL per file in parallel", async () => {
    const p = fakePinata();
    const a = createPinataAdapter(p, {
      gatewayBase: "https://gw.mypinata.cloud/ipfs/",
      uploadTtl: 90,
    });
    const creds = await a.mintUploadCredentials(3);
    expect(creds).toHaveLength(3);
    expect(p.upload.public.createSignedURL).toHaveBeenCalledTimes(3);
    expect(p.upload.public.createSignedURL).toHaveBeenCalledWith({ expires: 90 });
    // Every credential gets a distinct URL, since Pinata signed URLs are single-use.
    const urls = creds.map((c) => c.url);
    expect(new Set(urls).size).toBe(3);
    for (const cred of creds) {
      expect(cred).toEqual({
        strategy: "presigned-put",
        url: expect.stringContaining("https://uploads.pinata.cloud/signed-"),
        gateway: "https://gw.mypinata.cloud/ipfs/",
        reusable: false,
      });
    }
    expect(JSON.stringify(creds)).not.toMatch(/jwt|JWT|Bearer/);
  });

  describe("catHead()", () => {
    let fetchSpy;

    beforeEach(() => {
      fetchSpy = spyOn(globalThis, "fetch");
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    function adapter() {
      return createPinataAdapter(fakePinata(), { gatewayBase: "https://gw.mypinata.cloud/ipfs/", uploadTtl: 60 });
    }

    it("asks the gateway for the first bytes only", async () => {
      fetchSpy.mockImplementationOnce(async () => new Response("glTF", { status: 206 }));

      const head = await adapter().catHead("bafyX", 1024);

      expect(head.toString()).toBe("glTF");
      expect(String(fetchSpy.mock.calls[0][0])).toBe("https://gw.mypinata.cloud/ipfs/bafyX");
      expect(fetchSpy.mock.calls[0][1].headers.Range).toBe("bytes=0-1023");
    });

    it("stops reading at the limit when the gateway ignores Range", async () => {
      fetchSpy.mockImplementationOnce(async () => new Response("x".repeat(100000), { status: 200 }));

      const head = await adapter().catHead("bafyX", 1024);

      expect(head.length).toBe(1024);
    });

    it("throws when the gateway refuses", async () => {
      fetchSpy.mockImplementationOnce(async () => new Response("nope", { status: 403 }));

      await expect(adapter().catHead("bafyX", 1024)).rejects.toThrow(/403/);
    });
  });

  describe("unpin() deletes", () => {
    let fetchSpy;
    const deleteUrls = () =>
      fetchSpy.mock.calls.filter(([, init]) => init?.method === "DELETE").map(([url]) => String(url));

    function respond(...statuses) {
      for (const status of statuses) {
        fetchSpy.mockImplementationOnce(async () =>
          new Response(status === 200 ? "{}" : `status ${status}`, {
            status,
            headers: status === 429 ? { "Retry-After": "0" } : {},
          }),
        );
      }
    }

    function adapter(p) {
      return createPinataAdapter(p, { gatewayBase: "https://gw.mypinata.cloud/ipfs/", uploadTtl: 60 });
    }

    beforeEach(() => {
      fetchSpy = spyOn(globalThis, "fetch");
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it("looks the cid's file id(s) up and deletes them", async () => {
      respond(200);
      expect(await adapter(fakePinata()).unpin("bafyFakeCid")).toBe(true);
      expect(deleteUrls()).toEqual(["https://api.pinata.cloud/v3/files/public/id-1"]);
      expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe("Bearer jwt-test");
    });

    it("reuses the file ids listPinned() saw instead of looking them up", async () => {
      const p = fakePinata();
      p.files.public.list = jest.fn(() => ({
        limit() {
          return this;
        },
        then(resolve) {
          resolve({ files: [{ id: "f1", cid: "cid-1", size: 10 }], next_page_token: null });
        },
      }));
      const a = adapter(p);
      await a.listPinned();
      respond(200);

      expect(await a.unpin("cid-1")).toBe(true);
      expect(p.files.public.list).toHaveBeenCalledTimes(1); // the listing only
      expect(deleteUrls()).toEqual(["https://api.pinata.cloud/v3/files/public/f1"]);
    });

    it("throws when Pinata refuses the delete", async () => {
      respond(403);
      await expect(adapter(fakePinata()).unpin("bafyFakeCid")).rejects.toThrow(/403/);
    });

    it("treats a file Pinata no longer has as unpinned", async () => {
      respond(404);
      expect(await adapter(fakePinata()).unpin("bafyFakeCid")).toBe(true);
    });

    it("retries a rate-limited delete", async () => {
      respond(429, 200);
      expect(await adapter(fakePinata()).unpin("bafyFakeCid")).toBe(true);
      expect(deleteUrls()).toHaveLength(2);
    });

    it("retries a server error after backing off", async () => {
      respond(503, 200);
      const start = Date.now();
      expect(await adapter(fakePinata()).unpin("bafyFakeCid")).toBe(true);
      expect(deleteUrls()).toHaveLength(2);
      expect(Date.now() - start).toBeGreaterThanOrEqual(450);
    });

    it("gives up after four rate-limited attempts", async () => {
      respond(429, 429, 429, 429);
      await expect(adapter(fakePinata()).unpin("bafyFakeCid")).rejects.toThrow(/HTTP 429/);
      expect(deleteUrls()).toHaveLength(4);
    });

    it("sends deletes to a configured endpoint", async () => {
      const p = fakePinata();
      p.config.endpointUrl = "https://pinata.example/v3";
      respond(200);
      await adapter(p).unpin("bafyFakeCid");
      expect(deleteUrls()).toEqual(["https://pinata.example/v3/files/public/id-1"]);
    });

    it("deletes every file a CID is pinned as, and lists the CID once", async () => {
      const p = fakePinata();
      p.files.public.list = jest.fn(() => ({
        limit() {
          return this;
        },
        then(resolve) {
          resolve({
            files: [
              { id: "f1", cid: "cid-1", size: 10 },
              { id: "f2", cid: "cid-1", size: 10 },
              { id: "f3" },
            ],
            next_page_token: null,
          });
        },
      }));
      const a = adapter(p);
      expect(await a.listPinned()).toEqual([{ cid: "cid-1", bytes: 10 }]);
      respond(200, 200);

      expect(await a.unpin("cid-1")).toBe(true);
      expect(deleteUrls()).toEqual([
        "https://api.pinata.cloud/v3/files/public/f1",
        "https://api.pinata.cloud/v3/files/public/f2",
      ]);
    });
  });

  it("unpin() returns true when no file matches the cid", async () => {
    const p = fakePinata();
    p.files.public.list = jest.fn(() => ({ cid: async () => ({ files: [] }) }));
    const a = createPinataAdapter(p, {
      gatewayBase: "https://gw.mypinata.cloud/ipfs/",
      uploadTtl: 60,
    });
    const fetchSpy = spyOn(globalThis, "fetch");
    try {
      expect(await a.unpin("bafyMissing")).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("catBytes() returns raw bytes from the authenticated gateway", async () => {
    const p = fakePinata();
    p.gateways.public.get = jest.fn(async () => ({
      data: Buffer.from('{"hello":"world"}', "utf-8"),
      contentType: "application/json",
    }));
    const a = createPinataAdapter(p, {
      gatewayBase: "https://gw.mypinata.cloud/ipfs/",
      uploadTtl: 60,
    });
    const bytes = await a.catBytes("bafyWorld");
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.toString("utf-8")).toBe('{"hello":"world"}');
    expect(p.gateways.public.get).toHaveBeenCalledWith("bafyWorld");
  });

  it("cat() returns text from the authenticated gateway", async () => {
    const p = fakePinata();
    p.gateways.public.get = jest.fn(async () => ({
      data: '{"hello":"world"}',
      contentType: "application/json",
    }));
    const a = createPinataAdapter(p, {
      gatewayBase: "https://gw.mypinata.cloud/ipfs/",
      uploadTtl: 60,
    });
    expect(await a.cat("bafyText")).toBe('{"hello":"world"}');
    expect(p.gateways.public.get).toHaveBeenCalledWith("bafyText");
  });

  it.each([
    [
      "cat()",
      (p) => {
        p.gateways.public.get = jest.fn(async () => {
          throw new Error("pinata gateway 504");
        });
      },
      (a) => a.cat("bafyFail"),
      "pinata gateway 504",
    ],
    [
      "catBytes()",
      (p) => {
        p.gateways.public.get = jest.fn(async () => {
          throw new Error("pinata gateway 503");
        });
      },
      (a) => a.catBytes("bafyFail"),
      "pinata gateway 503",
    ],
  ])("%s propagates authenticated gateway errors", async (_name, configure, call, message) => {
    const p = fakePinata();
    configure(p);
    const a = createPinataAdapter(p, {
      gatewayBase: "https://gw.mypinata.cloud/ipfs/",
      uploadTtl: 60,
    });
    await expect(call(a)).rejects.toThrow(message);
  });

  it.each([
    [
      "add()",
      (p) => {
        p.upload.public.file = jest.fn(async () => {
          throw new Error("pinata upload refused");
        });
      },
      (a) => a.add("payload"),
      "pinata upload refused",
    ],
    [
      "addDirectory()",
      (p) => {
        p.upload.public.fileArray = jest.fn(async () => {
          throw new Error("pinata directory upload refused");
        });
      },
      (a) => a.addDirectory([{ name: "x.bin", data: "x" }]),
      "pinata directory upload refused",
    ],
    [
      "mintUploadCredential()",
      (p) => {
        p.upload.public.createSignedURL = jest.fn(async () => {
          throw new Error("signing failed");
        });
      },
      (a) => a.mintUploadCredential(),
      "signing failed",
    ],
    [
      "unpin() list",
      (p) => {
        p.files.public.list = jest.fn(() => ({
          cid: async () => {
            throw new Error("list failed");
          },
        }));
      },
      (a) => a.unpin("bafyFail"),
      "list failed",
    ],
  ])("%s propagates write/pin errors", async (_name, configure, call, message) => {
    const p = fakePinata();
    configure(p);
    const a = createPinataAdapter(p, {
      gatewayBase: "https://gw.mypinata.cloud/ipfs/",
      uploadTtl: 60,
    });
    await expect(call(a)).rejects.toThrow(message);
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
            files: [{ id: "f1", cid: "cid-1", size: 100 }],
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
      const pins = await a.listPinned();
      expect(pins).toEqual([{ cid: "cid-1", bytes: 100 }, { cid: "cid-2", bytes: undefined }]);
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
    expect(await a.listPinned()).toEqual([{ cid: "cid-2", bytes: undefined }]);
  });

  it("gatewayBase() returns the configured gateway", async () => {
    const a = createPinataAdapter(fakePinata(), {
      gatewayBase: "https://gw.example.com/ipfs/",
      uploadTtl: 60,
    });
    expect(a.gatewayBase()).toBe("https://gw.example.com/ipfs/");
  });

  describe("signed-url diagnostics (fetch instrumentation)", () => {
    let originalFetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("instruments /files/sign calls and passes other URLs through untouched", async () => {
      const rawFetch = jest.fn(async () => ({ ok: true, status: 200 }));
      globalThis.fetch = rawFetch;
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

      createPinataAdapter(fakePinata(), {
        gatewayBase: "https://gw.mypinata.cloud/ipfs/",
        uploadTtl: 60,
      });

      // Non-sign URLs pass straight through to the raw fetch.
      rawFetch.mockResolvedValueOnce({ ok: true, status: 200, other: true });
      const otherResult = await globalThis.fetch("https://example.com/other");
      expect(otherResult.other).toBe(true);
      expect(rawFetch).toHaveBeenCalledWith("https://example.com/other", undefined);

      // Successful sign call logs dispatched + OK.
      const signResult = await globalThis.fetch(
        "https://uploads.pinata.cloud/v3/files/sign",
        { method: "POST" },
      );
      expect(signResult.status).toBe(200);
      const logMessages = logSpy.mock.calls.map((c) => c[0]);
      expect(
        logMessages.some((m) => m.includes("pinata sign") && m.includes("dispatched")),
      ).toBe(true);
      expect(
        logMessages.some((m) => m.includes("pinata sign") && m.includes("→ OK")),
      ).toBe(true);

      // Thrown failures are logged and rethrown.
      rawFetch.mockRejectedValueOnce(new Error("network down"));
      await expect(
        globalThis.fetch("https://uploads.pinata.cloud/v3/files/sign", {
          method: "POST",
        }),
      ).rejects.toThrow("network down");
      let warnMessages = warnSpy.mock.calls.map((c) => c[0]);
      expect(
        warnMessages.some((m) => m.includes("ERROR") && m.includes("network down")),
      ).toBe(true);

      // Non-OK responses log the HTTP status.
      rawFetch.mockResolvedValueOnce({ ok: false, status: 503 });
      await globalThis.fetch("https://uploads.pinata.cloud/v3/files/sign", {
        method: "POST",
      });
      warnMessages = warnSpy.mock.calls.map((c) => c[0]);
      expect(warnMessages.some((m) => m.includes("HTTP 503"))).toBe(true);

      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("wraps fetch only once across multiple adapter constructions", () => {
      globalThis.fetch = jest.fn();

      createPinataAdapter(fakePinata(), {
        gatewayBase: "https://gw.mypinata.cloud/ipfs/",
        uploadTtl: 60,
      });
      const wrappedOnce = globalThis.fetch;

      createPinataAdapter(fakePinata(), {
        gatewayBase: "https://gw.mypinata.cloud/ipfs/",
        uploadTtl: 60,
      });

      expect(globalThis.fetch).toBe(wrappedOnce);
    });
  });

  describe("pre-minted credential pool", () => {
    async function flushMicrotasks() {
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }
    }

    it("warms the pool in the background at construction, serving mintUploadCredential from the pool (not a fresh mint)", async () => {
      const p = fakePinata();
      const a = createPinataAdapter(p, {
        gatewayBase: "https://gw.mypinata.cloud/ipfs/",
        uploadTtl: 300,
        poolSize: 3,
      });
      await flushMicrotasks();
      expect(p.upload.public.createSignedURL).toHaveBeenCalledTimes(3);
      const warmedUrls = [
        "https://uploads.pinata.cloud/signed-1",
        "https://uploads.pinata.cloud/signed-2",
        "https://uploads.pinata.cloud/signed-3",
      ];

      const cred = await a.mintUploadCredential();
      expect(cred).toEqual({
        strategy: "presigned-put",
        url: expect.stringContaining("https://uploads.pinata.cloud/signed-"),
        gateway: "https://gw.mypinata.cloud/ipfs/",
        reusable: false,
      });
      // The credential itself is one that was minted during warm-up, not
      // freshly minted for this call - proving it was served from the pool.
      // (Popping does trigger a background top-up, which mints a *new*
      // credential for the pool - that's covered separately below, and is
      // exactly why this asserts pool membership rather than zero calls.)
      expect(warmedUrls).toContain(cred.url);
    });

    it("mintUploadCredentials serves partially from the pool and mints only the shortfall fresh", async () => {
      const p = fakePinata();
      const a = createPinataAdapter(p, {
        gatewayBase: "https://gw.mypinata.cloud/ipfs/",
        uploadTtl: 300,
        poolSize: 2,
      });
      await flushMicrotasks();
      expect(p.upload.public.createSignedURL).toHaveBeenCalledTimes(2);

      p.upload.public.createSignedURL.mockClear();
      const creds = await a.mintUploadCredentials(5);
      expect(creds).toHaveLength(5);
      // No duplicate URLs between pooled and freshly minted entries.
      expect(new Set(creds.map((c) => c.url)).size).toBe(5);
      // 2 served from the pool + 3 minted fresh for the shortfall = 3 calls
      // on the request path, plus the pool (now empty) immediately triggers
      // a background top-up back to poolSize=2 -> 2 more calls. Total 5.
      expect(p.upload.public.createSignedURL).toHaveBeenCalledTimes(5);
    });

    it("falls back to minting fresh with no background warm-up when pooling is disabled (poolSize omitted)", async () => {
      const p = fakePinata();
      const a = createPinataAdapter(p, {
        gatewayBase: "https://gw.mypinata.cloud/ipfs/",
        uploadTtl: 300,
      });
      await flushMicrotasks();
      expect(p.upload.public.createSignedURL).not.toHaveBeenCalled();

      const cred = await a.mintUploadCredential();
      expect(p.upload.public.createSignedURL).toHaveBeenCalledTimes(1);
      expect(cred.url).toBeTruthy();
    });

    it("refills the pool in the background after a pop", async () => {
      const p = fakePinata();
      const a = createPinataAdapter(p, {
        gatewayBase: "https://gw.mypinata.cloud/ipfs/",
        uploadTtl: 300,
        poolSize: 2,
      });
      await flushMicrotasks();
      expect(p.upload.public.createSignedURL).toHaveBeenCalledTimes(2);

      p.upload.public.createSignedURL.mockClear();
      await a.mintUploadCredential(); // pops 1 from the pool of 2
      await flushMicrotasks(); // let the post-pop refill settle
      // Topped back up to poolSize (1 replacement minted).
      expect(p.upload.public.createSignedURL).toHaveBeenCalledTimes(1);
    });

    it("prunes pool entries once they cross the expiry margin and mints a fresh replacement", async () => {
      jest.useFakeTimers();
      try {
        jest.setSystemTime(0);
        const p = fakePinata();
        const a = createPinataAdapter(p, {
          gatewayBase: "https://gw.mypinata.cloud/ipfs/",
          uploadTtl: 100,
          poolSize: 1,
          poolExpiryMarginSeconds: 60,
        });
        await flushMicrotasks();
        expect(p.upload.public.createSignedURL).toHaveBeenCalledTimes(1);

        // Fresh-lifetime window is uploadTtl - margin = 40s. Cross it.
        jest.setSystemTime(41_000);
        p.upload.public.createSignedURL.mockClear();

        const cred = await a.mintUploadCredential();
        // The pooled entry was stale and discarded, so a fresh one was
        // minted to serve this call (1) - and since the pool is now empty,
        // popping also triggers a background top-up (1 more). Total 2.
        expect(p.upload.public.createSignedURL).toHaveBeenCalledTimes(2);
        expect(cred.url).toBeTruthy();
      } finally {
        jest.useRealTimers();
      }
    });

    it("warns once at construction when uploadTtl leaves no positive fresh-lifetime window", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      createPinataAdapter(fakePinata(), {
        gatewayBase: "https://gw.mypinata.cloud/ipfs/",
        uploadTtl: 60,
        poolSize: 5,
        poolExpiryMarginSeconds: 60,
      });
      expect(
        warnSpy.mock.calls.some(([m]) => m.includes("pinata pool misconfigured")),
      ).toBe(true);
      warnSpy.mockRestore();
    });
  });
});
