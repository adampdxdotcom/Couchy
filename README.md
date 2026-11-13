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

### 1. Generation Studio & Floating Quick Gen Box
- **Generation Studio**: A full-featured workspace to generate single images or multi-image sets. Configure aspect ratio presets (`1:1`, `9:16`, `16:9`, `3:4`, `4:3`, `2:3`, `3:2`), output counts, checkpoint models, and stacked LoRAs with custom weights.
- **Floating Quick Gen Box**: An always-accessible bottom generation dock available across the Gallery, Characters, LoRAs & Models, and Workflows tabs (detailed below).

---

## Floating Quick Gen Box

The **Quick Gen Box** is a floating bottom dock designed for fast, frictionless image generation from anywhere in Couchy without leaving your current view.

### Core Capabilities & Controls

- **Collapsible Bottom Dock**:
  - Stays anchored at the bottom of the screen as you browse your gallery or characters.
  - Click the **Quick Gen** tab handle to minimize the dock out of the way (displaying a preview snippet if a draft prompt is present) or expand it on demand.
  - Automatically expands the prompt input box when focused or populated, and submits on `Enter` (`Shift+Enter` for new lines).

- **`@Character` Mention Picker & Auto-LoRA Attachment**:
  - Type `@` anywhere in the prompt (or click the **`+`** button) to open a two-column searchable character & image picker.
  - Filter characters by name, alias, LoRA filename, or trigger word using keyboard navigation (`ArrowUp`, `ArrowDown`, `Enter`/`Tab`, `Escape`) or mouse hover to preview character portraits and recent confirmed images.
  - Selecting a character attaches a removable **Character Pill Badge** above the prompt and automatically injects that character's configured LoRAs, model/CLIP weights, trigger words, and preferred default workflow on submission.

- **Hybrid Image-to-Prompt Interrogation (Drag, Paste, or Upload)**:
  - **Drop, Paste, or Browse**: Drag and drop an image file onto the Quick Gen Box, paste an image from your clipboard (`Ctrl+V` / `Cmd+V`), or click the **Image Upload (`ImagePlus`)** button.
  - **1MP Downscaling & Auto Aspect Ratio**: The browser automatically downscales the reference image to at most ~1 Megapixel (`1,048,576` pixels) while preserving its aspect ratio, and sets the Quick Gen aspect ratio selector to the closest matching preset.
  - **Hybrid Vision / WD14 + LLM Pipeline**:
    - **Vision Model Loaded in LM Studio**: Sends the 1MP image directly to the local Vision Language Model (VLM) to synthesize a detailed prose prompt (independent of whether the `Agent` toggle is active).
    - **Text-Only Model Loaded in LM Studio**: Runs the image through the local `wd-vit-tagger-v3` ONNX visual tagger first, then feeds the extracted tags into the local text LLM to write a natural prose prompt.
    - Automatically disabled with a helpful tooltip whenever LM Studio is offline.
  - **Character-Aware Physical Trait Stripping**: If a character is already attached in the Quick Gen Box when you drop or upload a photo, Couchy automatically strips conflicting physical identity traits—such as hair color, eye color, permanent facial features (freckles, moles), skin tone, race/ethnicity, and body proportions—while keeping hairstyle structure, transient facial expressions/emotions (e.g., smiling, blushing), pose, clothing/NSFW state, lighting, and framing so the character's LoRA defines their appearance cleanly.
  - **Optional Reference Archiving**: Enable *"Save Uploaded Prompt Images"* in **System** to automatically save a copy of each 1MP downscaled reference image to `data/uploaded`.

- **Local LLM Photo Set Agent (`Agent` Toggle)**:
  - Toggle the **Agent** button to have your local LLM expand a single prompt or high-level narrative instruction into a cohesive multi-image sequence across your selected batch count:
    > *"The character should grow increasingly tired through the series"*
    > or *"Shift the scene from golden hour sunlight to midnight rain over 6 shots"*
  - Preserves your attached character's trigger words, LoRA context, and visual continuity across every generated frame.

- **Interactive Agent Conversation Mode (`Agent` &rarr; `Conversation`)**:
  - When **Agent** is enabled, click the **Conversation** button to expand the Quick Gen dock into a 12–15 line inline conversation view (no separate chat window).
  - Brainstorm lighting, framing, wardrobe, mood, and scene details back-and-forth with your local LLM (sending up to the last 10 messages of context per turn).
  - Whenever the LLM has a ready-to-generate prompt, it presents a **Proposed Prompt** card with a one-click **Submit Prompt** button—or you can keep chatting to refine it further.
  - Multi-image batch generation is automatically locked to `x1` during Conversation mode. Submitting a proposed prompt dispatches the job to ComfyUI, clears the conversation, and returns the Quick Gen box to its compact default state.
  - The guiding system prompt for Conversation mode is fully editable (with a **Reset to Default** option) under **System &rarr; Agent**.

