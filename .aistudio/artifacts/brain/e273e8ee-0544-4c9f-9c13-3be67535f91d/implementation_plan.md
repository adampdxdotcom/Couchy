# ComfyUI Gallery — Master Architectural Blueprint & Implementation Plan

ComfyUI Gallery is a local-first, self-hosted AI image library, metadata and workflow explorer, first-class character and entity manager, model dependency auditor, and workflow reproduction platform engineered to index, organize, and reproduce generations from a mounted ComfyUI output directory without ever modifying or moving original image files.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural decisions govern the unified implementation:

- **Confirmed Decision 1 — Single Unified Node.js/TypeScript + Express + SQLite Backend**: Both the live preview environment and the final self-hosted Docker Compose deployment run the **exact same** modular Node.js/TypeScript + Express + SQLite (`better-sqlite3`) codebase, binary PNG `tEXt`/`iTXt`/`zTXt` metadata parser, `sharp` WebP thumbnail engine, and background filesystem scanner. The separate Python/FastAPI stack is completely eliminated so there is zero code duplication and 100% behavioral parity between preview and production Docker containers.
- **Confirmed Decision 2 — Strict Mounted Directory Indexing (No Sample Seeding or Uploads)**: The application starts with an empty mounted ComfyUI output directory (`COMFYUI_OUTPUT_DIR`, defaulting to `/data/output` in Docker or a configurable local directory) and automatically scans, indexes, and continuously monitors the filesystem for added, modified, moved, or deleted images—with no synthetic sample seeding or manual upload widgets.
- **Confirmed Decision 3 — First-Class Character Organization & Entity Management**: Characters are implemented as independent first-class entities from the initial SQLite schema migration, supporting many-to-many relationships with LoRAs (classified by semantic type), multi-character images, workflows, collections, tags, aliases, non-destructive profile merging, and deterministic assisted character identification suggestions.
- **Confirmed Decision 4 — Comprehensive Full-Scope Delivery**: Upon approval of this plan, all core phases will be delivered in a streamlined, modular codebase with small, focused files and concise comments.

---

## 1. Overview & Core Concept

- **What It Does**: Automatically indexes images from a read-only ComfyUI output directory, extracts embedded generation parameters and both visual (`workflow`) and API (`prompt`) JSON graphs, maps every Checkpoint, VAE, and multi-LoRA node with explicit provenance confidence, organizes generations around **First-Class Character Profiles** (supporting multi-character images, outfit/variant LoRAs, prompt-based character appearances, and assisted character suggestions), provides non-destructive virtual organization (ratings, favorites, rejections, tags, collections, notes, saved searches), audits model availability against ComfyUI and local model mounts, downloads missing models from Civitai and Hugging Face with SHA-256 verification, and reproduces historical workflows directly through ComfyUI.
- **Target Audience / Persona**: Self-hosted AI artists, character designers, technical pipeline engineers, and prompt researchers managing thousands to tens of thousands of ComfyUI generations who require deterministic workflow reproducibility, multi-character roster organization, and strict file immutability.
- **Key Value**: Unifies passive image browsing, structured character/entity management, and active ComfyUI workflow engineering in a single cohesive TypeScript full-stack codebase—preserving every historical generation graph, preventing broken workflows through hash-verified dependency tracking, and keeping user annotations completely decoupled from machine-derived metadata so full rescans never erase human curation.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Zero-State & Live Directory Indexing**:
   - On launch with an empty mounted ComfyUI output directory, the gallery displays a clear empty state showing the active watched mount path, scanner status, last scan timestamp, and a **Scan Directory** trigger alongside quick access to ComfyUI and mount path settings.
   - As ComfyUI writes new PNG, JPEG, or WebP files into the mounted output folder, the background filesystem watcher computes SHA-256 content hashes (giving every image a filename-independent identity), generates asynchronous WebP thumbnails via `sharp`, parses PNG `tEXt`/`iTXt`/`zTXt` chunks, runs the non-destructive **Assisted Character Identification** pass, and streams progress into the header scanner indicator.
