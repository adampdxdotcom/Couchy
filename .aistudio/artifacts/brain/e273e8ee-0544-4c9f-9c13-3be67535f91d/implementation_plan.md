# Opt-In Visual Keyword Tagging & Search Indexing (WD14 ONNX)

Adds an opt-in, lightweight vision tagging engine (WD14 v3 ONNX) that lazily downloads on user activation into `data/local_models`, extracts searchable visual keywords from images in the background (both retroactively across large galleries and automatically after each ComfyUI run), and surfaces those keywords in the Image Detail Inspector and Gallery search.

## User Review & Critical Decisions

> [!IMPORTANT]
> Review the confirmed architectural and UX decisions below before proceeding to implementation:

- **Opt-In Lazy Model Download (`data/local_models`)**: Nothing is downloaded at container startup. The ~360 MB ONNX vision tagger (`SmilingWolf/wd-vit-tagger-v3` `model.onnx` + `selected_tags.csv`) is downloaded only when the user explicitly toggles **Visual Keyword Tagging** on in the System settings view, and is stored inside writable `/app/data/local_models` (with local fallback `data/local_models`) to avoid any conflict or read-only permission issues with `/data/models`.
- **Large Gallery Warning & Resumable Background Queue**: A clear warning banner beside the toggle informs users with thousands or tens of thousands of images that the initial download and background scan may take 15–60+ minutes. Indexing runs non-blockingly against fast WebP thumbnails, persists progress per image in SQLite so it safely resumes across restarts, and can be paused or resumed anytime.
- **Unified Search & Inspector Visibility**: Extracted visual keywords are stored separately from user tags and generation prompts, included automatically in Gallery search queries, and displayed in the Image Detail Inspector when the feature is enabled (with click-to-search and single-click removal of false-positive tags).
- **Optional GPU Acceleration**: Runs out-of-the-box on CPU via ONNX Runtime with zero extra installs, while supporting optional NVIDIA GPU passthrough in Docker Compose for faster batch indexing.

---

## 1. Overview & Core Concept

- **What It Does**: Bridges the gap between *what the prompt asked for* (which often hides visual traits inside LoRA trigger words like `xcarax` or `snofs_krea`) and *what is actually visible in the rendered image* by running a fast local vision tagger that extracts concrete visual keywords (e.g., `red hair`, `glasses`, `leather jacket`, `neon lighting`, `outdoors`, `portrait`).
- **Target Audience / Persona**: Local ComfyUI creators managing 2,000 to 50,000+ generated images who rely heavily on custom LoRAs and want instant keyword search across their entire visual library without installing custom ComfyUI nodes.
- **Key Value**: Makes every image searchable by its actual visual content—including LoRA-driven traits, happy accidents, and imported images—while keeping container startup light and never competing with ComfyUI for VRAM by default.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Enabling Visual Keyword Tagging (System & Backup View)**:
   - User navigates to the **System** tab and locates the **Visual Keyword Tagging (Search Indexer)** panel.
   - An explicit notice warns: *"Enabling this feature downloads a ~360 MB lightweight vision model to `data/local_models` and begins indexing your gallery in the background. For large libraries (2,000–20,000+ images), the initial scan can take 15–60+ minutes. You can continue using the app normally while indexing runs."*
   - User flips the toggle **On**.
   - The panel transitions through clear states:
     1. **Downloading Model**: Progress bar showing MB downloaded / total size (`tabular-nums`) as `model.onnx` and `selected_tags.csv` stream into `data/local_models`.
     2. **Background Indexing**: Live progress bar (`1,420 / 2,000 images indexed · 71%`) with **Pause / Resume** and **Scan Unindexed** controls, plus a confidence threshold slider (default `0.35`).
2. **Automatic Post-Generation Tagging**:
   - When the toggle is enabled and ComfyUI finishes a run, right after the new image is ingested and linked to any `@character` mention, the tagger runs on the new image's thumbnail in ~250ms and attaches its visual keywords in the background.
3. **Inspecting & Searching Visual Keywords (Image Detail Drawer & Gallery)**:
   - When viewing an image in the **Image Detail Inspector** (and the feature is enabled), a dedicated **Visual Keywords (System)** section displays the detected keywords alongside a **Re-tag Image** button.
   - Clicking any keyword filters the Gallery immediately by that term.
   - Clicking the `×` affordance on a keyword removes an inaccurate tag from that image so search results stay clean.
   - Typing any keyword into the main Gallery search bar matches across Positive Prompts, Character Names, User Tags, and System Visual Keywords.

### Visual Identity & Theme
- **Aesthetic Direction**: Utilitarian dark-slate studio console matching the existing zinc/indigo design language (`#09090b` canvas, `#18181b` structural surfaces, `#6366f1` high-intent interactive accents, `#f59e0b` semantic warning callouts).
- **Typography & Hierarchy**: Crisp geometric sans headings paired with monospace tabular figures (`font-mono tabular-nums`) for all download counters, image indexing progress (`1,420 / 2,000`), and confidence thresholds so progress metrics never jitter during live updates.
- **Component Styling & Layout**: Single-elevation surface cards with 1px hairline borders (`border-zinc-800`), interactive filter buttons for clickable search keywords in the inspector, and unboxed typographic metadata in summary rows.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Store Model in `data/local_models` Instead of `data/models`**
  - *Chosen Approach*: Resolve the tagger directory inside `/app/data/local_models` (falling back to workspace `data/local_models`).
  - *Why*: `/data/models` is mounted read-only (`:ro`) from the user's ComfyUI installation and is scanned by the Model Inventory service. Using `data/local_models` inside the writable app data volume guarantees write permissions, persists across container rebuilds, and prevents internal ONNX weights from polluting ComfyUI checkpoint/LoRA dropdowns.
