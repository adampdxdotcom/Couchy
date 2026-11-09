# Unified Node.js + SQLite Dockerfile for ComfyUI Gallery
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install native build dependencies for better-sqlite3 and sharp if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV COMFYUI_URL="http://comfyui:8188"
ENV COMFYUI_OUTPUT_DIR="/data/output"
ENV COMFYUI_MODELS_DIR="/data/models"
ENV DATABASE_PATH="/app/data/gallery.db"
ENV THUMBNAIL_PATH="/app/data/thumbnails"
ENV BACKUP_PATH="/app/data/backups"
ENV DOWNLOADS_DIR="/downloads"

# Create volume mount points
RUN mkdir -p /data/output /data/models /app/data/thumbnails /app/data/backups /downloads

COPY --from=builder /app /app

EXPOSE 8080

CMD ["npx", "tsx", "server.ts"]
