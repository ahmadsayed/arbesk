# Arbesk on k3s (promptscad.com)

Deploys Arbesk to the `ender3` k3s cluster (ssh `adam@192.168.68.60`,
`sudo k3s kubectl ...`), serving `https://promptscad.com`. TLS terminates at
Cloudflare; the cluster receives plain HTTP on Traefik port 80.

## One-command deploy

```bash
bun run deploy:k3s   # = scripts/deploy-k3s.mjs
```

Every run regenerates `.env.k3s` from the current local `.env` /
`blockchain/.env`, recreates the `arbesk-env` secret, rebuilds and pushes the
arm64 image with a fresh `MMDDHHMM` tag, stamps the tag into
`deployment.yaml`, applies all manifests, and waits for the rollout. No
staleness checks — latest code and config ship every time. Override the SSH
target with `K3S_SSH=user@host`.

The manual steps below document what the command does under the hood.

## Workloads

| Component | Kind | Storage |
|---|---|---|
| `arbesk` app (backend + frontend + in-process token indexer) | Deployment, 1 replica (Recreate) | PVC `arbesk-data` → `/app/.data` |
| `nostr` relay (nostr-rs-relay) | Deployment, 1 replica | PVC `nostr-data` → `/usr/src/app/db` |

Both PVCs use the default `local-path` StorageClass (host disk). IPFS is
Pinata (external), chain is Base Sepolia (external) — nothing else runs
in-cluster.

## First-time setup

1. Build & push the image (arm64 for the Pi):
   ```bash
   docker buildx build --platform linux/arm64 \
     -f docker/app.Dockerfile -t ahmadsayed/arbesk:$(date +%m%d%H%M) --push .
   ```
   Set the tag in `deployment.yaml` (replace `REPLACE_TAG`).

2. Prepare `.env.k3s` (never commit it) with the testnet values — see
   `.env.example` for the full reference. Required:
   ```
   IPFS_BACKEND=pinata
   PINATA_JWT=...
   PINATA_GATEWAY=...
   DEFAULT_CHAIN_ID=84532
   API_URL=https://sepolia.base.org
   CONTRACT_ADDRESS=...        # Base Sepolia deployment (from blockchain/.env)
   PAID_CONTRACT_ADDRESS=...
   USDC_TOKEN=...
   NOSTR_RELAY_URL=ws://nostr:7777
   PUBLIC_NOSTR_URL=wss://promptscad.com/nostr
   PUBLIC_ORIGIN=https://promptscad.com
   NOSTR_SERVICE_PRIVATE_KEY=...
   CDP_PROJECT_ID=...
   CDP_PAYMASTER_URL=...
   CDP_API_KEY_ID=...
   CDP_API_KEY_SECRET=...
   CDP_WALLET_SECRET=...
   RESEND_API_KEY=...
   GC_ADMIN_TOKEN=...
   MOCK_3D_GENERATION=false
   ```

3. Create the secret (whole file under the `.env` key, mounted at `/app/.env`):
   ```bash
   ssh adam@192.168.68.60 'sudo k3s kubectl create secret generic arbesk-env \
     --from-file=.env=/dev/stdin' < .env.k3s
   ```

4. Apply in order:
   ```bash
   for f in storage nostr deployment service ingress; do
     ssh adam@192.168.68.60 'sudo k3s kubectl apply -f -' < deploy/k8s/$f.yaml
   done
   ```

5. Once `deploy/arbesk` is ready, hand the root path over from the legacy app:
   ```bash
   ssh adam@192.168.68.60 'sudo k3s kubectl delete ingress promptscad'
   ```
   (The legacy app keeps serving `www.promptscad.com`.)

## Updates

`bun run deploy:k3s` handles the full update loop. Manual equivalent: rebuild +
push a new tag, update `deployment.yaml`, re-apply. Strategy is `Recreate`
(in-memory sessions + RWO volume): expect a few seconds of downtime.

## Verify

- `curl https://promptscad.com/api/v1/config` → `defaultChainId: 84532`,
  `ipfsBackend: "pinata"`, `nostrPublicUrl: "wss://promptscad.com/nostr"`
- Browser: testnet banner visible, SIWE login, CDP email login (requires the
  CDP Portal domain allowlist), comments live-update over `/nostr` WSS.
