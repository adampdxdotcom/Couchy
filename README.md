# Couchy

A local-first, self-hosted AI image gallery, character organization system, and prompt orchestration studio. Couchy connects directly to your [ComfyUI](https://github.com/comfyanonymous/ComfyUI) instance and an optional OpenAI-compatible Local LLM (such as Ollama, `llama.cpp`, KoboldCpp, vLLM, or LM Studio) to generate, organize, tag, and explore images with complete metadata provenance.

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

- **`@Character` & `@LoRA` Mention Picker & Auto-Attachment**:
  - Type `@` anywhere in the prompt (or click the **`+`** button) to open a two-column searchable `@Character` & `@LoRA` picker (`All`, `Characters`, and `LoRAs` tabs).
  - Direct **Character** and **LoRA** matches rank at the top of the list above matching reference image prompts, with keyboard navigation (`ArrowUp`, `ArrowDown`, `Enter`/`Tab`, `Escape`) or mouse hover to preview portraits, confirmed reference images, and prompt snippets.
  - Selecting a character or mention-enabled LoRA attaches a removable **Pill Badge** above the prompt and automatically injects configured LoRAs, model/CLIP weights, trigger words, and preferred default workflow on submission.

- **Hybrid Image-to-Prompt Interrogation (Drag, Paste, or Upload)**:
  - **Drop, Paste, or Browse**: Drag and drop an image file onto the Quick Gen Box, paste an image from your clipboard (`Ctrl+V` / `Cmd+V`), or click the **Image Upload (`ImagePlus`)** button.
  - **1MP Downscaling & Auto Aspect Ratio**: The browser automatically downscales the reference image to at most ~1 Megapixel (`1,048,576` pixels) while preserving its aspect ratio, and sets the Quick Gen aspect ratio selector to the closest matching preset.
  - **Hybrid Vision / WD14 + Local LLM Pipeline**:
    - **Vision Model Loaded in Local LLM**: Sends the 1MP image directly to the local Vision Language Model (VLM) via `/v1/chat/completions` to synthesize a detailed prose prompt (independent of whether the `Agent` toggle is active).
    - **Text-Only Model Loaded in Local LLM**: Runs the image through the local `wd-vit-tagger-v3` ONNX visual tagger first, then feeds the extracted tags into the local text LLM to write a natural prose prompt.
    - Automatically disabled with a helpful tooltip whenever the Local LLM server is offline.
  - **Character-Aware Physical Trait Stripping**: If a character is already attached in the Quick Gen Box when you drop or upload a photo, Couchy automatically strips conflicting physical identity traits—such as hair color, eye color, permanent facial features (freckles, moles), skin tone, race/ethnicity, and body proportions—while keeping hairstyle structure, transient facial expressions/emotions (e.g., smiling, blushing), pose, clothing/NSFW state, lighting, and framing so the character's LoRA defines their appearance cleanly.
  - **Optional Reference Archiving**: Enable *"Save Uploaded Prompt Images"* in **System** to automatically save a copy of each 1MP downscaled reference image to `data/uploaded`.

- **Local LLM Agent & Conversation Mode (`Agent` Toggle)**:
  - Toggle the **Agent** button directly in the Quick Gen Box to open an inline 12–15 line interactive conversation view (no separate chat window).
  - Brainstorm lighting, framing, wardrobe, mood, and scene details back-and-forth with your local LLM (sending up to the last 10 messages of context per turn). Use **Clear** in the chat header at any time to reset the thread.
  - Whenever the LLM has a ready-to-generate prompt, it presents a **Proposed Prompt** card with a one-click **Submit** button—or you can keep chatting to refine it further.
  - **Single Shot (`x1`) vs. Multi-Shot Set (`x2`–`x8`)**:
    - At **`x1`**, clicking **Submit** dispatches the refined prompt verbatim as a single generation (starting or continuing an iterative conversation stack).
    - At **`x2`–`x8`**, clicking **Submit Set (`xN`)** expands the refined prompt into `N` cohesive, varied shots along the theme (preserving attached character trigger words and LoRA context) and groups them into a **multi-shot set stack**.
    - Generation count automatically resets back to `x1` after submission or whenever reopening Conversation from an existing image or stack.
  - The guiding system prompts for **Agent** (themed photo sets & interactive Conversation mode) are customizable under **System &rarr; Agent**.

- **Stacked Image Iterations, Multi-Shot Sets & Branching**:
  - **Iterative Stacks vs. Multi-Shot Sets**:
    - **Iterative Stacks** link progressive refinements (`x1`) and save full conversation history snapshots across steps. Click the yellow **Conversation (`MessageSquare`)** icon on a card, or use **Continue Chat** / **Branch #N** inside the Inspector, to continue or branch off the stack.
    - **Multi-Shot Sets** group parallel shots generated as a batch (`x2`–`x8`). On Main Gallery and Character Gallery previews, the yellow Conversation bubble is shown in a **disabled** state on multi-shot set cards so ambiguous whole-set edits are prevented; open the card's **Image Inspector** or **Series Mini Gallery** (`Gallery` button) and click **Iterate** / **Iterate #N** on a specific shot to start a new `x1` iterative conversation stack seeded directly from that shot's prompt without altering the original set.
  - **Continue from Latest vs. Branch from Middle**:
    - **Continuing from the latest iteration** renders a translucent live **Pending** / `%` progress overlay directly on that existing stack's card in the Main Gallery and Character Gallery (plus a simplified `#N` **Pending** / `%` preview tile inside the Inspector's **Series Stack** strip) and appends the finished image to the same stack.
    - **Branching from a middle iteration** (e.g., **Branch #3** of `5`) or iterating from a shot inside a multi-shot set spawns a separate new gallery card during generation and splits off a **new iterative series stack** upon completion while leaving the original stack untouched.
  - **Automatic Upscale Stacking**: Upscaling any image from the Inspector (`POST /api/images/:id/upscale`) renders the same live **Pending** / `%` overlay on the source card (and preview tile in the **Series Stack** strip) and automatically stacks the upscaled result with its source image.
  - **Exclusive Poster / Hearted Image**: Within an image stack, only one iteration can be hearted/favorited at a time. That hearted image acts as the stack's **Poster Image** in both the Main Gallery and Character Gallery; if no iteration is hearted, the most recent iteration is shown.

- **Workflow, Aspect Ratio & Batch Size Selector**:
  - Click the workflow/ratio pill (e.g., `2:3 · 3MP · x1`) to open the quick settings popover:
    - **Aspect Ratio Presets**: `1:1`, `9:16`, `16:9`, `3:4`, `4:3`, `2:3`, and `3:2` (mapped directly to your workflow's resolution/aspect node).
    - **Number of Generations**: `x1`, `x2`, `x4`, `x6`, or `x8` images per batch (when **Agent** is active, `x2`–`x8` expands the proposed prompt into themed shot variations).
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
- **Series Stack Badges, Multi-Shot Sets & Live Overlays**: Cards belonging to an **iterative** stack (conversation steps or upscales) or a **multi-shot set** (`x2`–`x8` batch) display a `Layers` badge with the stack count while collapsing to a single gallery card (the hearted poster image, or the newest item if none is hearted). On Main Gallery and Character Gallery cards, the yellow **Conversation (`MessageSquare`)** icon remains enabled for standalone images and iterative stacks, and is **disabled** on multi-shot set cards so ambiguous whole-set edits are prevented. Active continuations or upscales display a translucent **Pending** / `%` progress overlay directly over the series card, while middle-stack branches or shots iterated from a multi-shot set spawn their own separate gallery card.
- **Sticky Search & Collapsible Filters**: On mobile and desktop, search prompts and metadata with a top-locked bar. Tap the filter toggle to slide open controls for:
  - Star ratings ($1–5$ stars) and Favorites filter
  - Specific Character, Checkpoint, and LoRA filters
  - Aspect ratio and resolution dimensions
  - Sort orders: Newest, Oldest, Highest Rated, Recently Favorited, File Size, and Checkpoint
- **Full-Screen Inspector, Loupe Magnifier, Series Stacks & A/B Split-Screen Comparison**:
  - Click any image to open the Inspector (click the preview image itself to expand or exit full screen, or toggle the **Loupe** magnifier in the bottom bar with `2×`, `4×`, and `1:1 Native` presets and click-to-pin locking). The metadata sidebar shows **Assigned Character** (with portrait thumbnail), followed by **Workflow & Reproducibility** (with `Run Workflow` and `4x` ESRGAN `Upscale`), and—when viewing a stacked series or active job—the **Series Stack** thumbnail strip (plus a full contact-sheet **Series Mini Gallery** modal) with live `#N` **Pending** / `%` preview tiles, iteration switching, poster hearting, and **Continue Chat** / **Branch #N** (or **Iterate** / **Iterate #N** on multi-shot sets, seeding Quick Gen with that specific shot's prompt to branch a new stack) above the prompts, parameters, LoRAs, visual keywords, and notes.
  - Click **Compare** in the Inspector header (next to `X`) to enter **A/B Split-Screen Comparison**:
    - **Smart Pre-Fill & Stack Picker**: Automatically loads the previous or favorited iteration from an active series stack into Slot B, or click **Compare with...** to browse stacked gallery cards with search and Character, LoRA, Rating, and Favorites filters. Switch individual steps within each stack via the per-slot series strip inside the bottom drawer.
    - **Side-by-Side & Overlay Wipe Modes**: Switch between a clean two-pane view and an interactive **Overlay Wipe** slider with a draggable vertical divider inside a shared `object-contain` container. Toggle between **Fit (Normalized)** visual framing and **100% Native** pixel resolution inspection with zero overlays obscuring the images.
    - **Synced Dual & Split Loupe Inspector**: Toggle **Loupe** (`2×`, `4×`, `1:1 Native`) in Split Mode to project a synchronized **Dual Mirrored Lens** across both panes in Side-by-Side mode or a **Split `[A | B]` Lens** in Overlay Wipe mode. Click anywhere on the image to pin/lock the lens in place while rating, hearting, or inspecting diffs.
    - **Collapsible Bottom Diff Drawer**: Starts collapsed to preserve full canvas space; expand to inspect side-by-side diffs only (word-level positive prompt diff, negative prompt diff, differing parameters/resolution, and added/removed/weight-changed LoRAs) with per-slot **Star Rating**, **Heart**, **Reuse**, and **Reject** actions, plus **Swap** and two-stage `Esc` exit (`Picker` &rarr; `Exit Split` &rarr; `Close Inspector`).

### 4. Workflows & Dynamic Node Mapper
- **Import Any ComfyUI Workflow**: Import API or visual workflow JSON files directly.
- **Interactive Node Mapper**: Easily map workflow nodes for positive prompt, negative prompt, checkpoint loader, LoRA loader, latent resolution, and seed.
- **Default Presets**: Set any workflow as the primary default across the Generation Studio and Quick Gen dock (e.g. Krea2 Turbo).

### 5. LoRA & Model Management
- **Directory Scanning**: Live indexing of both your primary ComfyUI models directory (`/data/models`) and your downloaded models directory (`/downloads`) across all ComfyUI subfolders (`loras`, `checkpoints`, `diffusion_models`, `unet`, `text_encoders`, `clip`, `vae`, `controlnet`, `upscale_models`, `embeddings`).
- **LoRA `@Mention` Configuration**: Enable or disable Quick Gen `@mention` support strictly via each LoRA's checkbox while clicking a LoRA row opens its detail settings (custom nickname, category, trigger words, and default model/CLIP strengths). Character-classified LoRAs automatically display their linked character's portrait thumbnail.
- **Unified Smart Downloader & Metadata Enrichment**:
  - Search Civitai (`.com` and `.red`) and Hugging Face Hub from a single smart search bar—supporting keyword queries, SHA-256 / 10-character AutoV2 hashes, `owner/repo` identifiers, and direct file or page URLs.
  - **Civitai Multi-Version Selector**: Switch between any published version of a Civitai model (e.g., `v2.0 · Krea 2`, `v1.2 · Flux.1 D`) directly from a dropdown on the preview card—dynamically updating preview thumbnails, file size, SHA-256 hash, trigger words, recommended weight, and download target.
  - **"Already Installed" Detection & Inspection**: Automatically cross-references search results and every Civitai version option against your local model inventory (matching by SHA-256 / AutoV2 hash, Civitai Version ID, or filename). Installed models and versions display a clickable **`Installed`** badge and **`Inspect Installed`** button to jump straight to the LoRA Detail Inspector or Model Inventory, plus a **`Re-download / Overwrite`** option.
  - **Early Access Delayed / Scheduled Downloads**: Automatically detects Civitai Early Access models and unlock countdowns (`earlyAccessEndsAt`, `earlyAccessDeadline`, `paidAccess.endsAt`), allowing you to schedule downloads to run automatically once Early Access unlocks (with `Run Now`, `Schedule After Unlock`, and `Cancel` controls in the queue).
  - Browse multi-file Hugging Face repositories (`.safetensors`, `.gguf`, `.ckpt`, `.pt`, `.pth`, `.bin`, `.sft`) with automatic ComfyUI target folder inference, or download LoRAs in one click directly to `/downloads/loras`.
  - Automatically detects and heals `civitai.red` vs. `civitai.com` links for restricted or delisted models.

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
- *(Optional)* Any OpenAI-compatible Local LLM server (Ollama, `llama.cpp`, KoboldCpp, vLLM, TabbyAPI, or LM Studio) for Quick Gen **Agent** (Conversation & `x2`–`x8` themed set expansion), Generation Studio photo sets, and image interrogation

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
LOCAL_LLM_URL=http://host.docker.internal:11434/v1
LOCAL_LLM_API_KEY=
COMFYUI_OUTPUT_DIR=/data/output
COMFYUI_MODELS_DIR=/data/models
DATABASE_PATH=/app/data/gallery.db
THUMBNAIL_PATH=/data/thumbnails
DOWNLOADS_DIR=/downloads
CIVITAI_API_KEY=
HF_API_TOKEN=
```

> **Note on Local LLM Endpoints**: Under **System &rarr; Agent**, you can also switch or test your OpenAI-compatible endpoint at runtime using one-click presets for **Ollama (`:11434/v1`)**, **llama.cpp (`:8080/v1`)**, **KoboldCpp (`:5001/v1`)**, **vLLM (`:8000/v1`)**, or **Port 1234 (`:1234/v1`)**. If your LLM server requires authentication (e.g. `llama-server --api-key`, `vLLM --api-key`, TabbyAPI, or a remote proxy), set `LOCAL_LLM_API_KEY` in `.env` and Couchy will automatically attach `Authorization: Bearer <key>` on all `/v1/models` and `/v1/chat/completions` requests. (`LM_STUDIO_URL` remains supported as a backward-compatible alias for `LOCAL_LLM_URL`.)

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

### Step 4: Configure ComfyUI `extra_model_paths.yaml` (For Downloaded Models)

To keep your primary ComfyUI installation safe, Couchy mounts `/opt/baremetal/ComfyUI/models` as **read-only (`:ro`)** and writes all models downloaded through the Couchy UI into `./model-downloads` (mounted at `/downloads` inside the container) using standard ComfyUI subfolder names.

To let ComfyUI discover and load models from `model-downloads` alongside your main models folder, create or edit `extra_model_paths.yaml` in the root of your ComfyUI directory (e.g., `/opt/baremetal/ComfyUI/extra_model_paths.yaml`):

```yaml
couchy_downloads:
    # Absolute path on your host to Couchy's model-downloads directory
    base_path: /opt/docker/Couchy/model-downloads/

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

- **Automatic Folder Creation**: You do **not** need to manually create the subfolders inside `model-downloads` before downloading—Couchy automatically creates the target subfolder (`loras`, `text_encoders`, `diffusion_models`, etc.) whenever a download starts.
- **Optional Pre-Creation**: If you want all folders present on disk immediately so ComfyUI logs zero missing-directory warnings on startup, you can run:
  ```bash
  mkdir -p /opt/docker/Couchy/model-downloads/{loras,checkpoints,diffusion_models,unet,text_encoders,clip,vae,controlnet,upscale_models,embeddings}
  ```
- Restart ComfyUI once after creating `extra_model_paths.yaml` (or press **`R`** in the ComfyUI web UI to refresh node definitions after new downloads finish).

---

### Step 5: Build and Start Couchy

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

## Civitai & Model Downloading

Open **LoRAs & Models &rarr; Civitai & Hugging Face Downloader** to search, resolve, and stream models directly to your host `model-downloads` folder with server-side SHA-256 verification.

### 1. Civitai API Key (`CIVITAI_API_KEY`)
- Public Civitai searches work without authentication, **but many models (including NSFW/mature, early-access, or creator-gated weights) return HTTP `401` / `403` unless authenticated**.
- Create a personal token in your Civitai **Account Settings &rarr; API Keys**, add `CIVITAI_API_KEY=your_token_here` to `.env`, and recreate the container (`docker compose up -d`).
- Couchy forwards the token via Bearer authorization headers for both Civitai API metadata lookups and weight file downloads.

### 2. Supported Smart Search Inputs
The unified search bar under **Civitai & Hugging Face Downloader** automatically detects what you enter:
- **Keyword Queries**: Searches Civitai (with optional type filter: LoRA, Checkpoint, Text Encoder/CLIP, ControlNet, VAE, Upscaler, Embedding) and Hugging Face Hub.
- **Civitai URLs**: Paste any `civitai.com` or `civitai.red` model page URL (`/models/<id>`), version link (`?modelVersionId=<id>`), or direct download link (`/api/download/models/<id>`).
- **SHA-256 & AutoV2 Hashes**: Paste either a full **64-character SHA-256** hash or a **10-character AutoV2** hash to locate an exact model version—useful when resolving **Missing Model Dependencies** flagged in indexed workflows.
- **Hugging Face & Direct Links**: Paste an `owner/repo` ID, Hugging Face file URL, or direct `.safetensors` / `.gguf` / `.ckpt` link.

### 3. `civitai.com` vs. `civitai.red` Detection & Link Healing
- Models that are mature-gated or delisted on `civitai.com` are automatically retried against `civitai.red` across hash lookups, URL resolution, metadata enrichment, and file downloads.
- Preview cards and detail pages label detected restricted models with **`Civitai.red`** so original links stay working.
- Click **Heal Civitai Links** in the **LoRAs & Models** toolbar at any time to audit existing database records and repair broken `.com` / `.red` links.

### 4. Multi-Version Selector, "Already Installed" Detection & Early Access Scheduling
- **Civitai Version Selector**: When a Civitai model has multiple versions, use the version dropdown in the card header to switch between versions (showing version name, base model, `✓ Installed`, or `⏳ Early Access`). All card details, previews, trigger words, SHA-256 hashes, and download actions update immediately.
- **Already Installed Detection**: Search results and version options are automatically matched against your installed local models by SHA-256 / AutoV2 hash, Civitai Version ID, or filename. Click the emerald **`Installed`** badge or **`Inspect Installed`** button to jump directly to the model's LoRA Detail Inspector or Model Inventory entry, or click **`Re-download / Overwrite`** if you want to replace the local file.
- **Early Access Delayed Downloads**: For Civitai models currently in Early Access, Couchy displays the unlock timestamp and countdown and lets you schedule the download to start automatically once the Early Access window ends (or click **Try Now** if unlocked with Buzz). Scheduled jobs are persisted in SQLite and processed by a background scheduler with automatic retry on unlock transition.

### 5. Destination Folders, Hash Verification & Post-Download Workflow
- **Direct LoRA Downloads**: Non-installed Civitai LoRAs download in one click straight into `/downloads/loras` (`./model-downloads/loras`). Multi-file Hugging Face repos and other model types open a confirmation modal to pick the exact file and ComfyUI subfolder (`checkpoints`, `diffusion_models`, `text_encoders`, `vae`, `controlnet`, `upscale_models`, `embeddings`).
- **Safe Atomic Writes & SHA-256 Verification**: Downloads stream to a temporary `.part` file, verify the expected SHA-256 checksum on completion (if provided by Civitai or Hugging Face LFS), cache up to 4 WebP preview images locally, and automatically sync into Couchy's inventory.
- **Active Stack & History Links**: Concurrent downloads stack newest-first as full-width preview cards with live progress and clear automatically once finished. In the **Download Queue & Hash Verification History**, completed Civitai downloads display their first cached preview thumbnail—click any completed **LoRA** name to jump straight into its **LoRA Detail Inspector** (`@mention` nickname, trigger words, strengths, category), or click other model types to locate them in **Model Inventory**.

---

## Environment Variables Reference

| Variable | Default in Container | Description |
|---|---|---|
| `PORT` | `8080` | Internal HTTP server port |
| `COMFYUI_URL` | `http://comfyui:8188` | ComfyUI HTTP endpoint (`http://host.docker.internal:8188` when ComfyUI is on the host) |
| `LOCAL_LLM_URL` | `http://host.docker.internal:11434/v1` | OpenAI-compatible `/v1` endpoint for the Local LLM Agent (`LM_STUDIO_URL` and `LLM_BASE_URL` are also supported as aliases) |
| `LOCAL_LLM_API_KEY` | *(Optional)* | Server-side Bearer API key (`Authorization: Bearer <key>`) for authenticated OpenAI-compatible LLM endpoints (`LLM_API_KEY` also supported) |
| `COMFYUI_OUTPUT_DIR`| `/data/output` | Read-only mount of ComfyUI output directory |
| `COMFYUI_MODELS_DIR`| `/data/models` | Read-only mount of ComfyUI models directory |
| `DATABASE_PATH` | `/app/data/gallery.db` | Persistent SQLite database location |
| `THUMBNAIL_PATH` | `/data/thumbnails` | Directory for cached WebP thumbnails |
| `BACKUP_PATH` | `/app/data/backups` | Persistent directory for SQLite database backups |
| `LOGS_DIR` | `/app/data/logs` | Directory for size-capped rotating server logs (`couchy.log`, 5 MB &times; 2 files) |
| `DOWNLOADS_DIR` | `/downloads` | Target directory for confirmed model downloads |
| `CIVITAI_API_KEY` | *(Optional)* | Civitai API token for model search, metadata enrichment, and authenticated downloads |
| `HF_API_TOKEN` | *(Optional)* | Hugging Face token for model downloads |

---

## Backup, Restore & Maintenance

1. **Database Snapshots**: In the web UI, go to **System &rarr; Database** to create a verified SQLite database snapshot (`gallery-backup-*.db`) using `PRAGMA integrity_check`.
2. **Annotation Export**: Export all user-created annotations (ratings, character tags, favorites, notes) to a portable JSON file.
3. **Automatic Migrations**: When updating Couchy via `git pull && docker compose up -d --build`, database schema migrations run automatically on startup without risking existing records.

---

## License

MIT License. See [LICENSE](LICENSE) for details.
