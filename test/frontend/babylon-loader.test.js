/**
 * @jest-environment jsdom
 *
 * The glTF loader plugin must be configured with animationStartMode = NONE so
 * imported animated assets stay static until the user previews a clip.
 */
import { expect, test, beforeAll } from "@jest/globals";

let registerGltfLoaderDefaults;

beforeAll(async () => {
  ({ registerGltfLoaderDefaults } = await import(
    "../../frontend/src/js/engine/babylon-loader.js"
  ));
});

test("registers a plugin callback that sets animationStartMode NONE on gltf", () => {
  const callbacks = [];
  global.BABYLON = {
    SceneLoader: {
      OnPluginActivatedObservable: { add: (cb) => callbacks.push(cb) },
    },
    GLTF2: { GLTFLoaderAnimationStartMode: { NONE: 0, FIRST: 1, ALL: 2 } },
  };

  registerGltfLoaderDefaults();
  expect(callbacks).toHaveLength(1);

  const gltfPlugin = { name: "gltf", animationStartMode: 1 };
  callbacks[0](gltfPlugin);
  expect(gltfPlugin.animationStartMode).toBe(0);

  const otherPlugin = { name: "obj", animationStartMode: 1 };
  callbacks[0](otherPlugin);
  expect(otherPlugin.animationStartMode).toBe(1);
});
