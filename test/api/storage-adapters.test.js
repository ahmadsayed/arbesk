import { jest } from "@jest/globals";
import { createKuboAdapter } from "../../src/api/storage/kubo-adapter.js";
import { createPinataAdapter } from "../../src/api/storage/pinata-adapter.js";

describe("kubo adapter", () => {
  function fakeIpfs() {
    return {
      add: jest.fn(async () => ({ cid: { toString: () => "QmFakeCid" } })),
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
    });
  });
});

describe("pinata adapter", () => {
  function fakePinata() {
    return {
      upload: {
        public: {
          file: jest.fn(async () => ({ id: "id-1", cid: "bafyFakeCid" })),
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
