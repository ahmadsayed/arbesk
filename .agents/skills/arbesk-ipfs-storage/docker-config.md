# Docker IPFS Configuration — Arbesk IPFS & Storage

Kubo container setup, isolation config, and storage volumes.

## 9. Docker IPFS Configuration

| File | Purpose |
|------|---------|
| `docker/Dockerfile` | Base image `ipfs/kubo:latest`, copies entrypoint |
| `docker/entrypoint.sh` | Initializes repo, applies isolation config, starts daemon |
| `docker-compose.yml` | `ipfs` service definition, port mappings, volume mounts |

### Key Config Values (set in entrypoint.sh)

```sh
ipfs config Routing.Type none
ipfs config --json Swarm.DisableNatPortMap true
ipfs config --json Swarm.EnableHolePunching false
ipfs config --json Swarm.RelayClient.Enabled false
ipfs config --json Swarm.RelayService '{"Enabled": false}'
ipfs config --json Provide.Enabled false
ipfs config --json Discovery.MDNS.Enabled false
ipfs config Addresses.Swarm --json '["/ip4/127.0.0.1/tcp/4001"]'
ipfs config Datastore.StorageMax 100GB
```

### Storage Volume

IPFS data is mounted at `./ipfs-data:/data/ipfs` in `docker-compose.yml`. This persists blocks, pins, and repo state across container restarts.
