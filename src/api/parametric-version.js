import { Router } from 'express';

const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{6})$/;

export default function parametricVersion(ipfs) {
    const router = Router();

    router.post('/', async (req, res) => {
        try {
            const { nodeId, color, scale, prevManifestCid } = req.body;
            console.log(`[PARAM] nodeId=${nodeId} color=${color || 'none'} scale=${scale ? `${scale.x},${scale.y},${scale.z}` : 'none'} prev=${prevManifestCid}`);
            if (!nodeId || !prevManifestCid) {
                console.log(`[PARAM] rejected — nodeId and prevManifestCid required`);
                return res.status(400).json({ error: 'nodeId and prevManifestCid are required' });
            }

            // Validate color
            if (color && !HEX_COLOR_REGEX.test(color)) {
                console.log(`[PARAM] rejected — invalid color "${color}"`);
                return res.status(400).json({ error: 'color must be a valid hex color (#RRGGBB)' });
            }

            // Validate scale
            if (scale) {
                if (typeof scale !== 'object' ||
                    typeof scale.x !== 'number' || scale.x <= 0 ||
                    typeof scale.y !== 'number' || scale.y <= 0 ||
                    typeof scale.z !== 'number' || scale.z <= 0) {
                    console.log(`[PARAM] rejected — invalid scale`);
                    return res.status(400).json({ error: 'scale must be an object with positive x, y, z numbers' });
                }
            }

            // Read current manifest from IPFS
            console.log(`[IPFS] cat prev manifest ${prevManifestCid}`);
            let data = '';
            for await (const file of ipfs.cat(prevManifestCid)) {
                const buffer = new Uint16Array(file);
                buffer.forEach(code => { data += String.fromCharCode(code); });
            }
            const manifest = JSON.parse(data);
            console.log(`[PARAM] loaded manifest version=${manifest.version} nodes=${(manifest.nodes || []).length}`);

            // Find node
            const node = manifest.nodes.find(n => n.node_id === nodeId);
            if (!node) {
                console.log(`[PARAM] rejected — node ${nodeId} not found`);
                return res.status(404).json({ error: `Node ${nodeId} not found in manifest` });
            }

            // Build source reference from node.source object
            if (!node.source || typeof node.source !== 'object') {
                return res.status(400).json({ error: `Node ${nodeId} has no source reference` });
            }
            const srcRef = { ...node.source };

            // Append parametric history entry
            const nextVersion = node.history.length + 1;
            const historyEntry = {
                v: nextVersion,
                timestamp: Date.now(),
                src: srcRef,
                prompt: `Scale ${scale ? `${scale.x}x,${scale.y}x,${scale.z}x` : '1x,1x,1x'}, Color ${color || 'unchanged'}`,
                provider: 'parametric',
                type: 'parametric',
                params: {
                    scale: scale || { x: 1, y: 1, z: 1 },
                    color: color || null
                }
            };

            node.history.push(historyEntry);
            manifest.version += 1;
            manifest.prev_manifest_cid = prevManifestCid;

            // Write updated manifest to IPFS
            console.log(`[IPFS] add manifest | version=${manifest.version}`);
            const { cid: newManifestCid } = await ipfs.add(JSON.stringify(manifest));
            const newManifestCidStr = newManifestCid.toString();
            console.log(`[PARAM] success → ${newManifestCidStr} history_v=${historyEntry.v}`);

            res.json({
                newManifestCid: newManifestCidStr,
                historyEntry
            });
        } catch (error) {
            console.error('[PARAM] error:', error.message);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}
