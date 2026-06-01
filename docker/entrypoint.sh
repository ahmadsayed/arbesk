#!/bin/sh
set -e

# Initialize IPFS repo if it doesn't exist yet
if [ ! -f "$IPFS_PATH/config" ]; then
    echo "Initializing IPFS repository..."
    ipfs init
fi

# Private-only: no public peers, no DHT, no NAT traversal, no relays.
# The node still runs libp2p but is fully isolated from the public network.
ipfs bootstrap rm --all >/dev/null 2>&1 || true
ipfs config Routing.Type none
ipfs config --json Swarm.DisableNatPortMap true
ipfs config --json Swarm.EnableHolePunching false
ipfs config --json Swarm.RelayClient.Enabled false
ipfs config --json Swarm.RelayService '{"Enabled": false}'

# Provide announces blocks to the routing layer on a timer. Routing is off so
# it would be a no-op anyway — kill the scheduler explicitly.
# (Kubo 0.41 renamed the legacy Reprovider.* keys to Provide.*; setting the
# old names triggers a fatal deprecation error on startup.)
ipfs config --json Provide.Enabled false

# MDNS broadcasts to find LAN peers; we never use them.
ipfs config --json Discovery.MDNS.Enabled false

# Bind API and Gateway to all container interfaces (compose maps them to 127.0.0.1).
# Bind swarm to loopback inside the container so it cannot reach the host network.
ipfs config Addresses.API /ip4/0.0.0.0/tcp/5001
ipfs config Addresses.Gateway /ip4/0.0.0.0/tcp/8080
ipfs config Addresses.Swarm --json '["/ip4/127.0.0.1/tcp/4001"]'

# Drop any announce/append addresses left from prior runs and refuse to dial public space.
ipfs config Addresses.Announce --json '[]'
ipfs config Addresses.AppendAnnounce --json '[]'
ipfs config Addresses.NoAnnounce --json '["/ip4/0.0.0.0/ipcidr/0","/ip6/::/ipcidr/0"]'

# Default 10 GB is too tight: a 7.5 GB model + GC watermark (90%) triggers
# garbage collection mid-publish. 100 GB matches the native-install README.
ipfs config Datastore.StorageMax 100GB

# CORS for local development access
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["*"]'
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '["PUT","POST","GET"]'
ipfs config --json Gateway.HTTPHeaders.Access-Control-Allow-Origin '["*"]'

exec ipfs daemon --migrate=true
