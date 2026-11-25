# Configuration & Technical Reference

## Docker Compose & Volume Mounts

Copy `docker-compose.yml.example` to `docker-compose.yml` and point the left-hand host volume paths to your local ComfyUI output and models folders:

```yaml
services:
  comfyui-gallery:
    build: .
    container_name: comfyui-gallery
    restart: unless-stopped
    user: "${UID:-1000}:${GID:-1000}"
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    ports:
      - "9980:8080"
    env_file:
      - .env
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      # Adjust host paths (left side) to your local system paths:
      - /path/to/comfyui/output:/data/output:ro
      - /path/to/comfyui/models:/data/models:ro
      - /path/to/data/thumbnails:/data/thumbnails
      - ./gallery-data:/app/data
      - ./model-downloads:/downloads

    # Optional: Uncomment for NVIDIA GPU acceleration on the built-in ONNX visual tagger
    # deploy:
    #   resources:
    #     reservations:
    #       devices:
    #         - driver: nvidia
    #           count: all
    #           capabilities: [gpu]

    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:8080/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
```

> **Port Mapping**: Host port `9980` maps to container port `8080`; change `"9980:8080"` as needed.
>
> **Security & Network Exposure**: Couchy is designed for local or trusted-network use and does not include built-in user login. Do not expose port `9980` directly to the public internet—keep it on `localhost`, a trusted LAN, Tailscale/VPN, or behind an authenticating reverse proxy.

## ComfyUI `extra_model_paths.yaml` (For Downloaded Models)

Downloaded models are written into `./model-downloads` (`/downloads` in the container) using standard ComfyUI subfolders. To let ComfyUI discover them alongside your main models directory, add this block to `extra_model_paths.yaml` in your ComfyUI root:

```yaml
couchy_downloads:
    # Absolute path on your host to Couchy's model-downloads directory
    base_path: /path/to/Couchy/model-downloads/

    # Standard checkpoints (.safetensors / .ckpt)
    checkpoints: checkpoints/

    # Modern DiT / UNET / GGUF base models (Flux, Wan, Qwen, Chroma, HiDream, etc.)
    diffusion_models: |
        diffusion_models/
        unet/
    unet: |
        unet/
        diffusion_models/

    # Text encoders (CLIP-L, CLIP-G, T5-XXL, UMT5, Qwen2.5-VL, GGUF CLIPs)
    clip: |
        clip/
        text_encoders/
    text_encoders: |
        text_encoders/
        clip/

    # LoRAs, VAEs, ControlNets, Upscalers, and Embeddings
    loras: loras/
    vae: vae/
    controlnet: controlnet/
    upscale_models: upscale_models/
    embeddings: embeddings/
```

- Subfolders inside `model-downloads` are created automatically on first download, or you can pre-create them to prevent startup warnings:
  ```bash
  mkdir -p ./model-downloads/{loras,checkpoints,diffusion_models,unet,text_encoders,clip,vae,controlnet,upscale_models,embeddings}
  ```
- Restart ComfyUI once after editing `extra_model_paths.yaml` (or press **`R`** in the ComfyUI web UI to refresh node lists after downloads complete).

## Environment Variables

| Variable | Default in Container | Description |
|---|---|---|
| `PORT` | `8080` | Internal HTTP server port |
| `COMFYUI_URL` | `http://comfyui:8188` | ComfyUI HTTP endpoint (`http://host.docker.internal:8188` on host) |
| `LOCAL_LLM_URL` | `http://host.docker.internal:11434/v1` | OpenAI-compatible `/v1` endpoint (`LM_STUDIO_URL` & `LLM_BASE_URL` aliases supported) |
| `LOCAL_LLM_API_KEY` | *(Optional)* | Server-side Bearer token for authenticated LLM endpoints (`LLM_API_KEY` also supported) |
| `COMFYUI_OUTPUT_DIR` | `/data/output` | Read-only mount of ComfyUI output directory |
| `COMFYUI_MODELS_DIR` | `/data/models` | Read-only mount of ComfyUI models directory |
| `DATABASE_PATH` | `/app/data/gallery.db` | Persistent SQLite database path |
| `THUMBNAIL_PATH` | `/data/thumbnails` | Cached WebP thumbnails directory |
| `BACKUP_PATH` | `/app/data/backups` | SQLite backup snapshots directory |
| `LOGS_DIR` | `/app/data/logs` | Rotating server logs (`couchy.log`, 5 MB &times; 2) |
| `DOWNLOADS_DIR` | `/downloads` | Target directory for downloaded models |
| `CIVITAI_API_KEY` | *(Optional)* | Civitai API token for search, metadata, authenticated downloads, private draft post sharing, and activity sync |
| `HF_API_TOKEN` | *(Optional)* | Hugging Face token for gated downloads |

