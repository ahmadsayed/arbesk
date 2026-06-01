import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

export default function abiRouter() {
    const router = Router();

    router.get('/ArbeskWorld.json', (req, res) => {
        const abiPath = path.resolve(__dirname, '../../blockchain/artifacts/contracts/ArbeskWorld.sol/ArbeskWorld.json');
        if (!fs.existsSync(abiPath)) {
            console.log(`[ABI] not found at ${abiPath}`);
            return res.status(404).json({ error: 'ABI not found. Run: docker-compose run --rm hardhat npx hardhat compile' });
        }
        console.log(`[ABI] serving ${abiPath}`);
        res.setHeader('Content-Type', 'application/json');
        res.sendFile(abiPath);
    });

    return router;
}
