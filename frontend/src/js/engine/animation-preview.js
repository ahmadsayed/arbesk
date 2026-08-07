/**
 * Arbesk Animation Preview
 *
 * Inspector "Animations" section: when the single selected node's model
 * contains glTF animation groups (captured per nodeId in
 * state.nodeAnimationGroups by scene-loader), the user can pick a clip to
 * preview it looped in the viewport. Purely ephemeral — nothing is staged
 * or persisted. Babylon's glTF loader is configured with
 * animationStartMode NONE (babylon-loader.js) so nothing auto-plays.
 */

import { on, EVENTS } from "../events/bus.js";
import { state } from "./state.js";

const animationsSection = document.getElementById("animationsSection");
const animationsSectionDetails = animationsSection?.querySelector("details");
/** @type {HTMLSelectElement|null} */
const animationSelect = /** @type {HTMLSelectElement|null} */ (
  document.getElementById("animationSelect")
);

/** @type {BABYLON.AnimationGroup|null} */
let playingGroup = null;
/** @type {string|null} */
let activeNodeId = null;

/**
 * Stop the currently previewing group (if any) and return it to frame 0.
 */
function stopPlayingGroup() {
  if (!playingGroup) return;
  try {
    playingGroup.stop();
    playingGroup.reset();
  } catch {
    // group already disposed with its node — nothing to stop
  }
  playingGroup = null;
}

/**
 * Stop playback, hide the section, reset the dropdown.
 */
function hideAnimationsSection() {
  stopPlayingGroup();
  activeNodeId = null;
  if (animationsSection) animationsSection.hidden = true;
  if (animationSelect) animationSelect.value = "";
}

/**
 * Populate the dropdown from the node's animation groups and show the
 * section. Groups without a name get a positional label.
 *
 * @param {string} nodeId
 */
function showAnimationsForNode(nodeId) {
  if (!animationsSection || !animationSelect) return;
  stopPlayingGroup();
  activeNodeId = nodeId;

  const groups = state.nodeAnimationGroups.get(nodeId) || [];
  if (groups.length === 0) {
    animationsSection.hidden = true;
    return;
  }

  animationSelect.innerHTML = "";
  const noneOption = document.createElement("option");
  noneOption.value = "";
  noneOption.textContent = "None";
  animationSelect.appendChild(noneOption);
  groups.forEach((group, i) => {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = group.name || `Animation ${i + 1}`;
    animationSelect.appendChild(option);
  });
  animationSelect.value = "";
  animationsSection.hidden = false;
  if (animationsSectionDetails) animationsSectionDetails.open = true;
}

on(EVENTS.NODE_SELECTED, (/** @type {{nodeId?: string}} */ e) => {
  if (state.selectedNodeIds.size > 1 || !e?.nodeId) {
    hideAnimationsSection();
    return;
  }
  showAnimationsForNode(e.nodeId);
});

// Multi-select or full deselect: single-node preview no longer applies.
on(EVENTS.SELECTION_CHANGED, (/** @type {{nodeIds?: string[]}} */ e) => {
  const count = Array.isArray(e?.nodeIds) ? e.nodeIds.length : 0;
  if (count !== 1) hideAnimationsSection();
});

on(EVENTS.SCENE_CLEARED, hideAnimationsSection);

if (animationSelect) {
  animationSelect.addEventListener("change", () => {
    stopPlayingGroup();
    if (!activeNodeId || animationSelect.value === "") return;
    const groups = state.nodeAnimationGroups.get(activeNodeId) || [];
    const group = groups[Number(animationSelect.value)];
    if (!group) return;
    try {
      group.start(true); // loop the preview
      playingGroup = group;
    } catch (error) {
      const err = /** @type {Error} */ (error);
      console.warn(`[ANIM] preview start failed: ${err.message}`);
      animationSelect.value = "";
    }
  });
}
