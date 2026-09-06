import express from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { PROJECT_ROOT } from './project-root.ts';

const Router = express.Router;

const ABI_MAP: Record<string, string> = {
    'ArbeskAsset.json': 'blockchain/artifacts/contracts/ArbeskAsset.sol/ArbeskAsset.json',
    'ArbeskAssetFree.json': 'blockchain/artifacts/contracts/ArbeskAssetFree.sol/ArbeskAssetFree.json',
};

export default function abiRouter() {
    const router = Router();

    for (const [route, relativePath] of Object.entries(ABI_MAP)) {
        router.get(`/${route}`, (req: Request, res: Response) => {
            const abiPath = path.resolve(PROJECT_ROOT, relativePath);
            if (!fs.existsSync(abiPath)) {
                console.log(`[ABI] not found at ${abiPath}`);
                return res.status(404).json({ error: `ABI not found. Run: docker compose run --rm hardhat npx hardhat compile` });
            }
            console.log(`[ABI] serving ${abiPath}`);
            res.setHeader('Content-Type', 'application/json');
            res.sendFile(abiPath);
        });
    }

    return router;
}