- **Decision 2: Strict On-Demand Download on Toggle Activation**
  - *Chosen Approach*: Do not bundle or auto-fetch weights on server boot. Only download when the user enables the setting.
  - *Why*: Keeps initial Docker startup instant and respects disk/bandwidth for users who don't need visual tagging.
- **Decision 3: Scan 448×448 Preprocessed Tensors from WebP Thumbnails**
  - *Chosen Approach*: Decode from the existing WebP thumbnail (falling back to the source image only if a thumbnail doesn't exist yet) and resize to `448×448` BGR float32 tensors via `sharp`.
  - *Why*: Reading a 40 KB WebP thumbnail instead of a 15 MB 4K PNG reduces disk I/O and image decode overhead by ~10× across 10,000+ images, with zero loss in accuracy since WD14 natively operates at `448×448`.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                           CLIENT UI (React SPA)                            │
│                                                                            │
│  ┌──────────────────────────┐  ┌─────────────────────┐  ┌───────────────┐  │
│  │   SystemAndBackupView    │  │ ImageInspectorDrawer│  │GalleryFilter  │  │
│  │ - Enable Toggle + Notice │  │ - Visual Keywords   │  │ - Unified     │  │
│  │ - Model Download Progress│  │   Interactive Chips │  │   Search Bar  │  │
│  │ - Batch Scan Progress    │  │ - Click-to-Search   │  │   (Prompts +  │  │
│  │ - Pause / Resume / Threshold│ - Dismiss (×) / Retag│ │   Visual Tags)│  │
│  └────────────┬─────────────┘  └──────────┬──────────┘  └───────┬───────┘  │
└───────────────┼───────────────────────────┼─────────────────────┼──────────┘
                │ REST (/api/tagger/*)      │                     │
┌───────────────▼───────────────────────────▼─────────────────────▼──────────┐
│                         EXPRESS SERVER & SERVICES                          │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                     Visual Tagger Service (ONNX)                     │  │
│  │  1. Lazy Downloader -> HuggingFace (wd-vit-tagger-v3 + tags CSV)     │  │
│  │  2. Tensor Preprocessor (sharp 448x448 BGR) -> onnxruntime-node      │  │
│  │  3. Background Queue Worker (Throttled yield loop + Pause/Resume)    │  │
│  └────────────┬───────────────────────────┬─────────────────────────────┘  │
│               │                           │                                │
│  ┌────────────▼─────────────┐  ┌──────────▼─────────────────────────────┐  │
│  │  Writable Local Storage  │  │         SQLite Database (WAL)          │  │
│  │  /app/data/local_models/ │  │ - app_settings (visual_tagger_enabled) │  │
│  │  - model.onnx (~360MB)   │  │ - image_visual_tags (hash, tag, score) │  │
│  │  - selected_tags.csv     │  │ - images (visual_tags_scanned_at)      │  │
│  └──────────────────────────┘  └────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State
- **Database Migration (Version 7 — `visual_keyword_tagger_schema`)**:
  - `images` table addition: `visual_tags_scanned_at TEXT` (tracks whether an image has been processed by the visual tagger; `NULL` means pending scan, allowing instant resumability across 20,000+ images).
  - `image_visual_tags` table:
    - `image_content_hash TEXT NOT NULL`
    - `image_id INTEGER REFERENCES images(id) ON DELETE CASCADE`
    - `tag TEXT NOT NULL COLLATE NOCASE`
    - `confidence REAL NOT NULL DEFAULT 1.0`
    - `PRIMARY KEY (image_content_hash, tag)` with index on `tag` and `image_content_hash` so keywords survive file moves/rescans just like user tags.
  - `app_settings` keys:
    - `visual_tagger_enabled`: `'true' | 'false'` (default `'false'`)
    - `visual_tagger_threshold`: `'0.35'` (configurable confidence cutoff)
    - `visual_tagger_device`: `'cpu' | 'gpu'` (default `'cpu'`)

### Interactive Component & State Mapping
- **Toggle & Download Lifecycle (`/api/tagger/status`, `/api/tagger/toggle`)**:
  - Turning the toggle **On** persists `visual_tagger_enabled = 'true'`. If `data/local_models/model.onnx` or `selected_tags.csv` is missing, the downloader streams them atomically (via `.part` temporary files so interrupted downloads never leave corrupt weights) and reports real-time byte progress.
  - Once model files are verified, the background queue automatically starts scanning any image where `visual_tags_scanned_at IS NULL`.
  - Turning the toggle **Off** immediately halts any active background scan and hides system visual keywords in the UI while preserving already-indexed rows in SQLite.
- **Single-Image & Post-ComfyUI Hook**:
  - When `comfyService` ingests a newly completed ComfyUI generation and `visual_tagger_enabled` is true, it triggers `tagSingleImage(imageId)` asynchronously so the new image receives its visual keywords within milliseconds.
- **Inspector & Search Integration**:
  - Gallery search query (`q`) in `GET /api/images` expands to match `EXISTS (SELECT 1 FROM image_visual_tags vt WHERE vt.image_content_hash = i.content_hash AND vt.tag LIKE ?)` when visual tagging is enabled.
  - `DELETE /api/images/:id/visual-tags/:tag` removes a specific false-positive visual keyword from an image; `POST /api/images/:id/visual-tags/rescan` re-runs the tagger on that single image.
