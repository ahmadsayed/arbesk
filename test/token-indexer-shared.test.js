/**
 * Shared token indexing tests.
 */
import { jest } from "@jest/globals";

const TEST_CHAIN = 999901;

let _getBlockNumber;
let _getLogs;
let _editorListURI;
let _cat;

async function loadModule() {
  _getBlockNumber = jest.fn().mockResolvedValue(0n);
  _getLogs = jest.fn().mockResolvedValue([]);
  _editorListURI = jest.fn().mockResolvedValue("");
  _cat = jest.fn().mockResolvedValue("[]");

  const fakeClient = {
    getBlockNumber: _getBlockNumber,
    getLogs: _getLogs,
    readContract: _editorListURI,
  };

  await jest.unstable_mockModule("../src/config.ts", () => ({
    getPublicClient: jest.fn(() => fakeClient),
    getContractAddress: jest.fn(() => "0x0000000000000000000000000000000000000001"),
    NETWORK_CONFIGS: {},
  }));

  return import("../src/api/token-indexer.ts");
}

beforeEach(() => {
  jest.resetModules();
});

test("indexes editor-shared tokens from EditorSetChanged events", async () => {
  const { getIndexer } = await loadModule();
  const indexer = getIndexer(TEST_CHAIN, { cat: _cat });
  indexer._saveState = () => {};

  const owner = "0x0000000000000000000000000000000000000AAA".toLowerCase();
  const editor = "0x0000000000000000000000000000000000000BBB".toLowerCase();

  _getBlockNumber.mockResolvedValue(10n);
  _getLogs.mockResolvedValue([
    {
      eventName: "Transfer",
      args: {
        from: "0x0000000000000000000000000000000000000000",
        to: owner,
        tokenId: 1n,
      },
      blockNumber: 10n,
    },
    {
      eventName: "EditorSetChanged",
      args: {
        tokenId: 1n,
        newRoot:
          "0x0000000000000000000000000000000000000000000000000000000000000000",
        newVersion: 1n,
      },
      blockNumber: 10n,
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
  const indexer = getIndexer(TEST_CHAIN, { cat: _cat });
  indexer._saveState = () => {};

  const editor = "0x0000000000000000000000000000000000000BBB".toLowerCase();

  // Seed state as if token 1 was previously indexed with an editor.
  indexer.ownership.set("1", editor);
  indexer.tokenEditors.set("1", [editor]);
  indexer.editorTokens.set(editor, ["1"]);

  _getBlockNumber.mockResolvedValue(20n);
  _getLogs.mockResolvedValue([
    {
      eventName: "Transfer",
      args: {
        from: editor,
        to: "0x0000000000000000000000000000000000000000",
        tokenId: 1n,
      },
      blockNumber: 20n,
    },
  ]);

  await indexer.catchUp();

  expect(indexer.ownership.get("1")).toBe("0x0000000000000000000000000000000000000000");
  expect(indexer.getSharedTokens(editor)).toEqual([]);
  expect(indexer.tokenEditors.has("1")).toBe(false);
});