2. **Gallery Exploration, Bulk Actions & Virtual Organization**:
   - Users switch seamlessly between **Masonry**, **Standard Grid**, and **Compact Grid** layouts with adjustable thumbnail density, keyboard navigation (`Arrow` keys, `Space`/`Enter` for fullscreen viewer, `1`–`5` for star rating, `F` for favorite, `X` for reject), and nine sorting modes (Newest, Oldest, Highest Rated, Lowest Rated, Filename, File Size, Checkpoint, Most-Used LoRA, Recently Favorited).
   - Multi-select mode enables batch star rating, favorite/archive toggling, bulk tagging, bulk collection assignment, **bulk character assignment**, and unaltered original-file ZIP export.
3. **Character Explorer, Profile Management & Assisted Suggestions**:
   - The dedicated **Characters** workspace presents portrait cards displaying each character's preferred portrait thumbnail, primary name, aliases, confirmed image count, pending suggestion count, linked LoRAs (with outfit/appearance role labels), and average image rating.
   - Users can create, edit, and **merge** character profiles (transactional merge moves all aliases, image links, LoRA links, workflow links, tags, and collections from the source character into the target character and concatenates user notes without losing a single historical record).
   - Inside a Character Profile, users browse confirmed images (including multi-character group scenes), review a dedicated **Suggested Matches Queue** (with one-click **Confirm**, **Reject**, or **Reassign** actions showing *why* the image was suggested—e.g., `"Linked LoRA: elena_cyber_outfit_v2.safetensors"` or `"Prompt Alias Match: 'Lady Elena'"`), manage associated LoRAs, workflows, and character-specific collections, and view generation timeline statistics (first/latest generation dates and highest-rated works).
4. **LoRA Explorer & Taxonomy Classification**:
   - Every LoRA in the **LoRA Explorer** can be classified by semantic type (`character`, `style`, `clothing`, `concept`, `pose`, `object`, `other`)—never assuming every LoRA is a character—and manually linked to or unlinked from one or more Character Profiles (with an optional appearance/outfit label such as `"Default"`, `"Winter Armor"`, or `"Casual"`).
   - Selecting multiple LoRAs supports toggling between **Match ALL (AND)** and **Match ANY (OR)** combined with character filters, strength range sliders, checkpoint filters, rating thresholds, date bounds, and boolean query expressions (`AND`, `OR`, `NOT`).
5. **Inspection, Provenance & Workflow Reproduction**:
   - Clicking an image opens the **Split Inspector & Lightbox**, displaying the full-resolution image alongside a structured metadata panel: assigned Characters (plus inline Accept/Reject controls for any pending character suggestions), Positive/Negative prompts with one-click copy, tabular generation parameters, Checkpoint/VAE cards, extracted LoRA chain with separate Model and CLIP strengths, and **Metadata Provenance Indicators**.
   - Clicking **Reproduce Workflow** runs pre-flight validation: converts visual workflow graphs to API format where supported, cross-checks required models and custom nodes against the live ComfyUI instance and filesystem inventory, displays a transparent **Reproduction Summary Modal** (`Exact match`, `Available`, `Incomplete`, or `Unknown`), and submits the job to ComfyUI with live execution tracking.
6. **Missing Dependencies, Model Manager & Database Backup**:
   - The **Models & Deps** workspace inventories all installed Checkpoints, LoRAs, VAEs, ControlNets, Upscalers, Embeddings, CLIP, and Diffusion models, aggregates missing dependencies by impact, and searches **Civitai** and **Hugging Face** for confirmed server-side downloads with SHA-256 verification.
   - The **Workflows & System** workspace houses the independent **Workflow Library** (where workflows persist independently of images and can be linked to characters) and the **Database Backup & Restore Console** (full SQLite backup plus independent JSON export/restore of all user annotations, including character profiles, aliases, and confirmed/rejected character links).

### Visual Identity & Theme