- **Stacked Image Iterations, Conversation History & Branching**:
  - **Persistent Conversation Snapshots**: Every image generated in Conversation mode saves its conversation history snapshot and links iterations into a stacked **Image Series**.
  - **Continue or Start a Stack from Any Image**: Click the **Conversation (`MessageSquare`)** icon on any gallery card or in the Image Inspector preview to reopen that iteration's saved conversation in Quick Gen—or start a new conversation stack seeded from any standalone image's prompt.
  - **Continue from Latest vs. Branch from Middle**:
    - Continuing a conversation from the **latest** image in a series appends the new generation to that same stack.
    - Continuing a conversation from an image in the **middle** of a stack (e.g., Step `#3` of `5`) splits off a **new stack** upon submission, copying the ancestor lineage (`#1..#3`) and their conversation edit history into the new series while leaving the original stack untouched.
  - **Automatic Upscale Stacking**: Upscaling any image from the Inspector (`POST /api/images/:id/upscale`) automatically stacks the upscaled output onto the source image's series regardless of whether it originated in Conversation mode.
  - **Exclusive Poster / Hearted Image**: Within an image stack, only one iteration can be hearted/favorited at a time. That hearted image acts as the stack's **Poster Image** in both the Main Gallery and Character Gallery; if no iteration is hearted, the most recent iteration is shown.

- **Workflow, Aspect Ratio & Batch Size Selector**:
  - Click the workflow/ratio pill (e.g., `2:3 · 3MP · x1`) to open the quick settings popover:
    - **Aspect Ratio Presets**: `1:1`, `9:16`, `16:9`, `3:4`, `4:3`, `2:3`, and `3:2` (mapped directly to your workflow's resolution/aspect node).
    - **Number of Generations**: `x1`, `x2`, `x4`, `x6`, or `x8` images per batch (locked to `x1` when Conversation mode is enabled).
    - **Resolution**: From `0.5 MP` up to `10.0 MP` selectable. Up to `3.0 MP` renders natively; higher targets automatically trigger the inline `4x` ESRGAN upscale + downscale pass.
  - Automatically displays and uses the attached character's preferred workflow if configured, or falls back to your default ComfyUI workflow.

- **One-Click "Reuse Prompt" Integration**:
  - Clicking **Reuse Prompt** (`RotateCcw`) on any gallery card or full-screen image inspector automatically expands the Quick Gen Box, fills in the positive prompt, matches the original image's aspect ratio preset, and re-attaches the confirmed character and LoRAs.

---

### 2. First-Class Character Organization & Auto-Recognition
- **Character Profiles**: Create characters with custom trigger words, LoRA weights, outfits, descriptions, and avatar images.
- **Automatic Recognition**: When ComfyUI finishes rendering an image, Couchy parses the embedded LoRAs and prompt text. If a character's LoRA or trigger word is detected, the image is automatically tagged and added to that character's personal gallery.
- **Multi-Character Support**: Assign multiple characters to a single image, organize aliases, and use Assisted Character Identification to find untagged appearances.

### 3. Extensive Gallery, Clean Card Info & Series Inspector
- **Virtualized Grid & Streamlined Card Footer**: Fast, smooth scrolling across libraries with thousands of images. Gallery cards display a clean 3-row info footer:
  1. **Character Name** (clickable to jump directly to that character's gallery)
  2. **LoRA Pills** (showing clean nicknames/names for every active LoRA)
  3. **Image Details** (`width×height · aspect ratio · checkpoint`)
- **Series Stack Badges**: Cards belonging to a multi-image iteration or upscale stack display a `Layers` badge with the stack count while collapsing the stack to a single gallery card (the hearted poster image, or the newest iteration if none is hearted).
- **Sticky Search & Collapsible Filters**: On mobile and desktop, search prompts and metadata with a top-locked bar. Tap the filter toggle to slide open controls for:
  - Star ratings ($1–5$ stars) and Favorites filter
  - Specific Character, Checkpoint, and LoRA filters
  - Aspect ratio and resolution dimensions
  - Sort orders: Newest, Oldest, Highest Rated, Recently Favorited, File Size, and Checkpoint
- **Full-Screen Inspector & Series Thumbnail Strip**: Inspect embedded ComfyUI workflows, node parameters, prompt text chunks, and sampler steps, or run standalone `4x` ESRGAN upscales. When inspecting a stacked series, a horizontal **Series Stack thumbnail strip** docks at the bottom of the metadata column so you can switch between iterations in place, heart a poster image, or branch a conversation from any step.

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
- Responsive top navigation bar featuring a slide-down mobile hamburger menu for quick access to all workspaces (**Gallery**, **Characters**, **Generation Studio**, **LoRAs & Models**, **Workflows**, **System**).
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

1. **Database Snapshots**: In the web UI, go to **System &rarr; Database** to create a verified SQLite database snapshot (`gallery-backup-*.db`) using `PRAGMA integrity_check`.
2. **Annotation Export**: Export all user-created annotations (ratings, character tags, favorites, notes) to a portable JSON file.
3. **Automatic Migrations**: When updating Couchy via `git pull && docker compose up -d --build`, database schema migrations run automatically on startup without risking existing records.

---

## License

MIT License. See [LICENSE](LICENSE) for details.
