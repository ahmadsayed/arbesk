/**
 * Arbesk Parametric Preview
 *
 * Binds Node Inspector inputs to live Babylon.js material/mesh updates.
 * Handles save (POST to backend) and cancel (revert to committed state).
 */

import { updateNodeToVersion, getNodeHistory, appendHistoryEntry, applyColor, applyScale } from './time-travel.js';
import { getNodeMeshes } from './scene-graph.js';

// DOM references
const inspector = document.getElementById('inspector');
const nodeColorInput = document.getElementById('nodeColor');
const nodeScaleX = document.getElementById('nodeScaleX');
const nodeScaleY = document.getElementById('nodeScaleY');
const nodeScaleZ = document.getElementById('nodeScaleZ');
const saveBtn = document.getElementById('saveParametric');
const cancelBtn = document.getElementById('cancelParametric');

const timeline = document.getElementById('timeline');
const versionSlider = document.getElementById('versionSlider');
const versionLabel = document.getElementById('versionLabel');

// State
let activeNodeId = null;
let draftState = null;
let committedState = null;
let isSaving = false;


/**
 * Show the Node Inspector for a given node.
 */
function openInspector(nodeId) {
    activeNodeId = nodeId;
    const meshes = getNodeMeshes(nodeId);
    if (!meshes || meshes.length === 0) return;

    // Read current committed values from the mesh
    const rootMesh = meshes.find(m => m.metadata?.isNodeRoot) || meshes[0];

    let currentColor = '#ffffff';
    let currentScale = { x: 1, y: 1, z: 1 };

    if (rootMesh.material) {
        const color = rootMesh.material.diffuseColor || rootMesh.material.albedoColor;
        if (color) {
            currentColor = color.toHexString();
        }
    }

    currentScale = {
        x: rootMesh.scaling.x,
        y: rootMesh.scaling.y,
        z: rootMesh.scaling.z
    };

    committedState = {
        color: currentColor,
        scale: { ...currentScale }
    };

    draftState = {
        color: currentColor,
        scale: { ...currentScale }
    };

    // Set inputs
    nodeColorInput.value = currentColor;
    nodeScaleX.value = currentScale.x;
    nodeScaleY.value = currentScale.y;
    nodeScaleZ.value = currentScale.z;

    // Show inspector
    inspector.hidden = false;

    // Mint button removed — saving is now handled by sidebar Save World button

    // Bind timeline
    bindTimeline(nodeId);
}

/**
 * Close the inspector and reset state.
 */
function closeInspector() {
    activeNodeId = null;
    draftState = null;
    committedState = null;
    inspector.hidden = true;
    timeline.hidden = true;
}

/**
 * Bind the timeline slider to the node's history.
 */
function bindTimeline(nodeId) {
    const history = getNodeHistory(nodeId);
    if (history.length > 1) {
        timeline.hidden = false;
        versionSlider.min = 0;
        versionSlider.max = history.length - 1;
        versionSlider.value = history.length - 1;
        versionLabel.textContent = `v${history.length}`;
    } else {
        timeline.hidden = true;
    }
}

/**
 * Live preview: update mesh color from input.
 */
function onColorChange() {
    if (!activeNodeId || !draftState) return;
    draftState.color = nodeColorInput.value;
    const meshes = getNodeMeshes(activeNodeId);
    applyColor(meshes, draftState.color);
}

/**
 * Live preview: update mesh scale from inputs.
 */
function onScaleChange() {
    if (!activeNodeId || !draftState) return;
    draftState.scale = {
        x: parseFloat(nodeScaleX.value),
        y: parseFloat(nodeScaleY.value),
        z: parseFloat(nodeScaleZ.value)
    };
    const meshes = getNodeMeshes(activeNodeId);
    applyScale(meshes, draftState.scale);
}

/**
 * Save parametric version to backend.
 */
async function onSave() {
    if (!activeNodeId || isSaving) return;
    isSaving = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    try {
        const body = {
            nodeId: activeNodeId,
            prevManifestCid: window.activeManifestId,
            color: draftState.color !== committedState.color ? draftState.color : undefined,
            scale: (
                draftState.scale.x !== committedState.scale.x ||
                draftState.scale.y !== committedState.scale.y ||
                draftState.scale.z !== committedState.scale.z
            ) ? draftState.scale : undefined
        };

        // Only send if something changed
        if (!body.color && !body.scale) {
            closeInspector();
            isSaving = false;
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Parametric Version';
            return;
        }

        const response = await fetch('/api/parametric-version', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || `HTTP ${response.status}`);
        }

        const result = await response.json();

        // Update global manifest
        window.activeManifestId = result.newManifestCid;
        window.latestManifestId = result.newManifestCid;

        // Append to local history
        appendHistoryEntry(activeNodeId, result.historyEntry);

        // Update committed state to draft state
        committedState = {
            color: draftState.color,
            scale: { ...draftState.scale }
        };

        // Refresh timeline
        bindTimeline(activeNodeId);

        document.dispatchEvent(new CustomEvent('parametric:save', {
            detail: { nodeId: activeNodeId, result }
        }));

        document.dispatchEvent(new CustomEvent('manifest:saved', {
            detail: { cid: result.newManifestCid }
        }));

        closeInspector();
    } catch (error) {
        console.error('Failed to save parametric version:', error);
        alert('Save failed: ' + error.message);
    } finally {
        isSaving = false;
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Parametric Version';
    }
}

/**
 * Cancel: revert mesh to last committed state.
 */
function onCancel() {
    if (!activeNodeId || !committedState) return;
    const meshes = getNodeMeshes(activeNodeId);
    applyColor(meshes, committedState.color);
    applyScale(meshes, committedState.scale);
    closeInspector();
}

/**
 * Timeline slider change handler.
 */
function onTimelineChange() {
    if (!activeNodeId) return;
    const index = parseInt(versionSlider.value, 10);
    updateNodeToVersion(activeNodeId, index);
    const history = getNodeHistory(activeNodeId);
    const entry = history[index];
    versionLabel.textContent = `v${entry?.v || index + 1}`;
}

// Event bindings
document.addEventListener('node:selected', (e) => {
    openInspector(e.detail.nodeId);
});

if (nodeColorInput) nodeColorInput.addEventListener('input', onColorChange);
if (nodeScaleX) nodeScaleX.addEventListener('input', onScaleChange);
if (nodeScaleY) nodeScaleY.addEventListener('input', onScaleChange);
if (nodeScaleZ) nodeScaleZ.addEventListener('input', onScaleChange);
if (saveBtn) saveBtn.addEventListener('click', onSave);
if (cancelBtn) cancelBtn.addEventListener('click', onCancel);
if (versionSlider) versionSlider.addEventListener('input', onTimelineChange);

// Mint button
document.addEventListener('wallet:connected', () => {
    // No-op: mint button removed from inspector
});
document.addEventListener('wallet:disconnected', () => {
    // No-op: mint button removed from inspector
});

export { openInspector, closeInspector };