- **Aesthetic Direction**: High-craft dark-mode technical studio & photography darkroom interface inspired by Capture One and Linear—prioritizing image fidelity, zero visual clutter, and dense scannable telemetry.
- **Color Palette & Mood (60-30-10 Discipline)**:
  - **60% Dominant Neutral Canvas**: Deep carbon slate (`#090A0F` / `bg-zinc-950`) so generated artwork color accuracy is never distorted by surrounding UI chrome.
  - **30% Structural Surfaces**: Elevated obsidian panels (`#12141C` / `bg-zinc-900`) with crisp 1px hairline borders (`border-zinc-800/80`) and muted zinc typography (`text-zinc-400`).
  - **10% Focal & Semantic Accents**: Electric indigo/cobalt (`#4F46E5` / `indigo-500`) for primary actions and active selection rings; semantic status pairings (always icon + text label, never color alone): Emerald (`#10B981`) for `Exact match` / `Confirmed`, Sky (`#0EA5E9`) for `Available`, Amber (`#F59E0B`) for `Incomplete` / `Suggested Match`, and Rose (`#F43F5E`) for errors or missing critical assets.
- **Typography & Hierarchy (2+1 Font Rule)**:
  - **Display & Workspace Headers**: `Plus Jakarta Sans` (SemiBold 600, tight tracking) for crisp section headers and navigation.
  - **Body & Prompt Prose**: `DM Sans` (Regular 400 / Medium 500) for comfortable reading of prompts, character descriptions, and notes.
  - **Technical Parameters & Hashes**: `JetBrains Mono` with `tabular-nums` strictly enforced for seeds, steps, CFG scales, dimensions, SHA-256 hashes, LoRA weights, and file sizes.
- **Component Styling & Top Bar Contract**:
  - **Top Bar Contract**: Single-row, three-zone header separated by `gap-8`:
    1. **Brand Zone**: Single-line wordmark `ComfyUI Gallery`.
    2. **Navigation Zone**: 5 concise single-line links (`Gallery`, `Characters`, `LoRAs & Models`, `Workflows`, `System & Backup`).
    3. **Action Zone**: Primary `Scan Directory` button.
  - **Zero-Pill Metadata**: Static metadata on image, character, and LoRA cards renders as clean unboxed inline text separated by `·` bullets. Interactive filter controls and suggestion confirmation buttons use structured button affordances.

---

## 3. Unified Architecture & Character Organization Design

### 3.1 Single Unified Node.js/TypeScript Stack (Zero Duplicate Backend Code)
The application uses a single, clean technology stack across development, preview, and self-hosted Docker production:
- **Runtime & Server**: Node.js 22 + Express (`server.ts`) with modular TypeScript services (`src/server/services/*` and `src/server/routes/*`).
- **Database & Migrations**: SQLite via `better-sqlite3` with WAL mode (`PRAGMA journal_mode = WAL`), foreign keys enforced (`PRAGMA foreign_keys = ON`), and versioned SQL schema migrations managed automatically on startup.
- **Image & Metadata Processing**: Native TypeScript binary PNG chunk reader (`tEXt`, `iTXt`, `zTXt`) + EXIF/WebP parser + `sharp` for fast, low-memory asynchronous WebP thumbnail generation.
- **Filesystem Monitoring & Archiving**: Recursive non-blocking directory scanner, `fs.watch` / polling reconciliation loop for mounted read-only volumes, and streaming `.zip` generation (`archiver`) for unaltered original-image exports.
- **Docker Packaging**: A single multi-stage `Dockerfile` and `docker-compose.yml` that builds the Vite frontend (`npm run build`) and runs the unified Node.js server (`npm start` -> `tsx server.ts`), binding configurable environment variables (`COMFYUI_URL`, `COMFYUI_OUTPUT_DIR`, `COMFYUI_MODELS_DIR`, `DOWNLOADS_DIR`, `DATABASE_PATH`, `THUMBNAIL_PATH`).

