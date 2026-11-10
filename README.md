# Couchy

A local-first, self-hosted AI image library, metadata and workflow explorer, first-class character organization system, model dependency auditor, and ComfyUI workflow reproduction platform.

## 1. Architecture & Unified Stack

Couchy runs on a **single unified Node.js/TypeScript + Express + SQLite (`better-sqlite3`)** backend paired with a **React 19 + TypeScript + Tailwind CSS** frontend for both interactive development and self-hosted Docker production:

- **Read-Only Immutability**: Original images in `COMFYUI_OUTPUT_DIR` are never modified, renamed, or moved.
- **Content-Addressed Identity**: Every indexed image is identified by its SHA-256 `content_hash`. Moving or renaming files inside the mounted output directory preserves all ratings, favorites, tags, collections, notes, and character associations.
- **Multi-Source Metadata & Provenance**: Extracts PNG binary chunks (`tEXt`, `zTXt`, `iTXt`) for both ComfyUI API graphs (`prompt`), visual workflow graphs (`workflow`), and fallback text parameters (`parameters`), tracking explicit field provenance (`embedded_api`, `visual_workflow`, `a1111_parameters`).
- **First-Class Character Organization**: Characters exist as independent organizational entities supporting aliases, multiple outfit/appearance LoRAs, semantic LoRA classification (`character`, `style`, `clothing`, `concept`, `pose`, `object`, `other`), multi-character images, non-destructive character merging, and deterministic Assisted Character Identification suggestions.

## 2. Docker Compose Deployment

Copy `example.env` to `.env` and adjust any paths or URLs as needed:

```bash
cp example.env .env
docker compose up -d --build
```

```yaml
services:
  comfyui-gallery:
    build: .
    container_name: comfyui-gallery
    restart: unless-stopped
    ports:
      - "8080:8080"
    env_file:
      - .env
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - /path/to/comfyui/output:/data/output:ro
      - /path/to/comfyui/models:/data/models:ro
      - ./gallery-data:/app/data
      - ./model-downloads:/downloads
```

## 3. Environment Variables (`example.env` -> `.env`)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` (Docker) / `3000` (dev) | HTTP server listen port |
| `COMFYUI_URL` | `http://comfyui:8188` | ComfyUI HTTP/WebSocket endpoint (LAN or Docker host) |
| `LM_STUDIO_URL` | `http://host.docker.internal:1234/v1` | LM Studio OpenAI-compatible endpoint for Photo Set Agent |
| `COMFYUI_OUTPUT_DIR` | `/data/output` | Read-only mounted ComfyUI output directory |
| `COMFYUI_MODELS_DIR` | `/data/models` | Read-only mounted ComfyUI models directory |
| `DATABASE_PATH` | `/app/data/gallery.db` | Persistent SQLite database path |
| `THUMBNAIL_PATH` | `/app/data/thumbnails` | Persistent WebP thumbnail cache directory |
| `BACKUP_PATH` | `/app/data/backups` | Persistent SQLite binary & JSON backup directory |
| `DOWNLOADS_DIR` | `/downloads` | Writable directory for confirmed model downloads |
| `CIVITAI_API_KEY` | `""` | Optional server-side Civitai API key |
| `HF_API_TOKEN` | `""` | Optional server-side Hugging Face token |

## 4. Backup, Restore & Upgrade Procedures

1. **Manual & Scheduled Backups**: Navigate to **System & Backup** to create a live SQLite binary snapshot (`gallery-backup-*.db`) verified with `PRAGMA integrity_check`, or export all user annotations (`comfyui-gallery-annotations-*.json`) independently of machine-derived metadata.
2. **Upgrading**: Pull the latest image or repository changes and run `docker compose up -d --build`. Versioned SQLite migrations in `src/server/db.ts` run automatically on startup while preserving existing data.
