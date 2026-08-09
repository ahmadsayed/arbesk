/**
 * @jest-environment jsdom
 */
import { expect, test, beforeEach } from "@jest/globals";
import {
  adoptOpenedCollection,
  selectCollection,
  clearSelectedCollection,
  clearActiveCollection,
  adoptPublishedCollection,
  getActiveCollectionTokenId,
  getSelectedCollectionId,
} from "../../frontend/src/js/domain/collection.js";
import { _resetForTesting } from "../../frontend/src/js/state/asset-state.js";

beforeEach(() => _resetForTesting());

test("adoptOpenedCollection sets active token and optionally clears selection", () => {
  adoptOpenedCollection("7", { clearSelectedCollection: true });
  expect(getActiveCollectionTokenId()).toBe("7");
  expect(getSelectedCollectionId()).toBeNull();
});

test("selectCollection / clearSelectedCollection", () => {
  selectCollection("9");
  expect(getSelectedCollectionId()).toBe("9");
  clearSelectedCollection();
  expect(getSelectedCollectionId()).toBeNull();
});

test("clearActiveCollection clears both fields", () => {
  adoptOpenedCollection("7", { clearSelectedCollection: true });
  selectCollection("9");
  clearActiveCollection();
  expect(getActiveCollectionTokenId()).toBeNull();
  expect(getSelectedCollectionId()).toBeNull();
});

test("adoptPublishedCollection stringifies tokenId", () => {
  adoptPublishedCollection(42);
  expect(getActiveCollectionTokenId()).toBe("42");
});
