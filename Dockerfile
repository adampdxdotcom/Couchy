# Unified Node.js + SQLite Dockerfile for Couchy
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Native build toolchain in builder only (discarded from runtime stage)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json .npmrc ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build && \
    npm prune --omit=dev --legacy-peer-deps && \
    for napi_dir in node_modules/onnxruntime-node/bin/napi-v*; do \
      [ -d "$napi_dir" ] || continue; \
      rm -rf "$napi_dir/darwin" "$napi_dir/win32"; \
      case "$(uname -m)" in \
        x86_64) rm -rf "$napi_dir/linux/arm64" ;; \
        aarch64|arm64) rm -rf "$napi_dir/linux/x64" ;; \
      esac; \
    done && \
    if [ -d node_modules/better-sqlite3/prebuilds ]; then \
      rm -rf node_modules/better-sqlite3/prebuilds/darwin-* \
             node_modules/better-sqlite3/prebuilds/win32-* \
             node_modules/better-sqlite3/prebuilds/linuxmusl-*; \
      case "$(uname -m)" in \
        x86_64) rm -rf node_modules/better-sqlite3/prebuilds/linux-arm64.node ;; \
        aarch64|arm64) rm -rf node_modules/better-sqlite3/prebuilds/linux-x64.node ;; \
      esac; \
    fi && \
    rm -rf node_modules/better-sqlite3/deps \
           node_modules/better-sqlite3/src \
           node_modules/better-sqlite3/build/Release/obj.target

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV HOME="/tmp"
ENV PORT=8080
ENV COMFYUI_URL="http://comfyui:8188"
ENV COMFYUI_OUTPUT_DIR="/data/output"
ENV COMFYUI_MODELS_DIR="/data/models"
ENV DATABASE_PATH="/app/data/gallery.db"
ENV THUMBNAIL_PATH="/data/thumbnails"
ENV BACKUP_PATH="/app/data/backups"
ENV LOCAL_MODELS_DIR="/app/data/local_models"
ENV UPLOADED_IMAGES_DIR="/app/data/uploaded"
ENV DOWNLOADS_DIR="/downloads"

# Create volume mount points and grant ownership to the unprivileged node user (1000:1000)
RUN mkdir -p /data/output /data/models /data/thumbnails /data/uploaded \
    /app/data/backups /app/data/local_models /app/data/uploaded /downloads \
    && chown -R node:node /data /app /downloads

# Copy only runtime dependencies, built SPA, bundled server, workflow JSONs, and README (for Help docs)
COPY --chown=node:node --from=builder /app/node_modules /app/node_modules
COPY --chown=node:node --from=builder /app/dist /app/dist
COPY --chown=node:node --from=builder /app/dist-server /app/dist-server
COPY --chown=node:node --from=builder /app/src/server/workflows/*.json /app/dist-server/workflows/
COPY --chown=node:node --from=builder /app/package.json /app/package.json
COPY --chown=node:node --from=builder /app/README.md /app/README.md

USER node

EXPOSE 8080

CMD ["node", "dist-server/server.mjs"]
