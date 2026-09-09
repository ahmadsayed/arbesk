# syntax=docker/dockerfile:1
# arm64 build of scsibug/nostr-rs-relay (upstream is archived and its Docker
# image is amd64-only) for the Raspberry Pi k3s cluster.
#
# The Pi 5 kernel uses 16K pages; prebuilt binaries with jemalloc abort with
# "Unsupported system page size". JEMALLOC_SYS_WITH_LG_PAGE=14 compiles
# jemalloc for 16K pages. The build cross-compiles natively (no QEMU).
#
# Build:  docker buildx build --builder multiplatform-builder --platform linux/arm64 \
#           -f docker/nostr-relay.Dockerfile -t ahmadsayed/nostr-rs-relay:<tag> --push .

FROM --platform=$BUILDPLATFORM rust:1-bookworm AS builder
RUN apt-get update \
  && apt-get install -y --no-install-recommends gcc-aarch64-linux-gnu libc6-dev-arm64-cross protobuf-compiler \
  && rm -rf /var/lib/apt/lists/*
RUN rustup target add aarch64-unknown-linux-gnu
WORKDIR /src
# Upstream repo is archived; pin the final master commit for reproducibility.
RUN git clone --depth 1 https://github.com/scsibug/nostr-rs-relay.git .
ENV CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc \
    JEMALLOC_SYS_WITH_LG_PAGE=14
RUN cargo build --release --target aarch64-unknown-linux-gnu

FROM debian:bookworm-slim
WORKDIR /usr/src/app
COPY --from=builder /src/target/aarch64-unknown-linux-gnu/release/nostr-rs-relay /usr/local/bin/nostr-rs-relay
# config.toml is mounted by k8s (ConfigMap) at /usr/src/app/config.toml and
# read from the working directory; the SQLite PVC mounts at /usr/src/app/db.
EXPOSE 7777
CMD ["nostr-rs-relay"]
