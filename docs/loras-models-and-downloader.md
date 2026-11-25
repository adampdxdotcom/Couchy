# LoRAs, Models, Presets & Downloader

Open **LoRAs & Models** for four integrated tabs:

## LoRA Explorer & Detail Inspector

- Search by name, filename, base model, trigger word, SHA-256, or character; filter by category (`character`, `style`, `clothing`, `concept`, `pose`, `object`, `unclassified`); switch between **Grid / List**, **Hide / Unhide (`Show Hidden (N)`)**, inline **`@Mention`** checkboxes, and `@nicknames`.
- Click any LoRA for **LoRA Detail View** (cached previews, recommended vs. default strengths, triggers, **Agent Description**, **User Notes**, Civitai/HF descriptions with live upload stats and comments when enabled, linked characters, **Usage Impact Report**, and associated images).

## Base Models Explorer

- Indexes both your ComfyUI models folder and downloads folder, switching between **Base Models (Krea 2)** *(default)* and **Support Models (CLIP / VAE / Upscalers / Other)** with Grid/List views, Hide/Unhide, `@Mention` toggles, and **Base Model Detail View**.

## Presets (`LoRA Presets`)

- Bundle **1 optional Base Model** (falls back to your system workflow default when omitted) + **up to 5 LoRAs** with custom per-LoRA default strengths into a single `@mention`-able preset.
- Click **Create Preset** (or click any saved preset pill at the top to edit) to enter click-to-select mode across read-only Base Model and LoRA cards, manage items in the 6-slot preview strip (`×` to remove, inline strength controls), and configure **Name**, **Pill Nickname**, **User Description**, **Agent Description**, and a dedicated **Pill Color** (`fuchsia`, `cyan`, `orange`, `lime`, `pink`, `purple`).
- Integrates with both **Quick Gen Box** `@mentions` (loading default strengths while keeping pills editable) and the **Agent** (via **Agent Description**).

## Metadata Enrichment & Model Downloader

- **Metadata Enrichment (`Fetch Details`)**: Queries **Civitai first** (`.com` / `.red`) and **Hugging Face second** to import model cards, base-model tags, download URLs, and preview thumbnails.
- **Authentication**: Add `CIVITAI_API_KEY` or `HF_API_TOKEN` in `.env` for gated/mature weights.
- **Smart Inputs**: Supports keywords, `civitai.com` / `civitai.red` model URLs, **Civitai image/post share URLs (Krea 2 only)**, SHA-256 or AutoV2 hashes, Hugging Face `owner/repo` IDs/URLs, and direct weight links.
- **Civitai Image Multi-Model Resolution & Batch Download All**: Paste a `civitai.com` / `civitai.red` `/images/<id>` or `/posts/<id>` share URL and click **Search Models** to resolve all linked **Krea 2** LoRAs and Base Models into individual cards *(images/models from other architectures such as SDXL, Pony, or Flux are rejected or skipped with an explicit notice that only Krea 2 images are supported)*. Use per-card **Batch** checkboxes, **Select All**, and **Download All** to queue multiple missing models sequentially.
- **Link Healing, Versions & Early Access**: Mature/delisted Civitai entries automatically retry `civitai.red` (**Heal Civitai Links** repairs existing records). Switch versions in-card (`✓ Installed`, `⏳ Early Access`), detect already-installed weights, and **Schedule Download** for Early Access unlocks.
- **`@Mention` & Character Automation on Download**: Set `@mention` nickname and activation right on LoRA download, or enable automatic character creation + headshot generation once ComfyUI detects the new file.
