# Couchy

A local-first, self-hosted AI image gallery, character organization system, and prompt orchestration studio. Couchy connects directly to your [ComfyUI](https://github.com/comfyanonymous/ComfyUI) instance and an optional local LLM (such as [LM Studio](https://lmstudio.ai/) or Ollama) to generate, organize, tag, and explore images with complete metadata provenance.

Repository: **[https://github.com/adampdxdotcom/Couchy](https://github.com/adampdxdotcom/Couchy)**

---

## Overview

Couchy bridges the gap between raw ComfyUI generation folders and an organized, searchable creative studio. Whether you want to quickly generate prompt batches through a workflow (such as Krea2 Turbo), create focused character portraits with custom LoRAs, or orchestrate progressive photo series using a local LLM agent, Couchy gives you a responsive desktop and mobile web interface without touching your original files.

- **Non-Destructive & Read-Only**: Original images in your ComfyUI output folder are never renamed, relocated, or modified.
- **Content-Addressed Tracking**: Every image is indexed by its SHA-256 hash. If you move or reorganize files in your ComfyUI folders, all favorites, star ratings, tags, collections, notes, and character associations are preserved.
- **Embedded Metadata Extraction**: Reads PNG text chunks (`tEXt`, `zTXt`, `iTXt`) to extract visual node graphs, API prompt payloads, sampler settings, seeds, checkpoints, and LoRA parameters.

---

## Key Features

### 1. Generation Studio & Quick Gen Dock
- **Generation Studio**: A full-featured workspace to generate single images or multi-image sets. Configure aspect ratio presets (`1:1`, `9:16`, `16:9`, `3:4`, `4:3`, `2:3`, `3:2`), output counts, checkpoint models, and stacked LoRAs with custom weights.
- **Quick Gen Bottom Dock**: A fast-action prompt bar accessible from any tab. Type `@character` to search and mention characters, pick aspect ratios, adjust batch sizes, and submit jobs directly to ComfyUI. On mobile devices, the dock features an edge-to-edge layout with a minimize/expand toggle tab.
- **Reuse Prompt (`RotateCcw`)**: With one click on any gallery card or full-screen preview, pre-fill the Quick Gen dock with the image's prompt, automatically match the image dimensions to the closest aspect ratio preset, and re-attach associated characters.
- **Local LLM Photo Set Agent**: Connect an OpenAI-compatible local model (e.g. LM Studio or Ollama). Provide high-level narrative instructions across a batch—such as:
  > *"The character should grow increasingly tired through the series"*
  > or *"Shift the scene from golden hour sunlight to midnight rain over 6 shots"*
  
  The agent intelligently adjusts each sequential prompt while preserving your character's LoRA trigger words, scene context, and styling consistency.

### 2. First-Class Character Organization & Auto-Recognition
- **Character Profiles**: Create characters with custom trigger words, LoRA weights, outfits, descriptions, and avatar images.
- **Automatic Recognition**: When ComfyUI finishes rendering an image, Couchy parses the embedded LoRAs and prompt text. If a character's LoRA or trigger word is detected, the image is automatically tagged and added to that character's personal gallery.
- **Multi-Character Support**: Assign multiple characters to a single image, organize aliases, and use Assisted Character Identification to find untagged appearances.

### 3. Extensive Gallery & Sticky Filters
- **Virtualized Grid**: Fast, smooth scrolling across libraries with thousands of images.
- **Sticky Search & Collapsible Filters**: On mobile and desktop, search prompts and filenames with a top-locked bar. Tap the filter toggle to slide open controls for:
  - Star ratings ($1–5$ stars) and Favorites filter
  - Specific Character, Checkpoint, and LoRA filters
  - Aspect ratio and resolution dimensions
  - Sort orders: Newest, Oldest, Highest Rated, Seed, and Resolution
- **Full-Screen Inspector**: Inspect embedded ComfyUI workflows, node parameters, prompt text chunks, and sampler steps. On mobile, details dock cleanly to the bottom edge so images stay completely visible.

### 4. Workflows & Dynamic Node Mapper
- **Import Any ComfyUI Workflow**: Import API or visual workflow JSON files directly.
- **Interactive Node Mapper**: Easily map workflow nodes for positive prompt, negative prompt, checkpoint loader, LoRA loader, latent resolution, and seed.
- **Default Presets**: Set any workflow as the primary default across the Generation Studio and Quick Gen dock (e.g. Krea2 Turbo).

### 5. LoRA & Model Management
- **Directory Scanning**: Live indexing of your ComfyUI models directory.
- **Metadata Enrichment**: Integration with Civitai and Hugging Face to fetch model preview cards, recommended base models, and trigger words.

### 6. Local ONNX Visual Keyword Tagger
- Optional built-in `wd-vit-tagger-v3` ONNX model (stored locally in `/app/data/local_models`).
- Runs locally on CPU or NVIDIA GPU to auto-detect visual tags, clothing, poses, and stylistic elements without sending data outside your network.

### 7. Mobile-Optimized Interface
- Responsive top navigation bar featuring a slide-down mobile hamburger menu for quick access to all workspaces (**Gallery**, **Characters**, **Generation Studio**, **LoRAs & Models**, **Workflows**, **System & Backup**).
- Real-time ComfyUI progress bar and job queue status in the header.

---

## Installation & Deployment

### Prerequisites
- Docker and Docker Compose installed ([Docker Engine](https://docs.docker.com/engine/install/))
- A running [ComfyUI](https://github.com/comfyanonymous/ComfyUI) instance (bare metal or containerized)
- *(Optional)* An NVIDIA GPU with NVIDIA Container Toolkit installed for GPU-accelerated local ONNX tagging
- *(Optional)* [LM Studio](https://lmstudio.ai/) or Ollama running locally for the Photo Set Agent

---

### Step 1: Clone the Repository

```bash
git clone https://github.com/adampdxdotcom/Couchy.git
cd Couchy
```

*To update an existing installation:*
```bash
git pull origin main
```

---

### Step 2: Configure Environment Variables

Copy the example environment configuration:

```bash
cp example.env .env
```

Edit `.env` to match your local setup:

```ini
PORT=8080
COMFYUI_URL=http://host.docker.internal:8188
LM_STUDIO_URL=http://host.docker.internal:1234/v1
COMFYUI_OUTPUT_DIR=/data/output
COMFYUI_MODELS_DIR=/data/models
DATABASE_PATH=/app/data/gallery.db
THUMBNAIL_PATH=/data/thumbnails
DOWNLOADS_DIR=/downloads
CIVITAI_API_KEY=
HF_API_TOKEN=
```

---

### Step 3: Configure `docker-compose.yml`

Open `docker-compose.yml` and verify your host volume mount paths point to your actual ComfyUI output and models directories:

```yaml
services:
  comfyui-gallery:
    build: .
    container_name: comfyui-gallery
    restart: unless-stopped
    ports:
      - "9980:8080"
    env_file:
      - .env
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      # Adjust host paths (left side) to your local system paths:
      - /opt/docker/Couchy/data/thumbnails:/data/thumbnails
      - /opt/baremetal/ComfyUI/output:/data/output:ro
      - /opt/baremetal/ComfyUI/models:/data/models:ro
      - ./gallery-data:/app/data
      - ./model-downloads:/downloads

    # Optional: Enable NVIDIA GPU for the built-in ONNX visual tagger
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]

    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:8080/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
```

> **Note on Port**: The compose file maps host port `9980` to container port `8080`. You can change `"9980:8080"` to `"8080:8080"` or any available port on your host.

---

### Step 4: Build and Start Couchy

```bash
docker compose up -d --build
```

Access Couchy in your web browser:
```
http://localhost:9980
```
*(or replace `9980` with the port configured in your `docker-compose.yml`)*

To view live container logs:
```bash
docker compose logs -f comfyui-gallery
```

---

## Environment Variables Reference

| Variable | Default in Container | Description |
|---|---|---|
| `PORT` | `8080` | Internal HTTP server port |
| `COMFYUI_URL` | `http://comfyui:8188` | ComfyUI HTTP endpoint (`http://host.docker.internal:8188` when ComfyUI is on the host) |
| `LM_STUDIO_URL` | `http://host.docker.internal:1234/v1` | OpenAI-compatible endpoint for the LLM Photo Set Agent |
| `COMFYUI_OUTPUT_DIR`| `/data/output` | Read-only mount of ComfyUI output directory |
| `COMFYUI_MODELS_DIR`| `/data/models` | Read-only mount of ComfyUI models directory |
| `DATABASE_PATH` | `/app/data/gallery.db` | Persistent SQLite database location |
| `THUMBNAIL_PATH` | `/data/thumbnails` | Directory for cached WebP thumbnails |
| `BACKUP_PATH` | `/app/data/backups` | Persistent directory for SQLite database backups |
| `DOWNLOADS_DIR` | `/downloads` | Target directory for confirmed model downloads |
| `CIVITAI_API_KEY` | *(Optional)* | API token for Civitai model search & metadata |
| `HF_API_TOKEN` | *(Optional)* | Hugging Face token for model downloads |

---

## Backup, Restore & Maintenance

1. **Database Snapshots**: In the web UI, go to **System & Backup** to create a verified SQLite database snapshot (`gallery-backup-*.db`) using `PRAGMA integrity_check`.
2. **Annotation Export**: Export all user-created annotations (ratings, character tags, favorites, notes) to a portable JSON file.
3. **Automatic Migrations**: When updating Couchy via `git pull && docker compose up -d --build`, database schema migrations run automatically on startup without risking existing records.

---

## License

MIT License. See [LICENSE](LICENSE) for details.
