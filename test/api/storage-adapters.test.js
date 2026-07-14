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

  it("mintUploadCredentials(count) returns count copies of the reusable kubo credential", async () => {
    const a = createKuboAdapter(fakeIpfs(), {
      apiUrl: "http://127.0.0.1:5001",
      gatewayBase: "http://127.0.0.1:8080/ipfs/",
    });
    const creds = await a.mintUploadCredentials(3);
    expect(creds).toHaveLength(3);
    for (const cred of creds) {
      expect(cred).toEqual({
        backend: "kubo",
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
      backend: "pinata",
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
        backend: "pinata",
        url: expect.stringContaining("https://uploads.pinata.cloud/signed-"),
        gateway: "https://gw.mypinata.cloud/ipfs/",
        reusable: false,
      });
    }
    expect(JSON.stringify(creds)).not.toMatch(/jwt|JWT|Bearer/);
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

  it("cat() propagates authenticated gateway errors", async () => {
    const p = fakePinata();
    p.gateways.public.get = jest.fn(async () => {
      throw new Error("pinata gateway 504");
    });
    const a = createPinataAdapter(p, {
      gatewayBase: "https://gw.mypinata.cloud/ipfs/",
      uploadTtl: 60,
    });
    await expect(a.cat("bafyFail")).rejects.toThrow("pinata gateway 504");
  });

  it("catBytes() propagates authenticated gateway errors", async () => {
    const p = fakePinata();
    p.gateways.public.get = jest.fn(async () => {
      throw new Error("pinata gateway 503");
    });
    const a = createPinataAdapter(p, {
      gatewayBase: "https://gw.mypinata.cloud/ipfs/",
      uploadTtl: 60,
    });
    await expect(a.catBytes("bafyFail")).rejects.toThrow("pinata gateway 503");
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

  describe("signed-url diagnostics (fetch instrumentation)", () => {
    let originalFetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("logs a dispatched + OK line for a /files/sign call, passes other URLs through untouched", async () => {
      const rawFetch = jest.fn(async (url) => {
        if (String(url).includes("/files/sign")) {
          return { ok: true, status: 200 };
        }
        return { ok: true, status: 200, other: true };
      });
      globalThis.fetch = rawFetch;
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      createPinataAdapter(fakePinata(), {
        gatewayBase: "https://gw.mypinata.cloud/ipfs/",
        uploadTtl: 60,
      });

      const otherResult = await globalThis.fetch("https://example.com/other");
      expect(otherResult.other).toBe(true);
      expect(rawFetch).toHaveBeenCalledWith("https://example.com/other", undefined);

      const signResult = await globalThis.fetch(
        "https://uploads.pinata.cloud/v3/files/sign",
        { method: "POST" },
      );
      expect(signResult.status).toBe(200);

      const messages = logSpy.mock.calls.map((c) => c[0]);
      expect(messages.some((m) => m.includes("pinata sign") && m.includes("dispatched"))).toBe(true);
      expect(messages.some((m) => m.includes("pinata sign") && m.includes("→ OK"))).toBe(true);

      logSpy.mockRestore();
    });

    it("logs an ERROR line with the failure message and rethrows on a failed sign attempt", async () => {
      const rawFetch = jest.fn(async () => {
        throw new Error("network down");
      });
      globalThis.fetch = rawFetch;
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

      createPinataAdapter(fakePinata(), {
        gatewayBase: "https://gw.mypinata.cloud/ipfs/",
        uploadTtl: 60,
      });

      await expect(
        globalThis.fetch("https://uploads.pinata.cloud/v3/files/sign", {
          method: "POST",
        }),
      ).rejects.toThrow("network down");

      const messages = warnSpy.mock.calls.map((c) => c[0]);
      expect(
        messages.some((m) => m.includes("ERROR") && m.includes("network down")),
      ).toBe(true);

      warnSpy.mockRestore();
    });

    it("logs a warning with the HTTP status on a non-OK sign response", async () => {
      const rawFetch = jest.fn(async () => ({ ok: false, status: 503 }));
      globalThis.fetch = rawFetch;
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

      createPinataAdapter(fakePinata(), {
        gatewayBase: "https://gw.mypinata.cloud/ipfs/",
        uploadTtl: 60,
      });

      await globalThis.fetch("https://uploads.pinata.cloud/v3/files/sign", {
        method: "POST",
      });

      const messages = warnSpy.mock.calls.map((c) => c[0]);
      expect(messages.some((m) => m.includes("HTTP 503"))).toBe(true);

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
        backend: "pinata",
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
