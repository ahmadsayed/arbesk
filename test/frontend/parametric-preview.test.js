/** @jest-environment jsdom */
import { jest } from "@jest/globals";

function setupDom() {
  document.body.innerHTML = [
    '<div id="inspector"></div>',
    '<button id="inspectorToggle"></button>',
    '<button id="inspectorReveal"></button>',
    '<div id="parametricEditor"><details></details></div>',
    '<div id="tokenChildInfo"><details></details></div>',
    '<div id="componentEditor"></div>',
    '<div id="scaleSection"></div>',
    '<input id="nodeScaleFactor" />',
    '<input id="nodeScalePercent" />',
    '<input id="nodeColor" />',
    '<span id="tokenChildId"></span>',
    '<span id="tokenChildContract"></span>',
    '<span id="tokenChildChain"></span>',
    '<span id="tokenChildResolution"></span>',
    '<span id="tokenChildCid"></span>',
  ].join("");
}

async function load(getNodeChildRef) {
  jest.resetModules();
  setupDom();

  await jest.unstable_mockModule("@arbesk/asset-core/events/bus.js", () => ({
    on: jest.fn(),
    emit: jest.fn(),
    EVENTS: {
      NODE_SELECTED: "node:selected",
      SELECTION_CHANGED: "selection:changed",
      NODE_DOUBLE_CLICKED: "node:double-clicked",
      OUTLINER_NODE_SELECTED: "outliner:node-selected",
      SUBMESH_SELECTED: "submesh:selected",
      NESTING_DIVE_REQUESTED: "nesting:dive-requested",
      ASSET_DRAFT_SAVED: "asset:draft-saved",
      SCENE_TOKEN_CHILD_ADDED: "scene:token-child-added",
      SCENE_CLEARED: "scene:cleared",
      TRANSFORM_STAGED: "transform:staged",
    },
  }));

  await jest.unstable_mockModule("../../frontend/src/js/engine/time-travel.js", () => ({
    applyColor: jest.fn(),
  }));
  await jest.unstable_mockModule("../../frontend/src/js/engine/transforms.js", () => ({
    stageNodeTransform: jest.fn(),
    readNodeTransformMatrix: jest.fn(),
    matricesEqual: jest.fn(),
  }));
  await jest.unstable_mockModule("../../frontend/src/js/engine/undo-stack.js", () => ({
    pushUndoEntry: jest.fn(),
  }));
  await jest.unstable_mockModule("../../frontend/src/js/engine/undo-controller.js", () => ({
    registerUndoApplier: jest.fn(),
  }));
  await jest.unstable_mockModule("../../frontend/src/js/engine/scene-graph.js", () => ({
    getNodeMeshes: jest.fn(),
    getNodeSubMeshes: jest.fn().mockReturnValue([]),
    getNodeChildRef,
    deselectAll: jest.fn(),
    selectNodeById: jest.fn(),
    selectSubMesh: jest.fn(),
    state: { nodeAnchors: new Map(), selectedNodeIds: new Set() },
  }));

  return await import("../../frontend/src/js/engine/parametric-preview.js");
}

describe("showTokenChildInfo (via openInspector)", () => {
  test("populates token fields from a legacy child_ref and shows the panel", async () => {
    const getNodeChildRef = jest.fn().mockReturnValue({
      tokenId: "123",
      chainId: 31337,
      contractAddress: "0x1234567890abcdef1234567890abcdef12345678",
      resolution: "v2",
      resolvedCid: "bafyChild",
    });
    const { openInspector } = await load(getNodeChildRef);

    await openInspector("child-node");

    expect(document.getElementById("tokenChildInfo").hidden).toBe(false);
    expect(document.getElementById("parametricEditor").hidden).toBe(true);
    expect(document.getElementById("componentEditor").hidden).toBe(true);
    expect(document.getElementById("tokenChildId").textContent).toBe("Token #123");
    expect(document.getElementById("tokenChildContract").textContent).toBe(
      "0x12345678…345678"
    );
    expect(document.getElementById("tokenChildChain").textContent).toBe("31337");
    expect(document.getElementById("tokenChildResolution").textContent).toBe("v2");
    expect(document.getElementById("tokenChildCid").textContent).toBe("bafyChild");
  });

  test("reads the collection child_ref format and falls back to defaults", async () => {
    const getNodeChildRef = jest.fn().mockReturnValue({
      collection: {
        chainId: 1,
        contractAddress: "0xcollection0000000000000000000000000000000000",
        tokenId: "456",
      },
      assetID: "asset_child",
    });
    const { openInspector } = await load(getNodeChildRef);

    await openInspector("child-node");

    expect(document.getElementById("tokenChildId").textContent).toBe("Token #456");
    expect(document.getElementById("tokenChildContract").textContent).toBe(
      "0xcollecti…000000"
    );
    expect(document.getElementById("tokenChildChain").textContent).toBe("1");
    // No resolution/resolvedCid on a collection ref → defaults.
    expect(document.getElementById("tokenChildResolution").textContent).toBe("latest");
    expect(document.getElementById("tokenChildCid").textContent).toBe("—");
  });

  test("renders em-dash placeholders when the child_ref carries no identity", async () => {
    const getNodeChildRef = jest.fn().mockReturnValue({});
    const { openInspector } = await load(getNodeChildRef);

    await openInspector("child-node");

    expect(document.getElementById("tokenChildId").textContent).toBe("—");
    expect(document.getElementById("tokenChildContract").textContent).toBe("—");
    expect(document.getElementById("tokenChildChain").textContent).toBe("—");
    expect(document.getElementById("tokenChildResolution").textContent).toBe("latest");
    expect(document.getElementById("tokenChildCid").textContent).toBe("—");
  });
});
