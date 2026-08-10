/**
 * attach-views.js unit tests — multiview attach view assignment:
 * auto-assign in attach order, swap on conflict, promote-on-front-removal,
 * canonical ordering, and non-mutation of inputs.
 */

import { expect, test } from "@jest/globals";
import {
  VIEW_ORDER,
  MAX_ATTACH_IMAGES,
  addAttachedImage,
  setAttachedImageView,
  removeAttachedImage,
  nextAvailableView,
} from "../../frontend/src/js/ui/attach-views.js";

const img = (name) => ({ name, base64: "AAAA", mime: "image/png" });
const views = (images) => images.map((i) => i.view);
const names = (images) => images.map((i) => i.name);

test("views auto-assign in attach order: front, left, back, right", () => {
  let images = [];
  images = addAttachedImage(images, img("a"));
  images = addAttachedImage(images, img("b"));
  images = addAttachedImage(images, img("c"));
  images = addAttachedImage(images, img("d"));
  expect(views(images)).toEqual(["front", "left", "back", "right"]);
  expect(names(images)).toEqual(["a", "b", "c", "d"]);
  expect(MAX_ATTACH_IMAGES).toBe(4);
});

test("chips always render in canonical order", () => {
  let images = [];
  images = addAttachedImage(images, img("a")); // front
  images = addAttachedImage(images, img("b")); // left
  // Move b to back, add c — c should take left and slot between them.
  images = setAttachedImageView(images, 1, "back");
  images = addAttachedImage(images, img("c"));
  expect(views(images)).toEqual(["front", "left", "back"]);
  expect(names(images)).toEqual(["a", "c", "b"]);
});

test("changing a view to one already in use swaps the two chips", () => {
  let images = [];
  images = addAttachedImage(images, img("a")); // front
  images = addAttachedImage(images, img("b")); // left
  images = addAttachedImage(images, img("c")); // back
  images = setAttachedImageView(images, 2, "front"); // c ↔ a
  expect(views(images)).toEqual(["front", "left", "back"]);
  expect(names(images)).toEqual(["c", "b", "a"]);
});

test("setting the same view is a no-op", () => {
  let images = [];
  images = addAttachedImage(images, img("a"));
  images = addAttachedImage(images, img("b"));
  const next = setAttachedImageView(images, 1, "left");
  expect(views(next)).toEqual(["front", "left"]);
  expect(names(next)).toEqual(["a", "b"]);
});

test("removing the front chip promotes the earliest remaining view", () => {
  let images = [];
  images = addAttachedImage(images, img("a")); // front
  images = addAttachedImage(images, img("b")); // left
  images = addAttachedImage(images, img("c")); // back
  images = removeAttachedImage(images, 0); // remove a (front) → b promoted
  expect(views(images)).toEqual(["front", "back"]);
  expect(names(images)).toEqual(["b", "c"]);
});

test("promotion picks left over back over right", () => {
  let images = [];
  images = addAttachedImage(images, img("a")); // front
  images = addAttachedImage(images, img("b")); // left
  images = addAttachedImage(images, img("c")); // back
  images = addAttachedImage(images, img("d")); // right
  // Remove left first so only back/right remain, then drop front.
  images = removeAttachedImage(images, 1);
  images = removeAttachedImage(images, 0);
  expect(views(images)).toEqual(["front", "right"]);
  expect(names(images)).toEqual(["c", "d"]);
});

test("removing a non-front chip leaves other views untouched", () => {
  let images = [];
  images = addAttachedImage(images, img("a")); // front
  images = addAttachedImage(images, img("b")); // left
  images = addAttachedImage(images, img("c")); // back
  images = removeAttachedImage(images, 1); // remove left
  expect(views(images)).toEqual(["front", "back"]);
  expect(names(images)).toEqual(["a", "c"]);
});

test("operations never mutate the input array", () => {
  let images = [];
  images = addAttachedImage(images, img("a"));
  images = addAttachedImage(images, img("b"));
  const before = images.map((i) => ({ ...i }));
  setAttachedImageView(images, 0, "left");
  removeAttachedImage(images, 0);
  addAttachedImage(images, img("c"));
  expect(images.map((i) => ({ ...i }))).toEqual(before);
});

test("nextAvailableView fills gaps left by removals", () => {
  let images = [];
  images = addAttachedImage(images, img("a")); // front
  images = addAttachedImage(images, img("b")); // left
  images = addAttachedImage(images, img("c")); // back
  images = removeAttachedImage(images, 1); // gap at left
  expect(nextAvailableView(images)).toBe("left");
  images = addAttachedImage(images, img("d"));
  expect(views(images)).toEqual(["front", "left", "back"]);
  expect(names(images)).toEqual(["a", "d", "c"]);
});

test("VIEW_ORDER stays the canonical front/left/back/right sequence", () => {
  expect(VIEW_ORDER).toEqual(["front", "left", "back", "right"]);
});
