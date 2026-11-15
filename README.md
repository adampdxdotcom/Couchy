# Couchy

A local-first, self-hosted AI image gallery, character organization system, and prompt orchestration studio. Couchy connects directly to your [ComfyUI](https://github.com/comfyanonymous/ComfyUI) instance and an optional OpenAI-compatible Local LLM (such as Ollama, `llama.cpp`, KoboldCpp, vLLM, TabbyAPI, or LM Studio) to generate, organize, tag, and explore images with complete metadata provenance.

Repository: **[https://github.com/adampdxdotcom/Couchy](https://github.com/adampdxdotcom/Couchy)**

---

## Overview

Couchy bridges the gap between raw ComfyUI generation folders and an organized, searchable creative studio. Whether you want to curate thousands of historical renders, maintain multi-LoRA character rosters, inspect node-level workflow dependencies, or orchestrate single shots and multi-shot photo sets using a unified Local LLM Agent, Couchy gives you a responsive desktop and mobile web interface without touching your original image files.

> **Supported Image Generation Model**: Image generation in Couchy is currently built exclusively for **Krea 2** (`Krea2 Turbo`) ComfyUI workflows (natural-language prose prompting, Krea 2 aspect/megapixel resolution node conventions, and inline `4x` ESRGAN upscaling). Other image generation model architectures (such as SD 1.5, SDXL, Pony, Illustrious, or standard Flux.1) are **not supported** for generation at this time.

- **Non-Destructive & Read-Only**: Original images and models in your primary ComfyUI folders are never renamed, relocated, or modified.
- **Content-Addressed Tracking**: Every image is indexed by its **SHA-256** hash. If you move or reorganize files in your ComfyUI output folders, all favorites, star ratings, tags, collections, notes, series stacks, and character associations are automatically preserved.
- **Embedded Metadata Extraction**: Reads PNG text chunks (`tEXt`, `zTXt`, `iTXt`) to extract visual node graphs, API prompt payloads, sampler settings, seeds, checkpoints, and LoRA parameters.
- **Responsive Desktop & Mobile UI**: Top navigation across **Gallery**, **Characters**, **Generation Studio**, **LoRAs & Models**, **Workflow**, and **System** (with a slide-down mobile drawer, a live ComfyUI WebSocket progress & queue indicator, and a recent-messages center).

### Contents
- [Installation & Deployment](#installation--deployment)
- [Global Navigation & Live Telemetry](#global-navigation--live-telemetry)
- [Workspaces & Feature Manual](#workspaces--feature-manual)
  - [Quick Gen Dock & Unified Agent](#quick-gen-dock--unified-agent)
  - [Gallery, Filtering & Bulk Curation](#gallery-filtering--bulk-curation)
  - [Image Inspector, Series Stacks & A/B Split Compare](#image-inspector-series-stacks--ab-split-compare)
  - [Characters, Portrait Framing & Auto-Recognition](#characters-portrait-framing--auto-recognition)
  - [Generation Studio](#generation-studio)
  - [LoRAs, Model Inventory & Downloader (Civitai & Hugging Face)](#loras-model-inventory--downloader-civitai--hugging-face)
  - [Workflows & Structured Node Editor (Krea 2 Only)](#workflows--structured-node-editor-krea-2-only)
  - [System Administration & In-App Help](#system-administration--in-app-help)
- [Local LLM Prompts & Runtime Context Reference](#local-llm-prompts--runtime-context-reference)
- [Keyboard Shortcuts & Curation Hotkeys](#keyboard-shortcuts--curation-hotkeys)
- [Architecture & Data Model Blueprint](#architecture--data-model-blueprint)
- [Environment Variables Reference](#environment-variables-reference)
- [Backup, Restore & Maintenance](#backup-restore--maintenance)
- [License](#license)

---

## Installation & Deployment

### Prerequisites
- Docker and Docker Compose installed ([Docker Engine](https://docs.docker.com/engine/install/))
- A running [ComfyUI](https://github.com/comfyanonymous/ComfyUI) instance (bare metal or containerized) configured with a **Krea 2** workflow & model weights (only Krea 2 generation is currently supported)
- *(Optional)* An NVIDIA GPU with NVIDIA Container Toolkit installed for GPU-accelerated local ONNX tagging
- *(Optional)* Any OpenAI-compatible Local LLM server (Ollama, `llama.cpp`, KoboldCpp, vLLM, TabbyAPI, or LM Studio) for Quick Gen **Agent** (`x1` and `x2`–`x8` Set Concept expansion), Generation Studio photo sets, Portrait physical analysis, Image Interrogation, and **System &rarr; Help** documentation Q&A

### Step 1: Clone the Repository

```bash
git clone https://github.com/adampdxdotcom/Couchy.git
cd Couchy
```

*To update an existing installation:*
```bash
git pull origin main
```

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
      - /path/to/Couchy/data/thumbnails:/data/thumbnails
      - /path/to/ComfyUI/output:/data/output:ro
      - /path/to/ComfyUI/models:/data/models:ro
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

### Step 4: Configure ComfyUI `extra_model_paths.yaml` (For Downloaded Models)

To keep your primary ComfyUI installation safe, Couchy mounts `/path/to/ComfyUI/models` as **read-only (`:ro`)** and writes all models downloaded through the Couchy UI into `./model-downloads` (mounted at `/downloads` inside the container) using standard ComfyUI subfolder names.

To let ComfyUI discover and load models from `model-downloads` alongside your main models folder, create or edit `extra_model_paths.yaml` in the root of your ComfyUI directory (e.g., `/path/to/ComfyUI/extra_model_paths.yaml`):

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

- **Automatic Folder Creation**: You do **not** need to manually create the subfolders inside `model-downloads` before downloading—Couchy automatically creates the target subfolder (`loras`, `text_encoders`, `diffusion_models`, etc.) whenever a download starts.
- **Optional Pre-Creation**: If you want all folders present on disk immediately so ComfyUI logs zero missing-directory warnings on startup, you can run:
  ```bash
  mkdir -p /opt/docker/Couchy/model-downloads/{loras,checkpoints,diffusion_models,unet,text_encoders,clip,vae,controlnet,upscale_models,embeddings}
  ```
- Restart ComfyUI once after creating `extra_model_paths.yaml` (or press **`R`** in the ComfyUI web UI to refresh node definitions after new downloads finish).

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

## Global Navigation & Live Telemetry

The persistent sticky top header (`TopNavHeader`) spans every workspace:
- **6 Primary Workspaces**: **Gallery**, **Characters**, **Generation Studio**, **LoRAs & Models**, **Workflow**, and **System** (automatically collapsing into a slide-down hamburger menu on mobile screens).
- **Unified Status Pill & Progress Bar**:
  - Connects to ComfyUI's live WebSocket (`comfyuiLiveMonitor`) to display real-time generation percentage, current step progress (`Step X/Y`), and active `running · queued` counts with a shaded progress fill directly inside the pill.
  - Temporarily surfaces 3-second action toasts (saves, clipboard copies, undoable rejections, download completions) over the status pill without interrupting workflow.
- **Status & Message Center Dropdown**: Click the status pill to inspect ComfyUI idle/running/offline status, Local LLM connection status and loaded model name, and the **Last 10 Messages** history log (with a one-click **Clear** control).

---

## Workspaces & Feature Manual

### Quick Gen Dock & Unified Agent

The **Quick Gen Box** is an always-accessible floating bottom dock available across the **Gallery**, **Characters**, **LoRAs & Models**, and **Workflow** tabs (and can be toggled on/off globally under **System &rarr; Search**).

- **Collapsible Bottom Dock**:
  - Stays anchored at the bottom of the screen as you browse your gallery or characters.
  - Click the **Quick Gen** tab handle to minimize the dock out of the way (displaying a preview snippet if a draft prompt is present) or expand it on demand.
  - Automatically expands the prompt input box when focused or populated, and submits on `Enter` (`Shift+Enter` for new lines).

- **`@Character` & `@LoRA` Mention Picker & Auto-Attachment**:
  - Type `@` anywhere in the prompt (or click the **`+`** button) to open a two-column searchable `@Character` & `@LoRA` picker (`All`, `Characters`, and `LoRAs` tabs).
  - Direct **Character** and **LoRA** matches rank at the top of the list above matching reference image prompts, with keyboard navigation (`ArrowUp`, `ArrowDown`, `Enter`/`Tab`, `Escape`) or mouse hover to preview character portraits, confirmed reference images, and prompt snippets.
  - Selecting a character or mention-enabled LoRA attaches a removable **Pill Badge** above the prompt and automatically injects configured LoRAs, model/CLIP weights, trigger words, and the character's preferred default workflow on submission.

- **Hybrid Image-to-Prompt Interrogation (Drag, Paste, or Upload)**:
  - **Drop, Paste, or Browse**: Drag and drop an image file onto the Quick Gen Box, paste an image from your clipboard (`Ctrl+V` / `Cmd+V`), or click the **Image Upload (`ImagePlus`)** button.
  - **1MP Downscaling & Auto Aspect Ratio**: The browser automatically downscales the reference image to at most ~1 Megapixel (`1,048,576` pixels) while preserving its aspect ratio, and sets the Quick Gen aspect ratio selector to the closest matching preset.
  - **Hybrid Vision / WD14 + Local LLM Pipeline**:
    - **Vision Model Loaded in Local LLM**: Sends the 1MP image directly to the local Vision Language Model (VLM) via `/v1/chat/completions` to synthesize a detailed prose prompt (independent of whether the `Agent` toggle is active).
    - **Text-Only Model Loaded in Local LLM**: Runs the image through the local `wd-vit-tagger-v3` ONNX visual tagger first, then feeds the extracted tags into the local text LLM to write a natural prose prompt.
    - Automatically disabled with a helpful tooltip whenever the Local LLM server is offline.
  - **Character-Aware Physical Trait Stripping**: If a character is already attached in the Quick Gen Box when you drop or upload a photo, Couchy automatically strips conflicting physical identity traits—such as hair color, eye color, permanent facial features (freckles, moles), skin tone, race/ethnicity, and body proportions—while keeping hairstyle structure, transient facial expressions/emotions (e.g., smiling, blushing), pose, clothing/NSFW state, lighting, and framing so the character's LoRA defines their appearance cleanly.
  - **Optional Reference Archiving**: Enable *"Save Uploaded Prompt Images"* under **System &rarr; Search** to automatically archive each 1MP downscaled reference image to `data/uploaded`.

- **Unified Local LLM Agent (`Agent` Toggle)**:
  - Toggle the **Agent** button directly in the Quick Gen Box to open an inline Agent chat drawer inside the dock (no separate window).
  - Develop lighting, framing, wardrobe, mood, and scene ideas back-and-forth with your local LLM (sending up to the last 10 messages per turn, with a 90s timeout and automatic anchor recall on long threads). Use **Clear** in the Agent header at any time to reset the thread.
  - The Agent can also automatically select and attach up to 3 relevant non-character `@mention` LoRAs (`<selected_loras>`) that have Agent descriptions configured, while respecting any LoRAs you manually remove.
  - **Single-Shot Mode (`x1`) vs. Set Concept Mode (`x2`–`x8`)**:
    - At **`x1`**, the Agent produces a **Proposed Prompt** card (`<proposed_prompt>`) formatted in a structured 5-part sentence order (`Medium & Framing` &rarr; `Action & Contact Points` &rarr; `Wardrobe & Styling` &rarr; `Environment & Props` &rarr; `Lighting & Palette`) with strict anchor locking across follow-up edits. Click **Submit** to dispatch it directly as a single generation or iterative stack step.
    - At **`x2`–`x8`**, the Agent shifts into **Set Concept Mode** (`<proposed_concept>`)—focusing on the visual medium, wardrobe plan, lighting, and shot-to-shot arc instead of locking one static pose. On the **Set Concept** card, choose between two workflows:
      - **`Preview Shots (xN)`**: Expands the concept into `N` editable shot prompts right inside the Agent drawer so you can manually tweak individual shots, click **Re-expand** for fresh variations, and click **`Submit N Shots`** when ready.
      - **`Expand & Submit (xN)`**: Expands the concept into `N` cohesive shots and queues them directly to ComfyUI as a **multi-shot set stack**.
    - Generation count automatically resets back to `x1` after submission or whenever reopening the Agent from an existing image or stack.

- **Workflow, Aspect Ratio & Batch Size Selector**:
  - Click the workflow/ratio pill (e.g., `2:3 · 3MP · x1`) to open the quick settings popover:
    - **Aspect Ratio Presets**: `1:1`, `9:16`, `16:9`, `3:4`, `4:3`, `2:3`, and `3:2` (mapped directly to your workflow's resolution/aspect node).
    - **Number of Generations**: `x1`, `x2`, `x4`, `x6`, or `x8` images per batch (when **Agent** is active, `x2`–`x8` switches the Agent into **Set Concept Mode**).
    - **Resolution**: Selectable from `0.5 MP` up to `10.0 MP`. Up to `3.0 MP` renders natively; higher targets automatically trigger the inline `4x` ESRGAN upscale + downscale pass.
  - Automatically displays and uses the attached character's preferred workflow if configured, or falls back to your default ComfyUI workflow.

- **One-Click "Reuse Prompt" Integration**:
  - Clicking **Reuse Prompt** (`RotateCcw`) on any gallery card or inside the Inspector automatically expands the Quick Gen Box, fills in the positive prompt, matches the original image's aspect ratio preset, and re-attaches the confirmed character and LoRAs.

---

### Gallery, Filtering & Bulk Curation

- **View Layouts & Thumbnail Scaling**:
  - Switch between **Grid** (uniform square crop), **Masonry** (aspect-ratio-preserving multi-column layout), and **Compact** (high-density borderless tiles without footers).
  - Resize density on demand via **`SM` / `MD` / `LG`** thumbnail scale buttons.
- **Streamlined Card Footer & Quick Actions**:
  - Displays three clean rows below each card in Grid/Masonry modes: **Character Name** (clickable to filter by that character), **LoRA Pills** (showing custom nicknames/names), and **Image Details** (`width×height · aspect ratio · checkpoint`).
  - Hover/quick actions on cards let you **Select**, **Rate (`1–5★`)**, **Favorite / Poster**, **Reuse Prompt**, launch **Agent (`MessageSquare`)**, or **Reject** (with an instant floating **Undo** toast).
- **Pagination vs. Infinite Scroll & Live Ghost Cards**:
  - Switch between discrete page navigation and seamless **Infinite Scroll** right in the filter bar.
  - Active queued or generating Quick Gen / Generation Studio items appear inline in the gallery as live **Pending Ghost Cards** displaying percentage progress, prompt snippet, and target character—automatically seamlessly replaced as finished PNGs arrive.
- **Sticky Search & Multi-Faceted Filter Drawer**:
  - Full-text search across positive/negative prompts, filenames, checkpoints, LoRAs, and visual tags.
  - Expand **Filters** for boolean-capable multi-select **Character Filter** (`Match ALL` / `Match ANY` + *Include unconfirmed character suggestions*), **Multi-LoRA Filter** (`Match ALL` / `Match ANY` + **Min / Max Strength** bounds), **Favorites Only**, **Minimum Star Rating (`1–5★`)**, **Checkpoint**, **Collection**, **Tags**, **Date Range**, **Dependency Status** (`Exact Match`, `Available`, `Incomplete`, `Unknown`), and **Rejected / Archived modes** (`Exclude`, `Include`, `Only`).
  - **9 Sort Orders**: Newest First, Oldest First, Highest Rated, Lowest Rated, Filename, File Size, Checkpoint, Most-Used LoRA, and Recently Favorited.
  - **Saved Search Presets & Filtered Export**: Save any active filter combination as a named one-click preset pill, or click **`ZIP (N)`** to download all matching filtered images in a ZIP archive.
- **Multi-Select & Floating Bulk Operations Bar**:
  - Select individual cards via their checkboxes or hold **`Shift + Click`** to select/deselect a contiguous range.
  - A floating bulk toolbar appears with batch **Star Rating**, **Favorite**, **Archive**, **Reject**, **Add Tag**, **Assign Character**, **Assign Collection**, **Export Selected ZIP**, **Select All**, and **Clear**.

---

### Image Inspector, Series Stacks & A/B Split Compare

- **Stacked Image Iterations & Multi-Shot Sets**:
  - **Iterative Stacks** link progressive `x1` Agent refinements (saving full chat snapshots across steps) and upscales. Click the yellow **Agent (`MessageSquare`)** icon on a card, or use **Continue Chat** / **Branch #N** inside the Inspector, to continue or branch off the stack.
  - **Multi-Shot Sets** group parallel shots generated as a batch (`x2`–`x8`). On Main Gallery and Character Gallery cards, the yellow **Agent (`MessageSquare`)** icon is shown in a **disabled** state on multi-shot set cards to prevent ambiguous whole-set edits; open the **Image Inspector** or **Series Mini Gallery** (`Gallery` button) and click **Iterate** / **Iterate #N** on a specific shot to start a new `x1` iterative Agent stack seeded from that shot's prompt without altering the original set.
  - **Continue Latest vs. Branch from Middle**: Continuing from the latest iteration overlays a translucent live **Pending** / `%` progress indicator on that existing stack's card (and a simplified `#N` **Pending** / `%` tile inside the **Series Stack** strip) and appends the result to the same stack. Branching from a middle step (`Branch #3`) or iterating from a multi-shot set spawns a separate new gallery card during generation and splits off a new iterative stack on completion.
  - **Exclusive Poster / Hearted Image**: Within a stack, only one iteration can be hearted at a time. That hearted image serves as the stack's **Poster Image** in both Main and Character galleries (falling back to the newest step if none is hearted).
- **Full-Screen Inspector & Loupe Magnifier**:
  - Click any card to open the Inspector; click the image canvas itself (or press `Space`) to toggle fullscreen, or toggle the **Loupe (`L`)** magnifier with `2×`, `4×`, and `1:1 Native` presets and click-to-pin locking.
  - The right metadata sidebar surfaces **Assigned Character** (with portrait thumbnail), **Workflow & Reproducibility** (`Run Workflow` and inline `4x` ESRGAN `Upscale` with live card/strip progress), **Series Stack** strip + **Series Mini Gallery (`S`)** contact-sheet modal, positive/negative prompts (with reliable one-click **Copy**), generation parameters (`Steps`, `CFG`, `Sampler`, `Scheduler`, `Seed`, dimensions, file size, creation date), LoRA chips & weights, ONNX visual tags, custom tags, collections, and personal notes.
- **A/B Split-Screen Comparison**:
  - Click **Compare** in the Inspector header (next to `X`) to compare stack steps or any two images:
    - **Smart Pre-Fill & Stack Picker**: Automatically loads the previous or favorited iteration from an active series stack into Slot B, or click **Compare with...** to browse stacked gallery cards with search and Character, LoRA, Rating, and Favorites filters. Switch steps inside each slot via per-slot series strips.
    - **Side-by-Side & Overlay Wipe Modes**: Switch between a clean two-pane view and an interactive **Overlay Wipe** slider with a draggable vertical divider inside a shared `object-contain` container, plus **Fit (Normalized)** vs. **100% Native** pixel inspection.
    - **Synced Dual & Split Loupe Inspector**: Toggle **Loupe (`L`)** in Split Mode to project a synchronized **Dual Mirrored Lens** across both panes or a **Split `[A | B]` Lens** in Overlay Wipe mode (click to pin/lock).
    - **Collapsible Bottom Diff Drawer**: Highlights differences only (word-level positive prompt diff, negative prompt diff, differing parameters/resolution, and added/removed/weight-changed LoRAs) with per-slot **Star Rating**, **Heart**, **Reuse**, and **Reject** actions, plus **Swap** and layered `Esc` unwinding (`Picker` &rarr; `Exit Split` &rarr; `Close Inspector`).

---

### Characters, Portrait Framing & Auto-Recognition

- **Character Roster & Non-Destructive Merge**:
  - Browse character profile cards showing confirmed counts, suggested counts, linked LoRAs, aliases, and average ratings.
  - **Create Character** profiles with custom aliases, bio, notes, and initial portrait, or **Merge Characters** to consolidate duplicates non-destructively (transferring confirmed/suggested image links, aliases, LoRAs, workflows, tags, collections, and optionally adopting the source character's portrait and display crop).
- **Character Profile Workspace**:
  - **Display-Only Portrait Framing (`Pencil` Button)**: Hover/tap the bottom-right **Pencil** icon on a character's profile portrait to open the **Frame Portrait** modal. Drag to adjust focal coordinates (`0%–100%`), scroll or slide to zoom (`1.00×–3.00×`), verify against the circular avatar guide and live `1:1 Profile` / `4:3 Card` / `Badge` previews, or **Reset** to default. Portrait framing is purely CSS display metadata—it never alters the original image file, SHA-256 hash, thumbnail file, or full uncropped photo sent to the LLM.
  - **Adaptive Portrait Analysis (`Analyze Portrait`)**: Click **Analyze Portrait** on any character profile to scan their portrait—using a Vision LLM when loaded, or seamlessly falling back to `wd-vit-tagger-v3` + Text LLM (or WD14 tags alone)—to populate **Physical Description (Agent Reference Guide)**. The Agent uses this guide conceptually without verbatim copying or overriding user-requested outfits, hairstyles, or poses.
  - **Associated LoRAs, Favorite Addons & Friends**: Link one or more character/outfit LoRAs (with trigger words and variant labels), toggle character collections, and inspect **Favorite Addons**—showing the top paired **Base Models** and non-character **Addon LoRAs** (ranked by **Most Used** or **Top Rated**, with average strength, one-click gallery filtering, and `+` pre-attach into Quick Gen). Whenever other characters' LoRAs appear in multi-character renders with this character, a **Friends** subsection surfaces automatically with co-occurrence stats and profile/Quick Gen shortcuts (and remains hidden when none are paired).
  - **Assisted Recognition & Suggestions Review**: When new ComfyUI renders finish (or when running **Assisted Identification** manually), Couchy matches LoRAs, trigger words, aliases, and workflows. Review pending suggestions in bulk (**Select All**, **Confirm**, **Reject**), inspect the expandable **Highest-Rated Generations** spotlight (`5★` or `4+★`), set any confirmed image as the character portrait, or click **Download All Images** for a character ZIP archive.

---

### Generation Studio

- **Full-Featured Krea 2 Batch Workspace**:
  - Select a character (auto-populating their LoRA stack and trigger words), stack additional LoRAs with custom model/CLIP strengths, override the checkpoint/diffusion model, choose an aspect ratio (`1:1`, `9:16`, `16:9`, `3:4`, `4:3`, `2:3`, `3:2`), set target **Megapixels (`0.5–10.0 MP`)**, and configure batch count.
- **Single Prompt (Verbatim) vs. Photo Set Theme (Local LLM)**:
  - **Single Prompt (Verbatim)**: Compiles your Base Positive Prompt with `{character}`, `{lora}`, and `{theme}` template interpolation directly across batch slots with unique 64-bit seeds.
  - **Photo Set Theme (Local LLM)**: Uses your Base Positive Prompt as an optional **Visual Style Foundation** alongside your **Photo Set Theme Description** via the unified Local LLM Agent (`Primary Agent System Prompt` + `Batch Expansion Instructions`) to script cohesive shot prompts.
- **Prompt Templates & Outgoing Queue Preview**:
  - Save, load, and manage reusable named **Prompt Templates**.
  - Inspect, hand-edit, or reset every generated prompt slot inside the **Outgoing Prompt Queue Preview** before submitting the batch, and track submitted jobs in **Batch Queue History**.

---

### LoRAs, Model Inventory & Downloader (Civitai & Hugging Face)

Open **LoRAs & Models** to browse three integrated sub-views (`LoRA Explorer`, `Model Inventory`, and `Civitai & HF Downloader`):

- **LoRA Explorer (Grid & Table Views) & LoRA Detail Inspector**:
  - Search by name, filename, base model, trigger word, SHA-256 hash, or linked character; filter by category (`character`, `style`, `clothing`, `concept`, `pose`, `object`, `unclassified`); switch between **Grid** and **Table** layouts.
  - **Hide / Unhide Utility LoRAs**: Mark noisy or utility LoRAs as hidden to exclude them from Quick Gen `@mention` and default views; toggle **Show Hidden (N)** anytime to manage them.
  - **Inline `@Mention` & Detail Inspector**: Toggle Quick Gen `@mention` inclusion strictly via checkboxes and edit `@nicknames` inline, or click any LoRA to open **LoRA Detail View**—showing Civitai metadata sync (**Fetch from Civitai**), cached preview thumbnails (clickable lightbox), recommended vs. default model/CLIP strengths, trigger words, **Agent Description**, **Personal User Notes**, **CivitAI Description**, linked characters (using portrait crop framing), **Usage Impact Report**, and highest-rated / all associated images.
- **Model Inventory & Missing Workflow Dependencies**:
  - Indexes both `COMFYUI_MODELS_DIR` (`/data/models`) and `DOWNLOADS_DIR` (`/downloads`) across all ComfyUI subfolders (`loras`, `checkpoints`, `diffusion_models`, `unet`, `text_encoders`, `clip`, `vae`, `controlnet`, `upscale_models`, `embeddings`).
  - Lists **Missing Model Dependencies** referenced by indexed images or workflows along with historical SHA-256 / AutoV2 hashes and dependent image counts—click **Locate & Download** to search Civitai/HF directly by hash or name.
  - Inspect **Usage Impact Reports** on any installed model to see exact dependent images, workflows, and character profiles before moving or removing weights.
- **Civitai API Key (`CIVITAI_API_KEY`)**:
  - Public Civitai searches work without authentication, **but many models (including NSFW/mature, early-access, or creator-gated weights) return HTTP `401` / `403` unless authenticated**.
  - Create a personal token in your Civitai **Account Settings &rarr; API Keys**, add `CIVITAI_API_KEY=your_token_here` to `.env`, and recreate the container (`docker compose up -d`).
  - Couchy forwards the token via Bearer authorization headers for both Civitai API metadata lookups and weight file downloads.
- **Supported Smart Search Inputs (Civitai & Hugging Face Downloader)**:
  - **Keyword Queries**: Searches Civitai (with optional type filter: LoRA, Checkpoint, Text Encoder/CLIP, ControlNet, VAE, Upscaler, Embedding) and Hugging Face Hub.
  - **Civitai URLs**: Paste any `civitai.com` or `civitai.red` model page URL (`/models/<id>`), version link (`?modelVersionId=<id>`), or direct download link (`/api/download/models/<id>`).
  - **SHA-256 & AutoV2 Hashes**: Paste either a full **64-character SHA-256** hash or a **10-character AutoV2** hash to locate an exact model version.
  - **Hugging Face & Direct Links**: Paste an `owner/repo` ID, Hugging Face file URL, or direct `.safetensors` / `.gguf` / `.ckpt` link.
- **`civitai.com` vs. `civitai.red` Detection & Link Healing**:
  - Models that are mature-gated or delisted on `civitai.com` are automatically retried against `civitai.red` across hash lookups, URL resolution, metadata enrichment, and file downloads, with links labeled **`Civitai.red`**.
  - Click **Heal Civitai Links** in the **LoRAs & Models** toolbar at any time to audit existing database records and repair broken `.com` / `.red` links.
- **Multi-Version Selector, "Already Installed" Detection & Early Access Scheduling**:
  - Switch versions in-card via the **Civitai Version Selector** (`✓ Installed`, `⏳ Early Access`) with live updates to previews, trigger words, hashes, and download actions.
  - Matches installed weights by SHA-256 / AutoV2 hash, Civitai Version ID, or filename (`Inspect Installed` / `Re-download / Overwrite`).
  - For Early Access models, view the unlock countdown and click **Schedule Download** (persisted in SQLite with a background scheduler and automatic retry on unlock transition) or **Try Now** if unlocked with Buzz.
- **Destination Folders, Hash Verification & Post-Download Workflow**:
  - Non-installed Civitai LoRAs download in one click straight into `/downloads/loras` (`./model-downloads/loras`). Multi-file Hugging Face repositories and other model types open a confirmation modal to pick the exact file and subfolder with automatic folder inference.
  - Downloads stream atomically to `.part` files, verify SHA-256 checksums, cache up to 4 WebP previews locally, stack active downloads newest-first, and link completed history rows straight into **LoRA Detail Inspector** or **Model Inventory**.

---

### Workflows & Structured Node Editor (Krea 2 Only)

- **Built for Krea 2 Workflows**: Couchy's prompt compilation, resolution selector (`#49`), LoRA stacker, and `4x` ESRGAN upscale pipeline are tailored specifically for **Krea 2** (`Krea2 Turbo`) ComfyUI API workflows; other image generation architectures are not supported.
- **Import & Node Mapping**: Import ComfyUI API or visual workflow JSON files, set a **System Default** workflow across Generation Studio and Quick Gen, and map dynamic node slots (positive prompt, negative prompt, checkpoint/diffusion loader, LoRA loader, latent resolution, and seed).
- **Structured Visual Node Editor vs. Raw JSON**:
  - Search nodes by title, ID, or class type (`nodeSearchFilter`) and edit parameters directly in structured UI controls (`Prompt`, `Sampler`, `Steps`, `CFG`, `Resolution`, `Seed`) or switch to the **Raw JSON** tab with syntax/validation checks and dirty-state tracking.
  - **Interactive `rgthree` Power Lora Loader Editor**: Add, remove, toggle `on/off`, pick LoRAs from synced inventory, and tune strength directly on `Power Lora Loader (rgthree)` nodes.
- **Live Validation, Test Runs & Clean Export**:
  - Validates every referenced checkpoint, diffusion model, VAE, CLIP, LoRA, and upscaler (`Exact Match`, `Available`, `Missing`) before queueing.
  - Click **Run Workflow** to execute a live test directly on ComfyUI (tracked in **Workflow Reproduction History** with clickable output thumbnails), or export cleaned API Prompt JSON via modal.

---

### System Administration & In-App Help

The **System** workspace organizes administration into six focused sub-tabs:

1. **Search** (`Workspace Preferences` + `Local ONNX Visual Keyword Tagger`):
   - Toggle **Enable Floating Quick Gen Box** globally and toggle **Save Uploaded Prompt Images** (`data/uploaded`).
   - Enable/disable the built-in **`wd-vit-tagger-v3`** ONNX tagger (stored in `/app/data/local_models`), switch **CPU vs. NVIDIA GPU** inference, tune confidence threshold, monitor live indexing progress, and trigger **Pause / Resume**, **Scan Unindexed**, or **Rescan All**. Supports offline/text-LLM fallback paths for Quick Gen interrogation and Character portrait analysis.
2. **Agent** (`Local LLM Endpoint & Prompts`):
   - Configure any OpenAI-compatible `/v1` base URL using one-click presets (**Ollama `:11434/v1`**, **llama.cpp `:8080/v1`**, **KoboldCpp `:5001/v1`**, **vLLM `:8000/v1`**, **Port 1234 `:1234/v1`**) and test live connectivity + **Vision vs. Text-Only** model capabilities.
   - Edit and save the **Primary Agent System Prompt** and **Batch Expansion Instructions** (with **Editorial Variety**, **Storyboard Arc**, and **Lookbook Angles** presets) or reset to defaults.
3. **ComfyUI** (`Connection, Paths & Auto-Clean`):
   - Configure and test `COMFYUI_URL` connectivity and inspect active `output`, `models`, and `downloads` directories.
   - **Auto-Clean Copied Downloads**: Optional cleanup daemon with configurable retention hours (`24h` default). When enabled, verifies an identical **filename, byte size, and SHA-256 hash** inside your read-only `COMFYUI_MODELS_DIR` before removing Couchy's duplicate from `DOWNLOADS_DIR`—leaving ComfyUI's copy and all metadata untouched (automatically guards against deleting if both paths point to the same directory).
4. **Database** (`Backups & Annotation Restore`):
   - Create verified SQLite snapshots (`gallery-backup-*.db` via `PRAGMA integrity_check`) and export/import portable JSON backups of all human annotations (ratings, favorites, rejection/archive flags, notes, tags, collections, characters, and portrait crops).
5. **Metadata** (`Filesystem Scanner & Machine Rebuild`):
   - Trigger an **Incremental Scan** (adding/updating changed files without touching existing records) or **Rebuild Machine Metadata** (re-parsing embedded PNG `tEXt`/`zTXt`/`iTXt` chunks across all images while preserving all ratings, tags, collections, series stacks, and characters), and review the recent **Scan History** log.
6. **Help** (`Live Documentation & Ask the Docs`):
   - Renders `README.md` live inside the app with a **Filter Sections** search input, **Jump to Section** dropdown, smooth clickable anchor links, **Reload** from disk, and one-click **Copy** buttons on every code block.
   - **Ask the Docs (Conditional Local LLM Assistant)**: When a Local LLM is online (`lmStatus.online`), a sticky **Ask the Docs** chat sidebar appears alongside the README. Questions are answered using a ranked retrieval slice of `README.md` sections, returning Markdown answers with clickable **Source** section chips that scroll directly to the cited heading.

---

## Local LLM Prompts & Runtime Context Reference

Couchy uses a unified prompt architecture configured under **System &rarr; Agent** (plus specialized internal prompts for image interrogation, portrait analysis, Generation Studio, and Help docs search):

| Prompt / Setting | Where Configured | What It Does |
|---|---|---|
| **Primary Agent System Prompt** | **System &rarr; Agent** | The core system prompt sent on **every** Agent turn (`x1` and `x2`–`x8`) **and** every batch expansion (Quick Gen and Generation Studio). Controls concise 1–3 sentence replies, tag structure (`<proposed_prompt>` vs. `<proposed_concept>`), the 5-part sentence order (`Medium & Framing` &rarr; `Action & Contact Points` &rarr; `Wardrobe & Styling` &rarr; `Environment & Props` &rarr; `Lighting & Palette`), concrete Krea 2 spatial/physical descriptions, trait/naming safety, and single-shot anchor locking across iterative turns. |
| **Batch Expansion Instructions** | **System &rarr; Agent** *(with 3 Style Presets)* | Appended right after the Primary Agent System Prompt whenever expanding an approved Set Concept (`x2`–`x8` in Quick Gen) or a **Photo Set Theme** (Generation Studio) into `{count}` standalone `<shot_1>...</shot_{count}>` prompts (`4096` max tokens, `90s` timeout). Ships with three presets: **Editorial Variety** (default—locks continuous scenes while allowing natural evolution for multi-take/location arcs), **Storyboard Arc** (chronological establishing &rarr; action &rarr; detail &rarr; climax sequence), and **Lookbook Angles** (rotates focal lengths `35mm`–`135mm` and angles across looks). |
| **Automatic Runtime Context** | *Injected automatically per request* | Dynamically appended so you never have to hardcode character or LoRA details into system prompts: **(1) Character Profile** (**Personality & Bio** up to 450 chars, **Physical Reference Guide** up to 500 chars, and active variant label as a non-verbatim guide); **(2) Attached LoRA Descriptions** (category & Agent description up to 240 chars); **(3) Optional `@mention` LoRA Catalog** (available non-character LoRAs for `<selected_loras>`, excluding user-deselected ones); and **(4) Mode & Anchor Directives** (`<proposed_prompt>` vs. `<proposed_concept>` and re-pinning older anchors beyond the 10-message window). |
| **Generation Studio Base Template & Theme** | **Generation Studio** | In **Single Prompt (Verbatim)** mode, your Base Positive Prompt (supporting `{character}`, `{lora}`, `{theme}`) is sent directly to ComfyUI across batch slots with unique 64-bit seeds. In **Photo Set Theme (Local LLM)** mode, the Base Positive prompt serves as an optional **Visual Style Foundation** alongside your **Photo Set Theme Description** when the unified Agent scripts your editable **Outgoing Prompt Queue Preview**. |
| **Image Interrogation Prompt** | *Internal (Quick Gen Drop / Paste / Upload)* | Instructs your Vision LLM (or `wd-vit-tagger-v3` &rarr; Text LLM fallback) to translate a 1MP reference image into one cohesive text-to-image prompt—preserving pose, expression, lighting, framing, and exact garment/accessory colors (or NSFW/anatomical state) while automatically stripping biological physical identity traits if a Character is already attached. |
| **Portrait Physical Analyzer Prompt** | *Internal (Character **Analyze Portrait**)* | Instructs your Vision LLM (or `wd-vit-tagger-v3` physical tags &rarr; Text LLM / WD14-only fallback) to extract a concise `~35–70` word summary of permanent physical traits (gender presentation, build, skin tone, natural hair color/texture, eye color, facial structure, permanent marks) while ignoring outfits, poses, lighting, and background. |
| **Help Docs Q&A Prompt** | *Internal (**System &rarr; Help**)* | Ranks sections of live `/README.md` against the user's question + follow-up terms and instructs the Local LLM to answer accurately from those retrieved documentation excerpts while emitting clickable section source links. |

---

## Keyboard Shortcuts & Curation Hotkeys

Single-key curation shortcuts pause automatically whenever focus is inside a text input, textarea, select control, or editable field (and single-key Inspector shortcuts are suppressed while A/B Split Compare or the Compare Picker is open, except `Esc`).

### Image Inspector & Series Curation
*(Click **`?`** in the Inspector header anytime for the in-app reference popover)*

| Key | Action | Notes |
|---|---|---|
| `1` – `5` | Rate active image (`1–5` stars) | Applies to the currently viewed stack iteration |
| `0` | Clear star rating | Resets rating to unrated |
| `F` | Toggle Favorite / Series Poster | On multi-iteration stacks, sets the active step as the exclusive gallery poster |
| `X` or `Delete` | Reject & advance to next card | Shows a floating **Undo** toast for instant recovery |
| `L` | Toggle Loupe magnifier | Enables `2×`, `4×`, or `1:1 Native` zoom centered on the image |
| `S` | Toggle Series Mini Gallery | Opens/closes the contact-sheet modal when viewing a stack or pending stack job |
| `Space` | Toggle Fullscreen view | Expands/collapses the Inspector canvas |
| `←` / `→` | Previous / Next gallery card | Steps across cards in the active gallery view |
| `[` / `]` | Previous / Next stack step | Steps backward or forward through iterations inside a Series Stack |
| `?` | Toggle Curation Shortcuts help | Opens/closes the quick-reference popover in the Inspector header |
| `Esc` | Close / Exit layer by layer | Unwinds `Shortcuts Help` &rarr; `Compare Picker` &rarr; `Series Mini Gallery` &rarr; `Split Compare` &rarr; `Fullscreen` &rarr; `Close Inspector` |

### Gallery Grid & Global Navigation
- **`Shift + Click` (selection checkbox)**: Select or deselect a contiguous range of gallery cards from your last clicked card.
- **`Esc`**: Clears active multi-card gallery selections (when no modal/input is focused), or closes the top navigation dropdown / mobile drawer.

### Quick Gen Dock & Prompt Inputs
- **`Enter` / `Shift + Enter`**: Submit prompt (or send Agent message) / insert a newline.
- **`@Mention` Picker open (`ArrowUp` / `ArrowDown`, `Enter` or `Tab`, `Escape`)**: Navigate, select a `@Character` or `@LoRA`, or dismiss the picker.
- **`Ctrl + V` / `Cmd + V`**: Paste a clipboard image directly into the Quick Gen dock for 1MP image-to-prompt interrogation.
- **`Enter` (Inspector tag input)**: Quickly add a typed custom tag to the active image.

---

## Architecture & Data Model Blueprint

For contributors or anyone reconstructing Couchy's feature set from a system perspective, the application runs as a single Node.js service combining:
- **Frontend SPA**: React + TypeScript + Tailwind CSS (Vite) organized by workspace (`gallery`, `character`, `inspector`, `quickgen`, `generation`, `models`, `workflows`, `system`).
- **Backend Server & Workers**: Express + TypeScript with automatic startup schema migrations on **SQLite (WAL mode)** via `better-sqlite3`, serving `/api/*` endpoints alongside compiled static assets:
  - **Filesystem Scanner & Metadata Parser**: Indexes `COMFYUI_OUTPUT_DIR`, computes SHA-256 hashes, generates cached WebP thumbnails, and parses PNG `tEXt` / `zTXt` / `iTXt` chunks (`prompt` API JSON and `workflow` visual JSON).
  - **ComfyUI Live Bridge & Poller**: Connects to ComfyUI's REST API and WebSocket (`/ws`) to track live step percentages, running/queued jobs, and newly completed renders; compiles Krea 2 API prompt graphs (`workflowCompilerService`) with node mapping, LoRA stacking (`Power Lora Loader` or standard loaders), and inline `4x` ESRGAN upscaling.
  - **Local LLM Proxy & Agent Service**: Communicates server-side with any configured OpenAI-compatible `/v1` server (`LOCAL_LLM_URL` + optional `LOCAL_LLM_API_KEY`), supporting capability inspection (`/v1/models`), unified Agent chat/expansion, Vision + WD14 fallback interrogation/portrait analysis, and README section retrieval (**System &rarr; Help**).
  - **ONNX Tagger, Model Downloader & Maintenance Workers**: In-process `wd-vit-tagger-v3` background queue, Civitai/Hugging Face resolver (with `.com` &rarr; `.red` fallback, atomic `.part` SHA-256 downloader, and Early Access timer scheduler), and optional copied-model duplicate cleanup daemon.

### Core SQLite Domain Groups
- **Images & Provenance**: `images` (content-addressed by `content_hash`), `image_metadata` (prompts, sampler, seed, raw workflow/API JSON), `image_loras`, `image_models`, `image_visual_tags`, and `image_workflows`.
- **Series & Generations**: `image_series` / `image_series_items` (grouping `iterative` stacks with chat snapshots vs. `multi_shot` sets, plus exclusive poster tracking), `generation_batches`, `generation_items`, and `reproduction_jobs`.
- **Curation & Characters**: `ratings` (stars, favorite, rejected, archived, notes), `tags` / `image_tags`, `collections` / `collection_images`, `saved_searches`, and `characters` / `character_aliases` / `character_loras` / `character_workflows` / `image_characters` (including non-destructive `portrait_crop_json` framing).
- **Models & System**: `models` (inventory, hashes, Civitai metadata, `@mention` defaults, hidden state), `download_jobs` & `downloaded_model_copies`, `workflows` & `workflow_mappings`, `prompt_templates`, `lm_studio_settings`, `lm_studio_prompt_templates`, `app_settings`, `scan_jobs`, and `schema_migrations`.

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
2. **Annotation Export**: Export all user-created annotations (ratings, character tags, favorites, notes, portrait framing) to a portable JSON file.
3. **Automatic Migrations**: When updating Couchy via `git pull && docker compose up -d --build`, database schema migrations run automatically on startup without risking existing records.

---

## License

MIT License. See [LICENSE](LICENSE) for details.
