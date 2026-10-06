# syntax=docker/dockerfile:1
# Arbesk app image (backend + frontend statics) for the k3s deployment.
# Multi-stage: the Bun builder compiles frontend assets and the single-file
# server binary (no Node toolchain anywhere in the build); the runtime
# stage carries only what src/index.ts reads at runtime via PROJECT_ROOT
# (ARBESK_ROOT): frontend/dist, blockchain/artifacts, src/api/*.html, the mock
# generation fixtures (mock-gltf-assets), plus a writable .data/
# (token-indexer state — mount a PVC there).
# Env is provided by a mounted .env file (k8s Secret → /app/.env); both env
# files are optional at runtime (src/index.ts try/catches loadEnvFile).
#
# Build for the Pi cluster:  docker buildx build --platform linux/arm64 \
#   -f docker/app.Dockerfile -t ahmadsayed/arbesk:<tag> --push .
#
# The builder runs on the BUILD host's own architecture (no QEMU): everything
# it produces is architecture-independent (frontend/dist, ABIs, package dist)
# except the server binary, which Bun cross-compiles for TARGETARCH. Only the
# small runtime stage is the target architecture.

FROM --platform=$BUILDPLATFORM oven/bun:1-debian AS builder
ARG TARGETARCH
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile \
  && cd frontend && bun install --frozen-lockfile
RUN bun run build:packages \
  && cd frontend && bun run build
# Docker's arch names → Bun's compile targets.
RUN case "$TARGETARCH" in \
      amd64) target=bun-linux-x64 ;; \
      arm64) target=bun-linux-arm64 ;; \
      *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac \
  && bun scripts/build-server.mjs --target="$target"

# The compiled server binary embeds the Bun runtime — no toolchain needed.
FROM debian:bookworm-slim
WORKDIR /app
COPY --from=builder /app/dist/arbesk-server ./arbesk-server
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY --from=builder /app/blockchain/artifacts ./blockchain/artifacts
COPY --from=builder /app/src/api/cli-auth.html ./src/api/cli-auth.html
COPY --from=builder /app/src/api/swagger-ui.html ./src/api/swagger-ui.html
# Mock 3D generation fixtures (used when MOCK_3D_GENERATION=true). The mock
# provider reads `./mock-gltf-assets` relative to the process cwd, which is
# /app here, so the files must land at /app/mock-gltf-assets in the image.
# Keep this list in sync with packages/ai-asset-gen/src/providers/mock.ts
# (intro.gltf = default, box.3mf = "3mf" keyword, howdy.glb = howdy/cowboy,
# suka.gltf = character/figure/person/avatar). Build-time-only renders
# (low-poly/) and test/bench fixtures (triangle.glb, suka.glb, *.orig) are
# deliberately left out; ATTRIBUTION.md travels with the shipped fixtures.
COPY --from=builder /app/mock-gltf-assets/ATTRIBUTION.md \
     /app/mock-gltf-assets/intro.gltf \
     /app/mock-gltf-assets/suka.gltf \
     /app/mock-gltf-assets/howdy.glb \
     /app/mock-gltf-assets/box.3mf \
     ./mock-gltf-assets/
RUN mkdir -p /app/.data
ENV ARBESK_ROOT=/app \
    PORT=9090 \
    NODE_ENV=production
EXPOSE 9090
CMD ["./arbesk-server"]
