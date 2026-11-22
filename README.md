# Couchy

A local-first, self-hosted AI image gallery, character organization system, and prompt orchestration studio. Couchy connects directly to your [ComfyUI](https://github.com/comfyanonymous/ComfyUI) instance and an optional OpenAI-compatible Local LLM to generate, organize, tag, and explore images with full metadata provenance.

Repository: **[https://github.com/adampdxdotcom/Couchy](https://github.com/adampdxdotcom/Couchy)**

---

## Overview

Couchy bridges raw ComfyUI output folders and an organized creative studio—letting you curate historical renders, manage multi-LoRA character rosters, inspect workflow dependencies, and run single-shot or multi-shot generations across desktop and mobile.

> **Supported Models (Krea 2 & 4x ESRGAN Only)**: Couchy **only** uses **Krea 2** (`Krea2 Turbo`) for image generation and **`4x` ESRGAN** for upscaling. There is **no support** for any other models and **no planned support** for other models. Couchy's built-in workflow is based on the standard ComfyUI Krea 2 template—if you have that template running with its suggested models (plus `4x` ESRGAN), Couchy will work out of the box.

- **Read-Only & Non-Destructive**: Primary ComfyUI output and model folders are mounted read-only (`:ro`). Original files are never renamed, relocated, or modified; thumbnails, downloads, display crops, and annotations are stored separately in Couchy's own data directories and database.
- **Content-Addressed Tracking**: Images are tracked by file hash, so favorites, star ratings, tags, collections, notes, **Series Stacks**, and character assignments stay intact even if files are moved or reorganized.
- **Embedded Metadata Extraction**: Automatically parses embedded PNG workflow and prompt metadata (prompts, sampler settings, seeds, **Base Models**, LoRAs, and visual node graphs).
- **Unified Local LLM Architecture**: Optionally connects to a single OpenAI-compatible `/v1` server to power **Agent** chat and multi-shot expansion, Generation Studio photo sets, image-to-prompt interrogation, portrait physical analysis, and **System &rarr; Help** Q&A.

### Contents
- [Installation & Deployment](#installation--deployment)
- [Global Navigation & Status Center](#global-navigation--status-center)
- [User Guide](#user-guide)
  - [Quick Gen Box & Agent](#quick-gen-box--agent)
  - [Gallery, Filtering & Bulk Curation](#gallery-filtering--bulk-curation)
  - [Image Inspector, Series Stacks & A/B Split Compare](#image-inspector-series-stacks--ab-split-compare)
  - [Characters, Portrait Framing & Assisted Identification](#characters-portrait-framing--assisted-identification)
  - [Generation Studio](#generation-studio)
  - [LoRAs, Base Models, Presets & Downloader](#loras-base-models-presets--downloader)
  - [Workflows & Structured Node Editor](#workflows--structured-node-editor)
  - [System Administration & In-App Help](#system-administration--in-app-help)
- [Keyboard Shortcuts & Hotkeys](#keyboard-shortcuts--hotkeys)
- [Configuration & Technical Reference](#configuration--technical-reference)
  - [Environment Variables](#environment-variables)
  - [Customizing Agent Prompts](#customizing-agent-prompts)
  - [Technical Architecture](#technical-architecture)
  - [Backup, Restore & Maintenance](#backup-restore--maintenance)
- [License](#license)

---

## Installation & Deployment

### Prerequisites
- Docker and Docker Compose ([Docker Engine](https://docs.docker.com/engine/install/))
- A running [ComfyUI](https://github.com/comfyanonymous/ComfyUI) instance configured with the standard **Krea 2** template, its suggested models, and **`4x` ESRGAN** *(compatibility note: Krea 2 + `4x` ESRGAN only)*
- *(Optional)* An NVIDIA GPU with NVIDIA Container Toolkit for GPU-accelerated local visual tagging
- *(Optional)* Any OpenAI-compatible Local LLM server—built-in presets cover **Ollama** (`:11434/v1`), **llama.cpp** (`:8080/v1`), **KoboldCpp** (`:5001/v1`), **vLLM** (`:8000/v1`), and **LM Studio / Port 1234** (`:1234/v1`), plus **TabbyAPI** or custom authenticated `/v1` proxies

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

Copy the example environment file and match the paths and URLs to your host:

```bash
cp .env.example .env
```

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

> **Local LLM Auth & Presets**: Set `LOCAL_LLM_API_KEY` if your LLM server requires a Bearer token. Endpoints can be switched and tested at runtime under **System &rarr; Agent**.

### Step 3: Configure `docker-compose.yml`

Copy the example Compose file and point the left-hand host volume paths to your local ComfyUI output and models folders:

```bash
cp docker-compose.yml.example docker-compose.yml
```

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

### Step 4: Configure ComfyUI `extra_model_paths.yaml` (For Downloaded Models)

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

### Step 5: Build and Start Couchy

```bash
docker compose up -d --build
```

Open `http://localhost:9980` in your browser (or view logs with `docker compose logs -f comfyui-gallery`).

---

## Global Navigation & Status Center

The sticky top bar spans every workspace:
- **6 Workspaces**: **Gallery**, **Characters**, **Generation Studio**, **LoRAs & Models**, **Workflow**, and **System** (collapsing into a drawer on mobile).
- **Live Status Pill**: Displays live ComfyUI generation percentage, current step progress, active running/queued counts, and brief action toasts.
- **Status & Message Center Dropdown**: Click the status pill to inspect ComfyUI and Local LLM connectivity, the loaded LLM model, and the **Last 10 Messages** log (with one-click **Clear**).

---

## User Guide

### Quick Gen Box & Agent

The **Quick Gen Box** is a collapsible bottom bar accessible from **Gallery**, **Characters**, **LoRAs & Models**, and **Workflow** (toggleable globally under **System &rarr; Quick Gen & Pills**). Click its tab handle to minimize or expand it, and press `Enter` to submit (`Shift+Enter` for a new line).

- **`@Character`, `@LoRA`, `@Model` & `@Preset` Mention Picker**:
  - Type `@` (or click **`+`**) to search **Characters**, **LoRAs**, **Base Models**, and **LoRA Presets** alongside matching reference image prompts.
  - Selections attach color-coded **Pill Badges** above the prompt (blue for characters, amber for LoRAs, green for user-selected Base Models, and distinct custom preset colors such as fuchsia/cyan/orange/lime/pink/purple for **Presets**) that automatically inject LoRAs, weights, trigger words, Base Model overrides, and character workflows on submission.
  - Attaching a **Preset** loads its bundled Base Model (or leaves the system workflow default when none is set) and up to 5 LoRAs at their saved preset default strengths—each LoRA pill remains individually editable or removable for that run.
  - Click any LoRA pill's strength value (e.g., `0.8x`) to adjust it inline (`-10.0` to `+10.0`, or nudge with `↑`/`↓`) for the current generation without changing system defaults. *(Base Models are user-selected only and are never auto-picked by the **Agent**.)*

- **Face Scan (Visual Character Matching on Uploads)**:
  - Toggle the **Face Scan** icon button between **Upload Image** and **Agent** whenever a Local LLM is online (remembered across sessions).
  - When active and no character is attached, pasting, dropping, or uploading an image scans its pixels for faces **before** prompt generation (no ComfyUI metadata required):
    - Compares detected faces against your character roster (using each character's portrait and top-rated confirmed single-face gallery images).
    - If a match is found, Couchy auto-attaches that character before describing the image so character-aware trait omission applies right away; otherwise it notifies you briefly and continues with no character attached.

- **Image-to-Prompt Interrogation (Drag, Paste, or Upload)**:
  - Drag and drop, paste (`Ctrl+V` / `Cmd+V`), or click the **Upload Image** icon to downscale a reference photo to ~1MP and auto-match the closest aspect ratio preset (disabled when the Local LLM is offline).
  - **Vision & Fallback Pipeline**: When a vision-capable model is loaded, Couchy sends the image directly to the LLM for unbiased real-world object and scene descriptions while using local visual tagging strictly as an uncensored nudity/exposure check so explicit exposure details aren't skipped or softened. When a text-only LLM is loaded (or vision fails), Couchy extracts local visual tags first and asks the LLM to write natural prose from them.
  - **Balanced Descriptions, Focus Hints & Scoped Omission**: Descriptions balance action/interaction, prominent props or machinery, setting/lighting/framing, and subject details/exposure. Any text already in the prompt box is treated as a priority hint. When a character is attached (manually or via **Face Scan**), only **hair color and eye color** are omitted—preserving hairstyles, poses, outfits, nudity/exposure, and props.
  - **Optional Inspiration Archiving (`Inspo`)**: When **Save Uploaded Prompt Images (1MP)** is turned **On** in **System**, interrogated uploads are saved and automatically placed as the cyan **`Inspo`** Step 1 tile on the resulting **Series Stack** (excluded from standalone gallery cards and **Stats** totals). Turn it **Off** anytime to interrogate without saving uploads or starting reference stacks.

- **Civitai Image/Post URL Import (Empty Quick Gen Only)**:
  - Paste (`Ctrl+V` / `Cmd+V`) any `civitai.com` or `civitai.red` `/images/<id>` or `/posts/<id>` share URL into an **empty Quick Gen Box** to populate its prompt, closest aspect ratio, and any matching locally installed **Base Model** and up to **5 LoRAs** at their exact weights (any missing models or unavailable fields are omitted gracefully so you can add or swap models right away).
  - **Automatic 1MP Stack Photo (`Save Civitai Import Images (1MP)`)**: When enabled in **System** *(**On** by default)*, Couchy fetches the source photo server-side (skipping videos/non-images gracefully), downscales it to ≤ 1MP JPEG in `data/uploaded`, and silently attaches it as the **`Inspo`** Step 1 tile on the resulting **Series Stack**.

- **Agent (`Agent` Toggle)**:
  - Opens an inline chat drawer inside the **Quick Gen Box** (with a **Clear** button to reset the conversation) and can auto-attach up to 3 relevant non-character `@mention` LoRAs—or 1 matching **Preset**—that have **Agent Descriptions** configured, while respecting manual removals.
  - **Iterative Stack Mode (`x1`)**: Produces a **Proposed Prompt** card with structured scene phrasing that locks earlier details across follow-up turns.
  - **Multi-Shot Set Mode (`x2`–`x8`)**: Given one theme, the **Agent** generates a **Set Concept** card outlining medium, wardrobe plan, lighting, and shot progression. Choose **`Preview Shots (xN)`** to inspect, hand-edit, or **Re-expand** individual shots before submitting, or **`Expand & Submit (xN)`** to queue the **Multi-Shot Set** directly. Batch count resets to `x1` after submission or when reopening from an image or stack.

- **Settings & One-Click Reuse**:
  - Click the settings pill (e.g., `2:3 · 3MP · x1`) to choose aspect ratio (`1:1`, `9:16`, `16:9`, `3:4`, `4:3`, `2:3`, `3:2`), resolution (`0.5–10.0 MP`; targets above `3.0 MP` automatically trigger `4x` ESRGAN upscaling), **Steps** (`4–12`, defaulting to the active workflow's `KSampler` step count and shown on the settings pill only when changed), and batch count (`x1`–`x8`). Uses the attached character's preferred workflow or falls back to the system default.
  - Click **Reuse Prompt** on any gallery card or inside the Inspector to restore its prompt, aspect ratio, character, and LoRAs directly into the **Quick Gen Box**.

---

### Gallery, Filtering & Bulk Curation

- **Views & Live Progress**: Switch between **Grid**, **Masonry**, and **Compact** views with **`SM` / `MD` / `LG`** scaling, page navigation or **Infinite Scroll**, and inline **Pending Ghost Cards** showing live generation progress until finished PNGs arrive.
- **Card Footer & Quick Actions**: Shows **Character Name** (click to filter), **LoRA Pills**, and **Image Details** (`width×height · aspect ratio · Base Model`), plus quick buttons to **Select**, **Rate (`1–5★`)**, **Favorite / Poster**, **Reuse Prompt**, open **Agent**, or **Reject** (with an **Undo** toast).
- **Search, Filters & Presets**:
  - Full-text search across prompts, filenames, Base Models, LoRAs, and visual tags.
  - Multi-facet filters for **Characters** (`Match ALL` / `Match ANY` + *Include suggestions*), **LoRAs** (`Match ALL` / `Match ANY` + **Min / Max Strength**), **Favorites Only**, **Min Rating**, **Checkpoint** *(the Gallery label for a Krea 2 Base Model)*, **Collection**, **Tags**, **Date Range**, **Dependency Status** (`Exact Match`, `Available`, `Incomplete`, `Unknown`), and **Rejected / Archived** modes.
  - **9 Sort Orders**, named **Saved Search Presets**, and **`ZIP (N)`** filtered export.
- **Bulk Toolbar**: Select cards or **`Shift + Click`** ranges to batch-apply **Ratings**, **Favorite**, **Archive**, **Reject**, **Tag**, **Character**, **Collection**, or **Selected ZIP** export.

---

### Image Inspector, Series Stacks & A/B Split Compare

- **Series Stack Hierarchy**:
  - **Series Stack**: Any group of related images kept together as a stack—whether generated at the same time, refined across turns, upscaled, or paired with a source **`Inspo`** upload.
  - **Iterative Stack**: Working with the **Agent** to refine a single photo concept across multiple turns (plus any upscales or **Branch #N** offshoots). Continuing from the latest step overlays live `%` progress on that stack card and appends in place; branching from an earlier step splits into a new **Iterative Stack**.
  - **Multi-Shot Set**: Giving the **Agent** (or **Quick Gen Box** / **Generation Studio**) one idea or prompt to generate multiple distinct shots (`x2`–`x8`) together. Grid cards disable whole-set **Agent** iteration; open the Inspector or **Series Mini Gallery (`S`)** and click **Iterate / Iterate #N** on a single shot to start a new **Iterative Stack** from it.
  - Stacks started from an archived upload display **`Inspo`** as Step 1. Only one step per stack can be hearted at a time, serving as that **Series Stack**'s gallery **Poster Image**.
- **Full-Screen Inspector, Loupe & Quick Preset Capture**:
  - Toggle fullscreen (`Space`) or **Loupe (`L`)** (`2×`, `4×`, `1:1 Native`, click-to-pin).
  - Click the **Create Preset** bookmark button between **Favorite** and **Delete/Reject** in the Inspector header to save the active image's Base Model and up to 5 LoRAs (including character LoRAs and exact strengths) as a reusable preset auto-named `user0`, `user1`, etc. (reusing the lowest open number).
  - The right sidebar surfaces **Assigned Character**, **Workflow & Reproducibility** (`Run Workflow` and inline `4x` ESRGAN `Upscale`), **Series Stack** strip, copyable prompts, generation parameters, LoRA weights, visual tags, custom tags, collections, and notes.
- **A/B Split Compare**:
  - Click **Compare** in the Inspector header for **Side-by-Side** or draggable **Overlay Wipe** comparison (`Fit` vs. `100% Native`), synchronized **Dual / Split `[A | B]` Loupe (`L`)**, a filterable **Compare with...** stack picker, per-slot step switching, **Swap**, and a collapsible **Diff Drawer** highlighting prompt, parameter, and LoRA differences with per-slot curation actions.

---

### Characters, Portrait Framing & Assisted Identification

- **Roster & Merge**: Browse character cards with counts, linked LoRAs, aliases, and average ratings. **Create Character** profiles or non-destructively **Merge Characters** (combining links, aliases, LoRAs, workflows, tags, collections, and optionally portrait/crop metadata).
- **Display-Only Portrait Framing**: Click the pencil icon on a profile portrait to adjust focal point (`0%–100%`) and zoom (`1.00×–3.00×`) with live `1:1 Profile`, `4:3 Card`, and `Badge` previews—saved purely as display metadata.
- **Adaptive Portrait Analysis (`Analyze Portrait`)**: Scans a character's portrait (via Vision LLM, or local visual tagging + Text LLM fallback) to draft a **Physical Description (Agent Reference Guide)** that informs the **Agent** without overriding requested outfits, hairstyles, or poses.
- **LoRAs, Spotlight & Favorite Addons**: Manage linked LoRAs and trigger words (with inline `+ Link` for new profiles). View **Highest-Rated Images** (`5★` or `4★+`) alongside **Favorite Addons** (**Base Models**, **Addon LoRAs**, and **Friends**, sorted by **Most Used** or **Top Rated**) and click **New Image** to launch the **Quick Gen Box** pre-loaded with up to 5 total LoRAs.
- **Assisted Identification (Metadata Matching) & First-Photo Portrait Lock**: Unlike **Face Scan** in the **Quick Gen Box**, **Assisted Identification** scans *metadata* on rendered gallery images (checking LoRAs, prompt names/aliases, and workflows) to queue **Pending Suggestions** for bulk **Confirm / Reject** review. The **first** confirmed non-reference photo saved under a character automatically locks in as its portrait until changed via **Set Portrait**.

---

### Generation Studio

- **Batch Workspace**: Pick a character (auto-loading LoRAs & triggers), stack additional LoRAs with custom strengths, override the Krea 2 **Base Model**, choose an aspect ratio, set target **Megapixels (`0.5–10.0 MP`; `> 3.0 MP` triggers `4x` ESRGAN upscaling)**, and configure batch count.
- **Single Prompt (Verbatim) vs. Photo Set Theme (Agent)**: Interpolate `{character}`, `{lora}`, and `{theme}` across unique seeds, or supply an optional **Visual Style Foundation** + **Photo Set Theme Description** for the **Agent** to expand into a **Multi-Shot Set**.
- **Templates & Queue Preview**: Save/load reusable **Prompt Templates**, hand-edit or reset slots in **Outgoing Prompt Queue Preview**, and monitor **Batch Queue History**.

---

### LoRAs, Base Models, Presets & Downloader

Open **LoRAs & Models** for four integrated tabs:

- **LoRA Explorer & Detail Inspector**:
  - Search by name, filename, base model, trigger word, SHA-256, or character; filter by category (`character`, `style`, `clothing`, `concept`, `pose`, `object`, `unclassified`); switch between **Grid / List**, **Hide / Unhide (`Show Hidden (N)`)**, inline **`@Mention`** checkboxes, and `@nicknames`.
  - Click any LoRA for **LoRA Detail View** (cached previews, recommended vs. default strengths, triggers, **Agent Description**, **User Notes**, Civitai/HF descriptions, linked characters, **Usage Impact Report**, and associated images).
- **Base Models Explorer**:
  - Indexes both your ComfyUI models folder and downloads folder, switching between **Base Models (Krea 2)** *(default)* and **Support Models (CLIP / VAE / Upscalers / Other)** with Grid/List views, Hide/Unhide, `@Mention` toggles, and **Base Model Detail View**.
- **Presets (`LoRA Presets`)**:
  - Bundle **1 optional Base Model** (falls back to your system workflow default when omitted) + **up to 5 LoRAs** with custom per-LoRA default strengths into a single `@mention`-able preset.
  - Click **Create Preset** (or click any saved preset pill at the top to edit) to enter click-to-select mode across read-only Base Model and LoRA cards, manage items in the 6-slot preview strip (`×` to remove, inline strength controls), and configure **Name**, **Pill Nickname**, **User Description**, **Agent Description**, and a dedicated **Pill Color** (`fuchsia`, `cyan`, `orange`, `lime`, `pink`, `purple`).
  - Integrates with both **Quick Gen Box** `@mentions` (loading default strengths while keeping pills editable) and the **Agent** (via **Agent Description**).
- **Metadata Enrichment (`Fetch Details`)**: Queries **Civitai first** (`.com` / `.red`) and **Hugging Face second** to import model cards, base-model tags, download URLs, and preview thumbnails.
- **Civitai & Hugging Face Downloader**:
  - **Authentication**: Add `CIVITAI_API_KEY` or `HF_API_TOKEN` in `.env` for gated/mature weights.
  - **Smart Inputs**: Supports keywords, `civitai.com` / `civitai.red` model URLs, **Civitai image/post share URLs (Krea 2 only)**, SHA-256 or AutoV2 hashes, Hugging Face `owner/repo` IDs/URLs, and direct weight links.
  - **Civitai Image Multi-Model Resolution & Batch Download All**: Paste a `civitai.com` / `civitai.red` `/images/<id>` or `/posts/<id>` share URL and click **Search Models** to resolve all linked **Krea 2** LoRAs and Base Models into individual cards *(images/models from other architectures such as SDXL, Pony, or Flux are rejected or skipped with an explicit notice that only Krea 2 images are supported)*. Use per-card **Batch** checkboxes, **Select All**, and **Download All** to queue multiple missing models sequentially.
  - **Link Healing, Versions & Early Access**: Mature/delisted Civitai entries automatically retry `civitai.red` (**Heal Civitai Links** repairs existing records). Switch versions in-card (`✓ Installed`, `⏳ Early Access`), detect already-installed weights, and **Schedule Download** for Early Access unlocks.
  - **`@Mention` & Character Automation on Download**: Set `@mention` nickname and activation right on LoRA download, or enable automatic character creation + headshot generation once ComfyUI detects the new file.

---

### Workflows & Structured Node Editor

*Compatibility note: Workflow compilation and inline `4x` ESRGAN upscaling target **Krea 2** ComfyUI API workflows.*

- **Import & Node Mapping**: Import API or visual workflow JSONs, set a **System Default**, and map prompt, model, LoRA, resolution, and seed slots.
- **Structured Editor vs. Raw JSON**: Search nodes by title, ID, or class type to edit parameters (`Prompt`, `Sampler`, `Steps`, `CFG`, `Resolution`, `Seed`) and interactive `rgthree` **Power Lora Loader** slots in structured controls, or switch to **Raw JSON** with live validation.
- **Validation, Test Runs & Export**: Checks referenced model availability (`Exact Match`, `Available`, `Missing`), runs live **Run Workflow** tests tracked in **Workflow Reproduction History**, and exports cleaned API JSON.

---

### System Administration & In-App Help

The **System** workspace includes the top **Save Uploaded Prompt Images (1MP)** and **Save Civitai Import Images (1MP)** toggles (controlling **Quick Gen Box** `Inspo` Step 1 archiving) and 8 tabs:

1. **Search**: Enable/disable local visual keyword tagging, switch **CPU vs. NVIDIA GPU**, adjust confidence threshold, and **Pause / Resume**, **Scan Unindexed**, or **Rescan All**.
2. **Quick Gen & Pills**: Toggle the **Quick Gen Box**, **Gallery Pill Colors**, and per-type `@mention` insertion rules (Characters, Base Models, LoRAs).
3. **Stats**: Adjustable **Day / Week / Month / Year** generation activity charts (excluding uploaded `Inspo` references), **Storage Usage** breakdowns for ComfyUI assets and local Couchy storage, and **Library Usage & Random Roll Rankings** across **Characters**, **Base Models**, and **LoRAs by Type** (showing totals, `#1` leaders, roll eligibility, usage vs. roll-score sorting, and baseline roll odds).
4. **Agent**: Choose Local LLM endpoint presets, test **Vision vs. Text-Only** capabilities, and edit or reset the **Primary Agent System Prompt** and **Batch Expansion Instructions** (**Editorial Variety**, **Storyboard Arc**, **Lookbook Angles**).
5. **ComfyUI**: Test your ComfyUI connection, inspect active paths, and enable **Auto-Clean Copied Downloads** (safely removes duplicate files from Couchy's downloads folder once verified identical inside your read-only ComfyUI models folder).
6. **Database**: Create integrity-verified SQLite backups and export/import portable JSON annotation backups.
7. **Metadata**: Run **Incremental Scan** or **Rebuild Machine Metadata** (re-parses embedded PNG metadata while preserving all user annotations) and review **Scan History**.
8. **Help**: Live searchable `README.md` viewer with section jumps, reload, code-block copy buttons, and a conditional **Ask the Docs** sidebar when the Local LLM is online.

---

## Keyboard Shortcuts & Hotkeys

Single-key shortcuts pause inside text inputs/selects and inside A/B Split Compare (except `Esc`).

| Context | Key | Action |
|---|---|---|
| **Inspector** | `1` – `5` / `0` | Rate active stack step (`1–5★`) / clear rating |
| **Inspector** | `F` | Toggle Favorite / exclusive stack Poster |
| **Inspector** | `X` / `Delete` | Reject & advance (with floating **Undo**) |
| **Inspector** | `L` / `S` / `Space` | Toggle Loupe / Series Mini Gallery / Fullscreen |
| **Inspector** | `←` `→` / `[` `]` | Previous/next gallery card / previous/next stack step |
| **Inspector** | `?` / `Esc` | Shortcuts help / unwind modals & overlays layer-by-layer |
| **Gallery** | `Shift + Click` / `Esc` | Select contiguous range / clear selection or close nav menus |
| **Quick Gen Box** | `Enter` / `Shift+Enter` | Submit prompt or **Agent** turn / newline |
| **Quick Gen Box** | `↑` `↓` / `Enter` `Tab` / `Esc` | Navigate, pick, or close `@Mention` popover |
| **Quick Gen Box** | `Ctrl+V` / `Cmd+V` | Paste clipboard image for 1MP interrogation, or paste a Civitai image/post URL into an empty box |

---

## Configuration & Technical Reference

### Environment Variables

| Variable | Default in Container | Description |
|---|---|---|
| `PORT` | `8080` | Internal HTTP server port |
| `COMFYUI_URL` | `http://comfyui:8188` | ComfyUI HTTP endpoint (`http://host.docker.internal:8188` on host) |
| `LOCAL_LLM_URL` | `http://host.docker.internal:11434/v1` | OpenAI-compatible `/v1` endpoint (`LM_STUDIO_URL` & `LLM_BASE_URL` aliases supported) |
| `LOCAL_LLM_API_KEY` | *(Optional)* | Server-side Bearer token for authenticated LLM endpoints (`LLM_API_KEY` also supported) |
| `COMFYUI_OUTPUT_DIR`| `/data/output` | Read-only mount of ComfyUI output directory |
| `COMFYUI_MODELS_DIR`| `/data/models` | Read-only mount of ComfyUI models directory |
| `DATABASE_PATH` | `/app/data/gallery.db` | Persistent SQLite database path |
| `THUMBNAIL_PATH` | `/data/thumbnails` | Cached WebP thumbnails directory |
| `BACKUP_PATH` | `/app/data/backups` | SQLite backup snapshots directory |
| `LOGS_DIR` | `/app/data/logs` | Rotating server logs (`couchy.log`, 5 MB &times; 2) |
| `DOWNLOADS_DIR` | `/downloads` | Target directory for downloaded models |
| `CIVITAI_API_KEY` | *(Optional)* | Civitai API token for search, metadata, and authenticated downloads |
| `HF_API_TOKEN` | *(Optional)* | Hugging Face token for gated downloads |

### Customizing Agent Prompts

If you edit prompts under **System &rarr; Agent**, keep these built-in contracts in mind:
- **Primary Agent System Prompt**: Sent on every **Agent** turn (`x1` and `x2`–`x8`) and every batch expansion. Expects `<proposed_prompt>` in `x1` mode, `<proposed_concept>` in `x2`–`x8` mode, and optional `<selected_loras>` / `<selected_preset>` tags for auto-attaching non-character `@mention` LoRAs or a saved Preset.
- **Batch Expansion Instructions**: Appended after the Primary prompt when expanding **Multi-Shot Set** concepts or Generation Studio **Photo Set Themes** into `{count}` `<shot_1>...</shot_{count}>` tags (`4096` max tokens, `90s` timeout).
- **Automatic Runtime Context**: Automatically injects character bio/physical guides, attached LoRA descriptions, available `@mention` LoRAs and Presets, and long-thread anchor recall beyond the 10-message chat window.

### Technical Architecture

Couchy runs as a single Node.js service (React + TypeScript + Tailwind CSS frontend; Express + TypeScript backend with **SQLite WAL** via `better-sqlite3`):
- **ComfyUI Compilation & Poller**: Connects to ComfyUI REST + `/ws` to track progress and index completed PNGs. Compiles Krea 2 API graphs (`#49` resolution selector, `#50` Power Lora Loader, `#30_27` trigger concatenation, `#30_3` KSampler seed & Quick Gen steps override, and inline `4x` ESRGAN `#51`–`#54` upscaling).
- **Local ONNX Pipelines (`onnxruntime-node`)**:
  - **Visual Keyword Tagger**: `wd-vit-tagger-v3` (`data/local_models/wd-vit-tagger-v3`, `0.22` general / `0.18` compound thresholds for text fallback; also serves as an uncensored nudity/exposure audit during Vision interrogation).
  - **Face Scan**: InsightFace **SCRFD (`det_10g.onnx`)** 5-point landmark alignment + **ArcFace (`w600k_r50.onnx`)** 512-D embeddings (`data/local_models/insightface-buffalo-l`, cached in `character_face_embeddings` with `0.38` default cosine threshold).
- **Local LLM Proxy**: Server-side `/v1/models` and `/v1/chat/completions` client (plus LM Studio `/api/v0/models` vision detection) with `90s` interrogation/expansion timeouts and ranked `README.md` retrieval for **Ask the Docs**.
- **Core SQLite Domain Groups**:
  - *Images & Metadata*: `images`, `image_metadata`, `image_loras`, `image_models`, `image_visual_tags`, `image_workflows`
  - *Series & Generations*: `image_series`, `image_series_items`, `generation_batches`, `generation_items`, `reproduction_jobs`
  - *Curation & Characters*: `ratings`, `tags`, `image_tags`, `collections`, `collection_images`, `saved_searches`, `characters`, `character_aliases`, `character_loras`, `character_workflows`, `character_face_embeddings`, `image_characters`
  - *Models & System*: `models`, `lora_presets`, `lora_preset_items`, `download_jobs`, `downloaded_model_copies`, `pending_lora_character_tasks`, `workflows`, `workflow_mappings`, `prompt_templates`, `lm_studio_settings`, `lm_studio_prompt_templates`, `app_settings`, `scan_jobs`, `schema_migrations`

### Backup, Restore & Maintenance

1. **Database Snapshots**: Create integrity-checked (`PRAGMA integrity_check`) SQLite snapshots under **System &rarr; Database**.
2. **Annotation Export**: Export/import portable JSON backups of all ratings, favorites, rejections, notes, tags, collections, characters, and portrait crops.
3. **Automatic Migrations**: Updating via `git pull && docker compose up -d --build` applies schema migrations automatically on startup without touching existing records.

---

## License

MIT License. See [LICENSE](LICENSE) for details.
