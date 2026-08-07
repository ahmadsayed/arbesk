/**
 * @jest-environment jsdom
 *
 * Inspector animation preview: the Animations section appears only for a
 * single selected node that has animation groups; choosing a clip plays it
 * looped, "None" / deselect / multi-select stop playback.
 */
import { jest, expect, test, beforeAll, beforeEach } from "@jest/globals";

let emit, EVENTS, state;

function makeGroup(name) {
  return { name, start: jest.fn(), stop: jest.fn(), reset: jest.fn() };
}

function section() {
  return document.getElementById("animationsSection");
}
function select() {
  return /** @type {HTMLSelectElement} */ (document.getElementById("animationSelect"));
}

beforeAll(async () => {
  document.body.innerHTML = `
    <section id="animationsSection" class="inspector-section" hidden>
      <details><summary class="inspector-section-title">Animations</summary></details>
      <select id="animationSelect" class="form-select" aria-label="Animation clip">
        <option value="">None</option>
      </select>
    </section>`;
  ({ emit, EVENTS } = await import("../../frontend/src/js/events/bus.js"));
  ({ state } = await import("../../frontend/src/js/engine/state.js"));
  await import("../../frontend/src/js/engine/animation-preview.js");
});

beforeEach(() => {
  state.nodeAnimationGroups.clear();
  state.selectedNodeIds = new Set();
  section().hidden = true;
  select().innerHTML = '<option value="">None</option>';
});

test("stays hidden for a node without animations", () => {
  state.selectedNodeIds = new Set(["n1"]);
  emit(EVENTS.NODE_SELECTED, { nodeId: "n1" });
  expect(section().hidden).toBe(true);
});

test("lists animation names for an animated node, None first", () => {
  state.nodeAnimationGroups.set("n2", [makeGroup("run"), makeGroup("")]);
  state.selectedNodeIds = new Set(["n2"]);
  emit(EVENTS.NODE_SELECTED, { nodeId: "n2" });
  expect(section().hidden).toBe(false);
  const labels = [...select().options].map((o) => o.textContent);
  expect(labels).toEqual(["None", "run", "Animation 2"]);
});

test("selecting a clip plays it looped; switching stops the previous", () => {
  const groups = [makeGroup("run"), makeGroup("idle")];
  state.nodeAnimationGroups.set("n3", groups);
  state.selectedNodeIds = new Set(["n3"]);
  emit(EVENTS.NODE_SELECTED, { nodeId: "n3" });

  select().value = "0";
  select().dispatchEvent(new Event("change"));
  expect(groups[0].start).toHaveBeenCalledWith(true);

  select().value = "1";
  select().dispatchEvent(new Event("change"));
  expect(groups[0].stop).toHaveBeenCalled();
  expect(groups[1].start).toHaveBeenCalledWith(true);
});

test("None stops playback", () => {
  const groups = [makeGroup("run")];
  state.nodeAnimationGroups.set("n4", groups);
  state.selectedNodeIds = new Set(["n4"]);
  emit(EVENTS.NODE_SELECTED, { nodeId: "n4" });
  select().value = "0";
  select().dispatchEvent(new Event("change"));

  select().value = "";
  select().dispatchEvent(new Event("change"));
  expect(groups[0].stop).toHaveBeenCalled();
});

test("deselect stops playback and hides the section", () => {
  const groups = [makeGroup("run")];
  state.nodeAnimationGroups.set("n5", groups);
  state.selectedNodeIds = new Set(["n5"]);
  emit(EVENTS.NODE_SELECTED, { nodeId: "n5" });
  select().value = "0";
  select().dispatchEvent(new Event("change"));

  state.selectedNodeIds = new Set();
  emit(EVENTS.SELECTION_CHANGED, { nodeIds: [] });
  expect(groups[0].stop).toHaveBeenCalled();
  expect(section().hidden).toBe(true);
});

test("multi-select hides the section and stops playback", () => {
  const groups = [makeGroup("run")];
  state.nodeAnimationGroups.set("n6", groups);
  state.selectedNodeIds = new Set(["n6"]);
  emit(EVENTS.NODE_SELECTED, { nodeId: "n6" });
  select().value = "0";
  select().dispatchEvent(new Event("change"));

  state.selectedNodeIds = new Set(["n6", "n7"]);
  emit(EVENTS.SELECTION_CHANGED, { nodeIds: ["n6", "n7"] });
  expect(groups[0].stop).toHaveBeenCalled();
  expect(section().hidden).toBe(true);
});

test("SCENE_CLEARED stops playback and hides the section", () => {
  const groups = [makeGroup("run")];
  state.nodeAnimationGroups.set("n8", groups);
  state.selectedNodeIds = new Set(["n8"]);
  emit(EVENTS.NODE_SELECTED, { nodeId: "n8" });
  select().value = "0";
  select().dispatchEvent(new Event("change"));

  emit(EVENTS.SCENE_CLEARED, {});
  expect(groups[0].stop).toHaveBeenCalled();
  expect(section().hidden).toBe(true);
});
