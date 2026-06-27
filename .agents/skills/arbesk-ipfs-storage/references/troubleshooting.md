# Troubleshooting — Arbesk IPFS & Storage

Manual CLI operations and symptom/cause/fix reference.

## 12. Common Operations

### Manually unpin a CID
```bash
# From the host (Kubo HTTP API)
curl -X POST "http://127.0.0.1:5001/api/v0/pin/rm?arg=bafySomeCid..."

# Inside the container
docker-compose exec ipfs ipfs pin rm bafySomeCid...
```

### List all pinned CIDs
```bash
docker-compose exec ipfs ipfs pin ls
```

### Trigger garbage collection manually
```bash
docker-compose exec ipfs ipfs repo gc
```

### Check repo size
```bash
docker-compose exec ipfs ipfs repo stat
```

### Add a file and pin it explicitly
```bash
# Via CLI (auto-pins)
docker-compose exec ipfs ipfs add somefile.gltf

# Via HTTP API
curl -X POST -F "file=@somefile.gltf" "http://127.0.0.1:5001/api/v0/add"
curl -X POST "http://127.0.0.1:5001/api/v0/pin/add?arg=bafyReturnedCid..."
```

---

## 13. Troubleshooting

| Symptom | Likely cause | Check |
|---------|-------------|-------|
| `[IPFS] cat <cid> → fetch aborted` | Timeout (15s) — large file or node unresponsive | Check Docker resource limits; increase timeout in `catManifest()` |
| `ipfs.add()` returns but content not found | Node not initialized or corrupted repo | Check `docker-compose logs ipfs` for init errors |
| GC removes content unexpectedly | Content was not pinned, or `StorageMax` too low | Verify `StorageMax` (100 GB); check pin list |
| Frontend IPFS writes fail with CORS | CORS headers not configured | Entrypoint sets `Access-Control-Allow-Origin: *` for API and Gateway |
| Backend `Connection refused` on 5001 | IPFS container not running | `docker-compose up -d ipfs` |
| `ipfs.pin.rm` fails with "not pinned or pinned indirectly" | CID was never explicitly pinned (recursive vs direct pin) | Use `ipfs.pin.rm` with `--recursive` flag if it's a recursive pin |
