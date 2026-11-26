# Workflows & System Administration

## Workflows & Structured Node Editor

*Compatibility note: Workflow compilation and inline `4x` ESRGAN upscaling target **Krea 2** ComfyUI API workflows.*

- **Import & Node Mapping**: Import API or visual workflow JSONs, set a **System Default**, and map prompt, model, LoRA, resolution, and seed slots.
- **Structured Editor vs. Raw JSON**: Search nodes by title, ID, or class type to edit parameters (`Prompt`, `Sampler`, `Steps`, `CFG`, `Resolution`, `Seed`) and interactive `rgthree` **Power Lora Loader** slots in structured controls, or switch to **Raw JSON** with live validation.
- **Validation, Test Runs & Export**: Checks referenced model availability (`Exact Match`, `Available`, `Missing`), runs live **Run Workflow** tests tracked in **Workflow Reproduction History**, and exports cleaned API JSON.

## System Administration & In-App Help

The **System** workspace includes the top **Save Uploaded Prompt Images (1MP)**, **Save Civitai Import Images (1MP)** (controlling **Quick Gen Box** `Inspo` Step 1 archiving), **Share 0-Character Images (Civitai)** *(**Off** by default)*, **Civitai Activity Notifications** *(**On** by default)*, **Insert Couchy Metadata on Export** *(**Off** by default; embeds standard XMP photo metadata + `couchy` JSON on single downloads and ZIP exports)*, and **Insert Civitai Metadata on Export** *(**Off** by default; embeds Civitai/A1111 `parameters` with resource IDs and LoRA hashes on single downloads and ZIP exports)* toggles, alongside 8 tabs:

1. **Search**: Enable/disable local visual keyword tagging, switch **CPU vs. NVIDIA GPU**, adjust confidence threshold, and **Pause / Resume**, **Scan Unindexed**, or **Rescan All**.
2. **Quick Gen & Pills**: Toggle the **Quick Gen Box**, **Gallery Pill Colors**, and per-type `@mention` insertion rules (Characters, Base Models, LoRAs).
3. **Stats**: Adjustable **Day / Week / Month / Year** generation activity charts (excluding uploaded `Inspo` references), **Storage Usage** breakdowns for ComfyUI assets and local Couchy storage, and **Library Usage & Random Roll Rankings** across **Characters**, **Base Models**, and **LoRAs by Type** (showing totals, `#1` leaders, roll eligibility, usage vs. roll-score sorting, and baseline roll odds).
4. **Agent**: Choose Local LLM endpoint presets, test **Vision vs. Text-Only** capabilities, and edit or reset the **Primary Agent System Prompt** and **Batch Expansion Instructions** (**Editorial Variety**, **Storyboard Arc**, **Lookbook Angles**).
5. **ComfyUI**: Test your ComfyUI connection, inspect active paths, and enable **Auto-Clean Copied Downloads** (safely removes duplicate files from Couchy's downloads folder once verified identical inside your read-only ComfyUI models folder).
6. **Database**: Create integrity-verified SQLite backups and export/import portable JSON annotation backups.
7. **Metadata**: Run **Incremental Scan** or **Rebuild Machine Metadata** (re-parses embedded PNG metadata while preserving all user annotations) and review **Scan History**.
8. **Help**: Live searchable User Manual stitched from `docs/*.md` with chapter-grouped section jumps, reload, code-block copy buttons, and a conditional **Ask the Docs** sidebar when the Local LLM is online.
