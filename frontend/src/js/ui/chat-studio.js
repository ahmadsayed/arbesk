/**
 * Arbesk Chat Studio UI Controller
 *
 * Real PayGo generation flow: wallet payment → backend generation →
 * manifest load → scene graph registration.
 */

import { loadManifest, clearScene, hideWelcomeOverlay } from '../engine/scene-graph.js';
import { payForGeneration } from '../blockchain/wallet.js';
import { generateAsset, ApiError } from '../services/api.js';

// ─── DOM References ───
const chatHistory = document.getElementById('chatHistory');
const promptInput = document.getElementById('promptInput');
const generateBtn = document.getElementById('generateBtn');
const waitingOverlay = document.getElementById('waitingOverlay');
const waitingText = document.getElementById('waitingText');
const chatSidebar = document.getElementById('chatSidebar');
const toggleChatBtn = document.getElementById('toggleChatBtn');
const showSidebarBtn = document.getElementById('showSidebarBtn');
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const mainStage = document.getElementById('mainStage');

// Asset definition inputs (added in Phase 4; optional until then)
const assetNameInput = document.getElementById('assetName');
const providerSelect = document.getElementById('providerSelect');
const posX = document.getElementById('posX');
const posY = document.getElementById('posY');
const posZ = document.getElementById('posZ');
const rotX = document.getElementById('rotX');
const rotY = document.getElementById('rotY');
const rotZ = document.getElementById('rotZ');
const sclX = document.getElementById('scaleX');
const sclY = document.getElementById('scaleY');
const sclZ = document.getElementById('scaleZ');

// ─── Chat Messages ───

