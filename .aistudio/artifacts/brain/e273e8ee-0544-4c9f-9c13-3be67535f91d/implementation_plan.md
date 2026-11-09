# Generation Studio Upgrade: Megapixel Resolution Node Mapping & LM Studio Guiding Prompt Templates

Refines the Generation Studio so resolution is controlled via **Aspect Ratio + Megapixels (`0.1` to `10.0`)** mapped directly to ComfyUI's dedicated resolution node, clarifies and streamlines **Verbatim Single-Prompt** vs. **LM Studio Photo Set Theme** generation, and adds multi-template database storage for **LM Studio Guiding Prompts** with a full editor in the **System & Backup** tab.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following design decisions have been confirmed from your input:
> - **Resolution via Aspect Ratio + Megapixels (`0.1`–`10.0`)**: The UI will replace pixel width/height inputs with an **Aspect Ratio** picker and a **Megapixels (`0.1` to `10.0`)** control. The workflow mapper will bind directly to your ComfyUI node's `aspect_ratio` and `megapixels` inputs.
> - **Multiple Saved LM Studio Guiding Prompts (Managed in System & Backup)**: Multiple guiding prompt templates (System Instructions + User Payload template) will be persisted in SQLite (`lm_studio_prompt_templates`). A dedicated management section will be added to the **System & Backup** tab to create, edit, delete, and set default guiding prompts, and a selector dropdown will be available in the **Generation** tab.
> - **Strict Separation of Verbatim vs. Agent Set Generation**:
>   - **Single Prompt Mode**: Never touches LM Studio; sends your prompt **verbatim** $N$ times (with distinct seeds) simultaneously to ComfyUI.
>   - **Photo Set Theme Mode**: Uses your chosen LM Studio Guiding Prompt template to generate $N$ varied prompts into the **Outgoing Batch Prompt Queue** for preview and inline editing before you click **Send All to ComfyUI**.

---

## 1. Overview & Core Concept

### How Data Flows in Both Generation Modes
1. **Mode 1: Single Prompt (Verbatim Multi-Take)**
   - You write or select a prompt and pick $N$ generations.
   - All $N$ copies of that exact prompt are queued in the **Outgoing Batch Prompt Queue**.
   - Clicking **Send All to ComfyUI** dispatches all $N$ jobs at once to ComfyUI with unique seeds and your chosen `aspect_ratio` + `megapixels`.
2. **Mode 2: Photo Set Theme (LM Studio Agent)**
   - You enter a **Photo Set Theme** (e.g., *"Rainy neon street in Tokyo at night"*) and choose one of your saved **LM Studio Guiding Prompt Templates**.
   - Clicking **Generate Set Prompts with LM Studio** sends:
     - **System Prompt**: Your selected guiding prompt template from the database.
     - **User Prompt**: Your character name, active LoRAs, base style prompt, theme, and requested shot count ($N$).
   - LM Studio returns $N$ distinct prompts which populate the **Outgoing Batch Prompt Queue** on the right.
   - You can inspect or tweak any individual shot prompt in the queue, then click **Send All to ComfyUI** to dispatch the entire set at once.

---

## 2. User Experience & Visual Design

### A. Step 2 in Generation Tab: Aspect Ratio & Megapixels (`0.1` – `10.0`)
- **Aspect Ratio Tiles**: Visual ratio buttons (`1:1`, `3:4`, `2:3`, `9:16`, `4:3`, `3:2`, `16:9`) plus an optional custom string override if your ComfyUI resolution node expects a specific label format.
- **Megapixels Control**:
  - Range slider and numeric input (`0.1` to `10.0`, step `0.1`).
  - Quick preset buttons (`0.5 MP`, `1.0 MP`, `1.5 MP`, `2.0 MP`, `4.0 MP`).
- **Node Mapper Modal Update**:
  - The **Latent / Resolution Node** card in `NodeMapperModal` now maps:
    - **Resolution Node ID**
    - **Aspect Ratio Input Field** (auto-detects `aspect_ratio`, `ratio`, `dimensions`, etc.)
    - **Megapixels Input Field** (auto-detects `megapixels`, `megapixel`, `mp`, `total_megapixels`, etc.)

### B. System & Backup Tab: LM Studio Guiding Prompt Templates Manager
- A new panel in **System & Backup** (`SystemAndBackupView.tsx`) dedicated to **LM Studio Connection & Guiding Prompt Templates**:
  - Test and save the LM Studio Base URL (`http://localhost:1234/v1`) and active LLM model.
  - Browse saved guiding prompt templates (seeded with *Editorial Photo Set Director*, *Cinematic Storyboard Sequence*, and *Fashion & Outfit Lookbook*).
  - Edit the **System Prompt (LLM Role & Rules)** and **User Prompt Structure** (supporting `{character}`, `{lora}`, `{theme}`, `{count}`, `{base_prompt}` placeholders), save changes, or create new guiding templates in the database.

---

## 3. Technical Architecture & Data Strategy

### Architecture & Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         COUCHY WEB INTERFACE                            │
│                                                                         │
│  ┌────────────────────────────────┐  ┌────────────────────────────────┐ │
│  │ GenerationStudioView.tsx       │  │ SystemAndBackupView.tsx        │ │
│  │ - Character & LoRA Prefill     │  │ - ComfyUI & Path Settings      │ │
│  │ - Aspect Ratio + Megapixels    │  │ - LM Studio Endpoint & Model   │ │
│  │   (0.1 to 10.0 MP)             │  │ - LM Studio Guiding Prompt     │ │
│  │ - Verbatim vs Theme Set Mode   │  │   Templates CRUD Editor        │ │
│  │ - Preview & Edit Prompt Queue  │  └───────────────┬────────────────┘ │
│  └───────────────┬────────────────┘                  │                  │
└──────────────────┼───────────────────────────────────┼──────────────────┘
                   │                                   │
                   ▼                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         EXPRESS + SQLITE BACKEND                        │
│                                                                         │
│  ┌─────────────────────────────────┐ ┌────────────────────────────────┐ │
│  │ workflowMapperService.ts        │ │ lmStudioService.ts             │ │
│  │ - Maps aspect_ratio & megapixels│ │ - Loads selected guiding       │ │
│  │   node fields directly          │ │   template from SQLite         │ │
│  │ - Injects LoRAs, seed & prompts │ │ - Calls LM Studio /v1/chat     │ │
│  └───────────────┬─────────────────┘ └───────────────┬────────────────┘ │
└──────────────────┼───────────────────────────────────┼──────────────────┘
                   │                                   │
                   ▼                                   ▼
        ┌─────────────────────┐             ┌─────────────────────┐
        │ ComfyUI /prompt     │             │ Local LM Studio     │
        │ (Batch Dispatched)  │             │ (Port 1234)         │
        └─────────────────────┘             └─────────────────────┘
```

### Database Schema Additions (Migration Version 3)

```sql
-- Multiple Saved LM Studio Guiding Prompt Templates
CREATE TABLE IF NOT EXISTS lm_studio_prompt_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  user_prompt_template TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Add megapixels and aspect_ratio field mapping columns to workflow_mappings
-- and megapixels column to generation_batches
ALTER TABLE workflow_mappings ADD COLUMN aspect_ratio_field TEXT NOT NULL DEFAULT 'aspect_ratio';
ALTER TABLE workflow_mappings ADD COLUMN megapixels_field TEXT NOT NULL DEFAULT 'megapixels';
ALTER TABLE generation_batches ADD COLUMN megapixels REAL NOT NULL DEFAULT 1.0;
```