### 3.2 Ontological Separation of Organizational Entities
We maintain strict separation across all six organizational entities so they are never conflated into a generic tag:
- **Characters**: Conceptual subjects/personas (e.g., *"Elena Vance"*) with biographies, aliases, portraits, and cross-workflow continuity. A character can appear with zero LoRAs (pure prompt/checkpoint generation), one primary character LoRA, multiple outfit/style LoRAs, or alongside other characters in the same image.
- **LoRAs & Models**: Technical neural network weight files classified by semantic role (`character`, `style`, `clothing`, `concept`, `pose`, `object`, `other`).
- **Styles**: Aesthetic treatments represented either via `style`-typed LoRAs, checkpoints, or prompt fragments.
- **Workflows**: Reusable node-graph pipelines stored in the independent Workflow Library, which can be linked to characters.
- **Collections**: Curated virtual albums or project folders (optionally linked to specific characters).
- **Tags**: Lightweight, cross-cutting descriptive attributes applicable to both images and characters.

### 3.3 Assisted Character Identification (Deterministic, Non-Destructive Suggestion Engine)
Whenever the scanner indexes a new image—or when a user creates/updates a Character Profile's aliases or linked LoRAs—the **Character Identification Service** evaluates unconfirmed images locally:
1. **Linked LoRA Inspection (`source = 'lora_match'`, confidence `0.90`)**: Checks if any LoRA extracted from the image's workflow nodes (`image_loras`) matches a LoRA explicitly linked to a known character in `character_loras` (via `model_id`, `lora_hash`, or normalized `lora_name`).
2. **Prompt Name & Alias Token Matching (`source = 'prompt_alias'`, confidence `0.75`)**: Scans the image's extracted `positive_prompt` using word-boundary-aware, case-insensitive matching against known `characters.name` and `character_aliases.alias` entries.
3. **Workflow Lineage Matching (`source = 'workflow_match'`, confidence `0.65`)**: Checks if the image's `workflow_hash` matches a saved workflow explicitly associated with a character in `character_workflows`.
4. **Strict Suggestion Lifecycle (`suggested` vs `confirmed` vs `rejected`)**:
   - Suggestions are stored in `image_characters` with `status = 'suggested'`, `source`, `confidence`, and `match_reason`.
   - Suggested links are visually separated from `status = 'confirmed'` links and never auto-assigned as confirmed facts.
   - Rejecting a suggestion sets `status = 'rejected'` keyed by `(image_content_hash, character_id)`, preventing future rescans from re-suggesting a rejected pairing.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Unified System & Service Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND SPA (React 19 + TypeScript + Tailwind)                   │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐  │
