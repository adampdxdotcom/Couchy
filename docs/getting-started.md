# Workspace Overview & Navigation

Couchy bridges raw ComfyUI output folders and an organized creative studio—letting you curate historical renders, manage multi-LoRA character rosters, inspect workflow dependencies, and run single-shot or multi-shot generations across desktop and mobile.

> **Supported Models (Krea 2 & 4x ESRGAN Only)**: Couchy **only** uses **Krea 2** (`Krea2 Turbo`) for image generation and **`4x` ESRGAN** for upscaling. There is **no support** for any other models and **no planned support** for other models. Couchy's built-in workflow is based on the standard ComfyUI Krea 2 template—if you have that template running with its suggested models (plus `4x` ESRGAN), Couchy will work out of the box.

## Core Design Principles

- **Read-Only & Non-Destructive**: Primary ComfyUI output and model folders are mounted read-only (`:ro`). Original files are never renamed, relocated, or modified; thumbnails, downloads, display crops, and annotations are stored separately in Couchy's own data directories and database.
- **Content-Addressed Tracking**: Images are tracked by file hash, so favorites, star ratings, tags, collections, notes, **Series Stacks**, and character assignments stay intact even if files are moved or reorganized.
- **Embedded Metadata Extraction**: Automatically parses embedded PNG workflow and prompt metadata (prompts, sampler settings, seeds, **Base Models**, LoRAs, and visual node graphs).
- **Unified Local LLM Architecture**: Optionally connects to a single OpenAI-compatible `/v1` server to power **Agent** chat and multi-shot expansion, **Generation Studio** photo sets, image-to-prompt interrogation, portrait physical analysis, and **System &rarr; Help** Q&A.

## Global Navigation & Status Center

The sticky top bar spans every workspace:

- **6 Workspaces**: **Gallery**, **Characters**, **Generation Studio**, **LoRAs & Models**, **Workflow**, and **System** (collapsing into a drawer on mobile).
- **Live Status Pill**: Displays live ComfyUI generation percentage, current step progress, active running/queued counts, brief action toasts, and—when ComfyUI is idle—a persistent amber **Civitai Activity** indicator whenever shared posts receive new likes/reactions or comments (see [Civitai Integration](./civitai-integration.md)).
- **Status & Message Center Dropdown**: Click the status pill to inspect ComfyUI and Local LLM connectivity, jump to or mark seen any **Civitai Activity** alerts, and review the **Last 10 Messages** log (with one-click **Clear**).