function addChatMessage(role, text) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble chat-bubble-${role}`;
    bubble.textContent = text;
    chatHistory.appendChild(bubble);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

// ─── Waiting Overlay ───

function setWaitingStep(label) {
    if (waitingText) waitingText.textContent = label;
    waitingOverlay.classList.remove('hidden');
    generateBtn.disabled = true;
}

function hideWaiting() {
    waitingOverlay.classList.add('hidden');
    generateBtn.disabled = false;
}

// ─── Asset Definition Helpers ───

function getAssetName() {
    return (assetNameInput?.value || 'Asset').trim();
}

function getProvider() {
    return providerSelect?.value || 'mock';
}

function toRad(deg) {
    return (parseFloat(deg) || 0) * (Math.PI / 180);
}

function toFloat(v, def) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : def;
}

/**
 * Build a 4×4 column-major transform matrix from position/rotation/scale inputs.
 */
function buildTransformMatrix() {
    const px = toFloat(posX?.value, 0);
    const py = toFloat(posY?.value, 0);
    const pz = toFloat(posZ?.value, 0);

    const rx = toRad(rotX?.value);
    const ry = toRad(rotY?.value);
    const rz = toRad(rotZ?.value);

    const sx = toFloat(sclX?.value, 1);
    const sy = toFloat(sclY?.value, 1);
    const sz = toFloat(sclZ?.value, 1);

    const cx = Math.cos(rx), sx_ = Math.sin(rx);
    const cy = Math.cos(ry), sy_ = Math.sin(ry);
    const cz = Math.cos(rz), sz_ = Math.sin(rz);

    // Rotation matrix R = Rz * Ry * Rx
    const r00 = cy * cz;
    const r01 = sx_ * sy_ * cz - cx * sz_;
    const r02 = cx * sy_ * cz + sx_ * sz_;
    const r10 = cy * sz_;
    const r11 = sx_ * sy_ * sz_ + cx * cz;
    const r12 = cx * sy_ * sz_ - sx_ * cz;
    const r20 = -sy_;
    const r21 = sx_ * cy;
    const r22 = cx * cy;

    // Scale * Rotation, then translation in last column
    return [
        r00 * sx, r01 * sy, r02 * sz, 0,
        r10 * sx, r11 * sy, r12 * sz, 0,
        r20 * sx, r21 * sy, r22 * sz, 0,
        px,       py,       pz,       1
    ];
}

// ─── Generation Flow ───

async function onGenerate() {
    const prompt = promptInput.value.trim();
    if (!prompt) return;

    // Wallet check
    if (!window.walletAddress) {
        alert('Please connect your wallet first.');
        return;
    }

    addChatMessage('user', prompt);
    promptInput.value = '';
    promptInput.style.height = 'auto';

    setWaitingStep('Confirming payment in wallet…');

    const assetName = getAssetName();
    const nodeId = `${assetName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`;
    const prevManifestCid = window.activeManifestId || undefined;
    const transformMatrix = buildTransformMatrix();

    try {
        // 1. On-chain payment
        const txHash = await payForGeneration(nodeId, prompt);
        if (!txHash) {
            throw new Error('Payment was cancelled or failed.');
        }

        setWaitingStep('Carving your model…');

        // 2. Backend generation
        const result = await generateAsset({
            prompt,
            nodeId,
            txHash,
            provider: getProvider(),
            prevManifestCid,
            transformMatrix
        });

        // 3. Load new manifest
        if (prevManifestCid) {
            clearScene();
        }

        window.activeManifestId = result.newManifestCid;
        window.latestManifestId = result.newManifestCid;

        // Update URL — use ?world if we have a tokenId, otherwise ?manifest for drafts
        const url = new URL(window.location);
        if (window.activeTokenId) {
            url.searchParams.set('world', window.activeTokenId);
            url.searchParams.delete('manifest');
        } else {
            url.searchParams.set('manifest', result.newManifestCid);
        }
        window.history.pushState({}, '', url);

        await loadManifest(result.newManifestCid);
        hideWelcomeOverlay();

        addChatMessage('system',
            `Model carved via ${result.historyEntry.provider}. Version ${result.historyEntry.v}.`);

    } catch (err) {
        console.error('Generation failed:', err);
        let userMsg = 'Generation failed. Please try again.';

        if (err instanceof ApiError) {
            if (err.status === 409) {
                userMsg = 'This payment was already used. A new payment is required.';
            } else if (err.status === 429) {
                userMsg = 'Rate limit reached. Please wait before generating again.';
            } else if (err.status === 403) {
                userMsg = 'Payment validation failed. Ensure the transaction succeeded.';
            } else if (err.status === 501) {
                userMsg = 'Cloud generation is not yet enabled. Switch to mock mode.';
            } else if (err.message) {
                userMsg = err.message;
            }
        } else if (err.message) {
            userMsg = err.message;
        }

        addChatMessage('system', userMsg);
    } finally {
        hideWaiting();
    }
}

// ─── Sidebar Toggle ───

function toggleChat() {
    chatSidebar.classList.toggle('collapsed');
}

function toggleMobileMenu() {
    chatSidebar.classList.toggle('open');
}

// ─── Asset Definition Toggle ───

const toggleAssetDef = document.getElementById('toggleAssetDef');
const assetDefBody = document.querySelector('.asset-def-body');

if (toggleAssetDef && assetDefBody) {
    toggleAssetDef.addEventListener('click', () => {
        const hidden = assetDefBody.hidden;
        assetDefBody.hidden = !hidden;
        toggleAssetDef.classList.toggle('open', hidden);
    });
}

// ─── Event Bindings ───

generateBtn.addEventListener('click', onGenerate);
toggleChatBtn.addEventListener('click', toggleChat);
if (showSidebarBtn) showSidebarBtn.addEventListener('click', toggleChat);
if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', toggleMobileMenu);

// Enter to submit, Shift+Enter for newline
promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onGenerate();
    }
});

// Auto-resize textarea
promptInput.addEventListener('input', () => {
    promptInput.style.height = 'auto';
    promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
});

// Close mobile sidebar when clicking outside
if (mainStage) {
    mainStage.addEventListener('click', () => {
        if (chatSidebar.classList.contains('open')) {
            chatSidebar.classList.remove('open');
        }
    });
}

// ─── Exports ───
export { addChatMessage };
