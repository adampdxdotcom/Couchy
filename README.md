# Couchy

A local-first, self-hosted AI image gallery, character organization system, and prompt orchestration studio. Couchy connects directly to your [ComfyUI](https://github.com/comfyanonymous/ComfyUI) instance and an optional OpenAI-compatible Local LLM to generate, organize, tag, and explore images with full metadata provenance.

Repository: **[https://github.com/adampdxdotcom/Couchy](https://github.com/adampdxdotcom/Couchy)**

---

## Overview

Couchy bridges raw ComfyUI output folders and an organized creative studio—letting you curate historical renders, manage multi-LoRA character rosters, inspect workflow dependencies, track Civitai post & LoRA engagement, and run single-shot or multi-shot generations across desktop and mobile.

> **Supported Models (Krea 2 & 4x ESRGAN Only)**: Couchy **only** uses **Krea 2** (`Krea2 Turbo`) for image generation and **`4x` ESRGAN** for upscaling. There is **no support** for any other models and **no planned support** for other models. Couchy's built-in workflow is based on the standard ComfyUI Krea 2 template—if you have that template running with its suggested models (plus `4x` ESRGAN), Couchy will work out of the box.

- **Read-Only & Non-Destructive**: Primary ComfyUI output and model folders are mounted read-only (`:ro`). Original files are never renamed, relocated, or modified.
- **Content-Addressed Tracking**: Images are tracked by file hash, so ratings, favorites, tags, collections, notes, **Series Stacks**, and character links stay intact even if files move.
- **Embedded Metadata & Local AI**: Extracts embedded PNG workflows and prompts automatically, with built-in local ONNX visual tagging + Face Scan and optional OpenAI-compatible Local LLM support.
- **Built-In User Manual & Ask the Docs**: Every guide below is rendered live inside **System &rarr; Help** and searchable via your Local LLM.

---

## User Manual

Browse by topic on GitHub, or open **System &rarr; Help** inside Couchy to read the full stitched manual:

| Chapter | Covers |
|---|---|
| [Workspace Overview & Navigation](./docs/getting-started.md) | Core design principles, 6 workspaces, Status Pill & Message Center |
| [Quick Gen Box & Agent](./docs/quick-gen-and-agent.md) | `@Mention` pills, Face Scan, 1MP interrogation, Civitai URL import, Agent `x1` & `x2–x8` sets |
| [Gallery, Inspector & Series Stacks](./docs/gallery-and-inspector.md) | Filters, bulk curation, Iterative Stacks vs. Multi-Shot Sets, chronological arrow nav, Loupe & Split Compare |
| [Characters & Generation Studio](./docs/characters-and-studio.md) | Character roster, portrait framing, portrait analysis, Assisted Identification & batch studio |
| [LoRAs, Models, Presets & Downloader](./docs/loras-models-and-downloader.md) | LoRA & Base Model explorers, LoRA Presets, metadata enrichment, Civitai/HF downloader & Early Access |
| [Civitai Integration](./docs/civitai-integration.md) | `Civitai Activity Notifications` switch, draft sharing, pulled post & LoRA stats/comments, auto-match & manual linking |
| [Workflows & System Administration](./docs/workflows-and-system.md) | Structured Krea 2 Node Editor, validation tests, System toggles & all 8 System tabs |
| [Keyboard Shortcuts & Hotkeys](./docs/keyboard-shortcuts.md) | Inspector, Gallery, and Quick Gen Box hotkeys |
| [Configuration & Technical Reference](./docs/technical-reference.md) | Full `docker-compose.yml`, `extra_model_paths.yaml`, Agent prompt contracts, architecture & backups |

---

## Quick Start (Docker)

### Prerequisites

- Docker and Docker Compose ([Docker Engine](https://docs.docker.com/engine/install/))
- A running [ComfyUI](https://github.com/comfyanonymous/ComfyUI) instance (`comfy-core >= 0.43.0`) configured for **Krea 2**:
  - **Custom node**: **`rgthree-comfy`** *(for `Power Lora Loader (rgthree)` — installable via ComfyUI Manager)*
  - **Core nodes**: `ResolutionSelector`, `ComfySwitchNode`, and `TextGenerate` *(included in `comfy-core >= 0.43.0`)*
  - **Models**: A Krea 2 UNET/diffusion model, **`qwen3vl_4b_fp8_scaled.safetensors`** (CLIP), **`qwen_image_vae.safetensors`** (VAE), and **`4x-ESRGAN.pth`** (upscaler)
- *(Optional)* An NVIDIA GPU with NVIDIA Container Toolkit for GPU-accelerated ONNX visual tagging
- *(Optional)* Any OpenAI-compatible Local LLM server (**Ollama**, **llama.cpp**, **KoboldCpp**, **vLLM**, **LM Studio**, **TabbyAPI**, or custom `/v1` proxies)

### 1. Clone or Update

```bash
git clone https://github.com/adampdxdotcom/Couchy.git
cd Couchy
```

*To update an existing installation:* `git pull origin main`

### 2. Configure `.env` & `docker-compose.yml`

```bash
cp .env.example .env
cp docker-compose.yml.example docker-compose.yml
```

Edit `.env` to match your ComfyUI/LLM URLs and optional API keys, and update the left-hand host paths in `docker-compose.yml` for your ComfyUI `output` and `models` directories. *(See [Configuration & Technical Reference](./docs/technical-reference.md) for the complete `docker-compose.yml` and ComfyUI `extra_model_paths.yaml` snippets.)*

> **Security & Network Exposure**: Couchy is designed for local or trusted-network use and does not include built-in user login. Keep port `9980` on `localhost`, a trusted LAN, Tailscale/VPN, or behind an authenticating reverse proxy.

### 3. Build & Start

```bash
docker compose up -d --build
```

Open `http://localhost:9980` in your browser (or inspect logs with `docker compose logs -f comfyui-gallery`).

---

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
| `CIVITAI_API_KEY` | *(Optional)* | Civitai API token for search, metadata, downloads, private draft sharing, and activity sync |
| `HF_API_TOKEN` | *(Optional)* | Hugging Face token for gated downloads |

---

## License

MIT License. See [LICENSE](LICENSE) for details.