│  │   Gallery   │ │  Character   │ │ LoRAs, Deps  │ │  Workflows   │ │ System, Scanner  │  │
│  │ Masonry/Grid│ │   Explorer   │ │ & Model Mgr  │ │  Library &   │ │  & DB Backup /   │  │
│  │ Inspector & │ │ Profiles,    │ │ Multi-LoRA   │ │ Reproduction │ │  Annotation JSON │  │
│  │ Bulk Dock   │ │ Merge & Sugg │ │ Civitai / HF │ │   History    │ │     Console      │  │
│  └──────┬──────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └────────┬─────────┘  │
└─────────┼───────────────┼────────────────┼────────────────┼──────────────────┼────────────┘
          │               │       Typed REST API (/api/*)   │                  │
┌─────────▼───────────────▼────────────────▼────────────────▼──────────────────▼────────────┐
│             UNIFIED NODE.JS / TYPESCRIPT + EXPRESS + SQLITE BACKEND (server.ts)           │
│                                                                                           │
│  ┌────────────────────────┐  ┌────────────────────────┐  ┌─────────────────────────────┐  │
│  │ 1. Scanner & Watcher   │  │ 2. Metadata & Workflow │  │ 3. Character & Suggestion   │  │
│  │ Recursive Scan, Watch, │─▶│ Binary PNG tEXt/iTXt,  │─▶│    Service                  │  │
│  │ SHA-256 Identity,      │  │ Visual & API Node Walk,│  │ Profiles, Aliases, Merge,   │  │
│  │ Sharp WebP Thumbnails  │  │ Multi-LoRA & Provenance│  │ LoRA/Prompt/WF Suggestions  │  │
│  └───────────┬────────────┘  └───────────┬────────────┘  └──────────────┬──────────────┘  │
│              │                           │                              │                 │
│  ┌───────────▼────────────┐  ┌───────────▼────────────┐  ┌──────────────▼──────────────┐  │
│  │ 4. Organization &      │  │ 5. ComfyUI & Repro     │  │ 6. Model Inventory &        │  │
│  │    Universal Search    │  │    Service             │  │    Downloader Service       │  │
│  │ Ratings, Tags, Notes,  │  │ /system_stats, /prompt,│  │ Local + API Inventory,      │  │
│  │ Collections, Boolean   │  │ /object_info, WS Track,│  │ LoRA Type Classification,   │  │
│  │ AST (Chars+LoRAs), ZIP │  │ Visual→API Conversion  │  │ Civitai & HF Stream + Hash  │  │
│  └───────────┬────────────┘  └───────────┬────────────┘  └──────────────┬──────────────┘  │
│              │                           │                              │                 │
│  ┌───────────▼───────────────────────────▼──────────────────────────────▼──────────────┐  │
│  │ 7. Database & Migration Service (better-sqlite3 WAL + 22 Tables + Backup/Restore)   │  │
│  └───────────────────────────────────────┬─────────────────────────────────────────────┘  │
└──────────────────────────────────────────┼────────────────────────────────────────────────┘
                                           │
        ┌──────────────────────────────────┼──────────────────────────────────┐
        ▼                                  ▼                                  ▼
┌──────────────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
│ Mounted Output Dir   │       │ Persistent App Data  │       │ External Integrations│
│ (/data/output :ro)   │       │ (/app/data)          │       │ - ComfyUI HTTP/WS    │
│ Never modified/moved │       │ - gallery.db (SQLite)│       │ - Mounted Models :ro │
└──────────────────────┘       │ - thumbnails/ (WebP) │       │ - Civitai / HF APIs  │
                               │ - backups/           │       │ - /downloads (rw)    │
                               └──────────────────────┘       └──────────────────────┘
```

### Complete 22-Table SQLite Database Architecture

All tables use `PRAGMA foreign_keys = ON` and `PRAGMA journal_mode = WAL`, strictly separating **machine-derived indexing tables** (1–5) from **persistent user curation & character entity tables** (6–20) and **operational job logs** (21–22):

#### A. Machine-Derived Image, Metadata & Model Inventory Tables
1. `images`: `id`, `content_hash` (indexed), `relative_path` (unique), `filename` (indexed), `file_size`, `width`, `height`, `format`, `created_at`, `file_mtime`, `is_missing` (boolean), `thumbnail_path`, `dependency_status` (`exact_match` | `available` | `incomplete` | `unknown`).
2. `image_metadata`: `image_id` (PK/FK), `positive_prompt`, `negative_prompt`, `seed`, `steps`, `cfg`, `sampler`, `scheduler`, `denoise`, `batch_size`, `batch_index`, `generation_date`, `checkpoint_name`, `checkpoint_hash`, `vae_name`, `missing_fields_json`, `provenance_json`, `raw_metadata_json`.
3. `models`: `id`, `name`, `filename` (indexed), `model_type` (`checkpoint` | `lora` | `vae` | `controlnet` | `upscaler` | `embedding` | `clip` | `diffusion` | `other`), `lora_category` (`character` | `style` | `clothing` | `concept` | `pose` | `object` | `other` | `unclassified`), `file_path`, `file_size`, `sha256_hash` (indexed), `autov2_hash`, `is_installed` (boolean), `source_type` (`filesystem` | `comfyui_api` | `historical`), `download_url`, `civitai_id`, `hf_repo_id`, `user_notes`, `last_seen_at`.
4. `image_loras`: `id`, `image_id` (FK), `model_id` (nullable FK `ON DELETE SET NULL`), `lora_name` (indexed), `lora_path`, `lora_hash`, `model_strength`, `clip_strength`, `node_id`, `node_type`, `provenance`.
5. `image_models`: `id`, `image_id` (FK), `model_id` (nullable FK `ON DELETE SET NULL`), `model_name` (indexed), `model_type`, `model_hash`, `node_id`, `node_type`, `provenance`, `status` (`exact_match` | `available` | `missing` | `unknown`).

#### B. First-Class Character Organization Tables
6. `characters`: `id`, `name` (unique, indexed), `description`, `notes`, `portrait_image_id` (nullable FK `ON DELETE SET NULL`), `portrait_content_hash`, `created_at`, `updated_at`.
7. `character_aliases`: `id`, `character_id` (FK `ON DELETE CASCADE`), `alias` (indexed, case-insensitive unique per character).
8. `character_loras`: `id`, `character_id` (FK `ON DELETE CASCADE`), `model_id` (nullable FK `ON DELETE SET NULL`), `lora_name` (indexed), `lora_hash`, `lora_category` (`character` | `clothing` | `style` | `pose` | `other`), `appearance_label` (e.g., `"Default"`, `"Armor Variant"`), `notes`, `created_at`.
9. `image_characters`: `id`, `image_id` (nullable FK `ON DELETE SET NULL`), `image_content_hash` (indexed for rescan permanence), `character_id` (FK `ON DELETE CASCADE`), `status` (`confirmed` | `suggested` | `rejected`), `source` (`manual` | `bulk` | `lora_match` | `prompt_alias` | `workflow_match`), `confidence` (float `0.0`–`1.0`), `match_reason`, `appearance_label`, `created_at`, `updated_at` — with unique constraint on `(image_content_hash, character_id)`.
10. `character_tags`: `character_id` (FK `ON DELETE CASCADE`), `tag_id` (FK `ON DELETE CASCADE`), primary key `(character_id, tag_id)`.
11. `character_workflows`: `character_id` (FK `ON DELETE CASCADE`), `workflow_id` (FK `ON DELETE CASCADE`), `role_label` (e.g., `"Canonical Portrait"`, `"Full Body Sheet"`), primary key `(character_id, workflow_id)`.
12. `character_collections`: `character_id` (FK `ON DELETE CASCADE`), `collection_id` (FK `ON DELETE CASCADE`), primary key `(character_id, collection_id)`.

#### C. Independent Workflows & Virtual Organization Tables
13. `workflows`: `id`, `name`, `description`, `is_saved_library` (boolean), `visual_workflow_json`, `api_workflow_json`, `workflow_hash` (indexed), `created_at`, `updated_at`.
14. `image_workflows`: `image_id` (FK `ON DELETE CASCADE`), `image_content_hash` (indexed), `workflow_id` (FK `ON DELETE CASCADE`).
15. `ratings`: `image_id` (nullable FK), `content_hash` (PK), `rating` (0–5), `is_favorite` (boolean), `is_rejected` (boolean), `is_archived` (boolean), `notes`, `favorited_at`, `updated_at`.
16. `tags` & 17. `image_tags`: User-defined tags (`id`, `name` unique, `color`) mapped many-to-many with images (`image_id`, `content_hash`, `tag_id`).
18. `collections` & 19. `collection_images`: Virtual collections (`id`, `name`, `description`, `cover_image_id`, `created_at`) mapped many-to-many with images (`collection_id`, `image_id`, `content_hash`, `added_at`).
20. `saved_searches`: `id`, `name`, `query_string`, `filter_json` (including `characterIds`, `characterMatchMode: 'ALL' | 'ANY'`, `loraIds`, `loraMatchMode: 'ALL' | 'ANY'`), `created_at`.

#### D. Operational & Integration Tracking Tables
21. `comfyui_instances` & `reproduction_jobs`: Connection settings, health state, and historical workflow executions (`source_image_id`, `workflow_id`, `comfyui_prompt_id`, `status`, `readiness_status`, `missing_dependencies_json`, `execution_error`, `output_image_ids_json`).
22. `scan_jobs` & `download_jobs`: Scanner execution history and Civitai/Hugging Face download progress with SHA-256 verification state.
