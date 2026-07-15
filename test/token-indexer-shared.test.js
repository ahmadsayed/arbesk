/**
 * Shared token indexing tests.
 */
import { jest } from "@jest/globals";

const TEST_CHAIN = 999901;

let _getBlockNumber;
let _getPastLogs;
let _editorListURI;
let _cat;

async function loadModule() {
  _getBlockNumber = jest.fn().mockResolvedValue(0);
  _getPastLogs = jest.fn().mockResolvedValue([]);
  _editorListURI = jest.fn().mockResolvedValue("");
  _cat = jest.fn().mockResolvedValue("[]");

  const fakeContractMethods = {
    editorListURI: (tokenId) => ({ call: () => _editorListURI(tokenId) }),
  };

  const fakeWeb3 = {
    eth: {
      getBlockNumber: _getBlockNumber,
      getPastLogs: _getPastLogs,
      Contract: class {
        constructor() {
          this.methods = fakeContractMethods;
        }
      },
    },
    utils: { toBigInt: (x) => BigInt(x) },
  };

  await jest.unstable_mockModule("../src/config.js", () => ({
    getWeb3: jest.fn(() => fakeWeb3),
    getContractAddress: jest.fn(() => "0x0000000000000000000000000000000000000001"),
    NETWORK_CONFIGS: {},
  }));

  await jest.unstable_mockModule("../src/api/storage/index.js", () => ({
    getStorage: jest.fn(() => ({ cat: _cat })),
  }));

  return import("../src/api/token-indexer.js");
}

beforeEach(() => {
  jest.resetModules();
});

test("indexes editor-shared tokens from EditorSetChanged events", async () => {
  const { getIndexer } = await loadModule();
  const indexer = getIndexer(TEST_CHAIN);
  indexer._saveState = () => {};

  const owner = "0x0000000000000000000000000000000000000AAA".toLowerCase();
  const editor = "0x0000000000000000000000000000000000000BBB".toLowerCase();

  _getBlockNumber.mockResolvedValue(10);
  _getPastLogs.mockResolvedValue([
    {
      blockNumber: 10,
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x0000000000000000000000000000000000000000000000000000000000000000",
        "0x000000000000000000000000" + owner.slice(2),
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      ],
    },
    {
      blockNumber: 10,
      topics: [
        "0xe04346630a2a402b40ab5f6918205fee5369cca36e2e6c2eebc4188b5f10c8c3",
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      ],
    },
  ]);

  _editorListURI.mockResolvedValueOnce("bafyEditorList");
  _cat.mockResolvedValueOnce(JSON.stringify([{ address: editor, role: 2 }]));

  await indexer.catchUp();

  expect(indexer.getOwnedTokens(owner)).toEqual(["1"]);
  expect(indexer.getSharedTokens(editor)).toEqual(["1"]);
  expect(indexer.getSharedTokens(owner)).toEqual([]);
});

test("removes shared token when it is burned (transferred to zero)", async () => {
  const { getIndexer } = await loadModule();
  const indexer = getIndexer(TEST_CHAIN);
  indexer._saveState = () => {};

  const editor = "0x0000000000000000000000000000000000000BBB".toLowerCase();

  // Seed state as if token 1 was previously indexed with an editor.
  indexer.ownership.set("1", editor);
  indexer.tokenEditors.set("1", [editor]);
  indexer.editorTokens.set(editor, ["1"]);

  _getBlockNumber.mockResolvedValue(20);
  _getPastLogs.mockResolvedValue([
    {
      blockNumber: 20,
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x000000000000000000000000" + editor.slice(2),
        "0x0000000000000000000000000000000000000000000000000000000000000000",
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      ],
    },
  ]);

  await indexer.catchUp();

  expect(indexer.ownership.get("1")).toBe("0x0000000000000000000000000000000000000000");
  expect(indexer.getSharedTokens(editor)).toEqual([]);
  expect(indexer.tokenEditors.has("1")).toBe(false);
});
