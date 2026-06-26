/**
 * Comments Archive Service tests
 */

import { jest } from "@jest/globals";

jest.setTimeout(10000);

describe("Comments Archive Service", () => {
  let archiveCommentsForAsset;
  let fetchCommentsArchive;
  let mockStorage;
  let relayMessages;
  let MockWebSocket;

  beforeAll(async () => {
    relayMessages = [];

    MockWebSocket = jest.fn(function () {
      this.readyState = 0; // CONNECTING
      this.sent = [];
      this.actualSubId = null;

      // Fire onopen on the next tick so connect() can resolve.
      setTimeout(() => {
        this.readyState = 1; // OPEN
        if (this.onopen) this.onopen();
      }, 0);
    });
    MockWebSocket.prototype.send = jest.fn(function (data) {
      this.sent.push(data);
      try {
        const req = JSON.parse(data);
        if (Array.isArray(req) && req[0] === "REQ" && req[1]) {
          this.actualSubId = req[1];
          // Now that the subscription exists, deliver the queued relay messages
          // on a subsequent tick so the subscription callbacks are registered.
          setTimeout(() => {
            for (const msg of relayMessages) {
              if (this.onmessage) {
                const rewritten = [...msg];
                if (this.actualSubId && rewritten.length > 1) {
                  rewritten[1] = this.actualSubId;
                }
                this.onmessage({ data: JSON.stringify(rewritten) });
              }
            }
          }, 0);
        }
      } catch {
        // ignore
      }
    });
    MockWebSocket.prototype.close = jest.fn(function () {
      this.readyState = 3;
      if (this.onclose) this.onclose({ message: "closed by test" });
    });
    MockWebSocket.prototype.terminate = jest.fn();
    MockWebSocket.prototype.ping = jest.fn();
    MockWebSocket.prototype.once = jest.fn(function (event, handler) {
      if (event === "pong") {
        setTimeout(() => handler(true), 0);
      }
    });
    MockWebSocket.OPEN = 1;
    MockWebSocket.CONNECTING = 0;

    jest.unstable_mockModule("ws", () => ({
      WebSocket: MockWebSocket,
    }));

    jest.unstable_mockModule("../src/config.js", () => ({
      NOSTR_RELAY_URL: "ws://127.0.0.1:7777",
    }));

    mockStorage = {
      add: jest.fn(async (payload) => {
        const hash = "Qm" + Buffer.from(payload).toString("hex").slice(0, 15);
        return hash;
      }),
    };

    const mod = await import("../src/api/comments-archive.js");
    archiveCommentsForAsset = mod.archiveCommentsForAsset;
    fetchCommentsArchive = mod.fetchCommentsArchive;
  });

  beforeEach(() => {
    relayMessages = [];
    jest.clearAllMocks();
  });

  test("fetches events from the relay and builds an archive object", async () => {
    const assetTag = "31337:0xabc:1:asset_1";
    relayMessages = [
      ["EVENT", "sub-1", { id: "evt-1", kind: 1, content: "hello", created_at: 1000, tags: [["asset", assetTag], ["sender", "0xaaa"]] }],
      ["EVENT", "sub-1", { id: "evt-2", kind: 1, content: "world", created_at: 1001, tags: [["asset", assetTag], ["sender", "0xbbb"]] }],
      ["EOSE", "sub-1"],
    ];

    const archive = await fetchCommentsArchive(assetTag);

    expect(archive.assetTag).toBe(assetTag);
    expect(archive.eventCount).toBe(2);
    expect(archive.events).toHaveLength(2);
    expect(archive.events[0].id).toBe("evt-1");
  });

  test("archives comments to IPFS and returns the CID", async () => {
    const assetTag = "31337:0xabc:2:asset_2";
    relayMessages = [
      ["EVENT", "sub-1", { id: "evt-3", kind: 1, content: " archived ", created_at: 2000, tags: [["asset", assetTag], ["sender", "0xccc"]] }],
      ["EOSE", "sub-1"],
    ];

    const result = await archiveCommentsForAsset(assetTag, mockStorage);

    expect(result.cid).toMatch(/^Qm/);
    expect(result.eventCount).toBe(1);
    expect(mockStorage.add).toHaveBeenCalledTimes(1);

    const archivePayload = JSON.parse(mockStorage.add.mock.calls[0][0]);
    expect(archivePayload.assetTag).toBe(assetTag);
    expect(archivePayload.events[0].id).toBe("evt-3");
  });

  test("returns empty archive when relay sends EOSE with no events", async () => {
    relayMessages = [["EOSE", "sub-1"]];

    const result = await archiveCommentsForAsset("31337:0xabc:3:asset_3", mockStorage);

    expect(result.eventCount).toBe(0);
    const archivePayload = JSON.parse(mockStorage.add.mock.calls[0][0]);
    expect(archivePayload.events).toEqual([]);
  });
});