## Customizing Agent Prompts

If you edit prompts under **System &rarr; Agent**, keep these built-in contracts in mind:

- **Primary Agent System Prompt**: Sent on every **Agent** turn (`x1` and `x2`–`x8`) and every batch expansion. Expects `<proposed_prompt>` in `x1` mode, `<proposed_concept>` in `x2`–`x8` mode, and optional `<selected_loras>` / `<selected_preset>` tags for auto-attaching non-character `@mention` LoRAs or a saved Preset.
- **Batch Expansion Instructions**: Appended after the Primary prompt when expanding **Multi-Shot Set** concepts or Generation Studio **Photo Set Themes** into `{count}` `<shot_1>...</shot_{count}>` tags (`4096` max tokens, `90s` timeout).
- **Automatic Runtime Context**: Automatically injects character bio/physical guides, attached LoRA descriptions, available `@mention` LoRAs and Presets, and long-thread anchor recall beyond the 10-message chat window.

## Technical Architecture

Couchy runs as a single Node.js service (React + TypeScript + Tailwind CSS frontend; Express + TypeScript backend with **SQLite WAL** via `better-sqlite3`):

- **ComfyUI Compilation & Poller**: Connects to ComfyUI REST + `/ws` to track progress and index completed PNGs. Compiles Krea 2 API graphs (`#49` resolution selector, `#50` Power Lora Loader, `#30_27` trigger concatenation, `#30_3` KSampler seed & Quick Gen steps override, and inline `4x` ESRGAN `#51`–`#54` upscaling).
- **Local ONNX Pipelines (`onnxruntime-node`)**:
  - **Visual Keyword Tagger**: `wd-vit-tagger-v3` (`data/local_models/wd-vit-tagger-v3`, `0.22` general / `0.18` compound thresholds for text fallback; also serves as an uncensored nudity/exposure audit during Vision interrogation).
  - **Face Scan**: InsightFace **SCRFD (`det_10g.onnx`)** 5-point landmark alignment + **ArcFace (`w600k_r50.onnx`)** 512-D embeddings (`data/local_models/insightface-buffalo-l`, cached in `character_face_embeddings` with `0.38` default cosine threshold).
- **Local LLM Proxy**: Server-side `/v1/models` and `/v1/chat/completions` client (plus LM Studio `/api/v0/models` vision detection) with `90s` interrogation/expansion timeouts and ranked cross-chapter User Manual retrieval for **Ask the Docs**.
- **Civitai Integration (Downloader, URL Import, Draft Sharing & Activity Sync)**: Queries `civitai.com` and `civitai.red` REST APIs for model search, hash/URL lookup, link healing, creator upload discovery, and Krea 2 image/post prompt+LoRA import; posts deterministic private drafts (`publish: false`) via Civitai MCP with in-memory multi-LoRA metadata injection; and runs a **15-minute background sync** (gated by `civitai_activity_notifications_enabled`) that updates shared post reactions/comments in `image_civitai_drafts`, auto-matches creator LoRAs by hash, and caches model/version stats and MCP `model` comments on `models`.
- **Core SQLite Domain Groups**:
  - *Images & Metadata*: `images`, `image_metadata`, `image_loras`, `image_models`, `image_visual_tags`, `image_workflows`, `image_civitai_drafts`
  - *Series & Generations*: `image_series`, `image_series_items`, `generation_batches`, `generation_items`, `reproduction_jobs`
  - *Curation & Characters*: `ratings`, `tags`, `image_tags`, `collections`, `collection_images`, `saved_searches`, `characters`, `character_aliases`, `character_loras`, `character_workflows`, `character_face_embeddings`, `image_characters`
  - *Models & System*: `models`, `lora_presets`, `lora_preset_items`, `download_jobs`, `downloaded_model_copies`, `pending_lora_character_tasks`, `workflows`, `workflow_mappings`, `prompt_templates`, `lm_studio_settings`, `lm_studio_prompt_templates`, `app_settings`, `scan_jobs`, `schema_migrations`

## Backup, Restore & Maintenance

1. **Database Snapshots**: Create integrity-checked (`PRAGMA integrity_check`) SQLite snapshots under **System &rarr; Database**.
2. **Annotation Export**: Export/import portable JSON backups of all ratings, favorites, rejections, notes, tags, collections, characters, and portrait crops.
3. **Automatic Migrations**: Updating via `git pull && docker compose up -d --build` applies schema migrations automatically on startup without touching existing records.
