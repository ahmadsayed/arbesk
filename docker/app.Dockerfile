# syntax=docker/dockerfile:1
# Arbesk app image (backend + frontend statics) for the k3s deployment.
# Multi-stage: the builder compiles frontend assets (needs Node AND Bun —
# frontend/scripts call both) and the single-file server binary; the runtime
# stage carries only what src/index.ts reads at runtime via PROJECT_ROOT
# (ARBESK_ROOT): frontend/dist, blockchain/artifacts, src/api/*.html, plus a
# writable .data/ (token-indexer state — mount a PVC there).
# Env is provided by a mounted .env file (k8s Secret → /app/.env); both env
# files are optional at runtime (src/index.ts try/catches loadEnvFile).
#
# Build for the Pi cluster:  docker buildx build --platform linux/arm64 \
#   -f docker/app.Dockerfile -t ahmadsayed/arbesk:<tag> --push .

FROM node:22-bookworm AS builder
RUN npm install -g bun@1
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile \
  && cd frontend && bun install --frozen-lockfile
RUN bun run build:packages \
  && cd frontend && bun run build
RUN bun run build:server

# The compiled server binary embeds the Bun runtime — no toolchain needed.
FROM debian:bookworm-slim
WORKDIR /app
COPY --from=builder /app/dist/arbesk-server ./arbesk-server
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY --from=builder /app/blockchain/artifacts ./blockchain/artifacts
COPY --from=builder /app/src/api/cli-auth.html ./src/api/cli-auth.html
COPY --from=builder /app/src/api/swagger-ui.html ./src/api/swagger-ui.html
RUN mkdir -p /app/.data
ENV ARBESK_ROOT=/app \
    PORT=9090 \
    NODE_ENV=production
EXPOSE 9090
CMD ["./arbesk-server"]
