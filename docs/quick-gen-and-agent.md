# Quick Gen Box & Agent

The **Quick Gen Box** is a collapsible bottom bar accessible from **Gallery**, **Characters**, **LoRAs & Models**, and **Workflow** (toggleable globally under **System &rarr; Quick Gen & Pills**). Click its tab handle to minimize or expand it, and press `Enter` to submit (`Shift+Enter` for a new line).

## `@Character`, `@LoRA`, `@Model` & `@Preset` Mention Picker

- Type `@` (or click **`+`**) to search **Characters**, **LoRAs**, **Base Models**, and **LoRA Presets** alongside matching reference image prompts.
- Selections attach color-coded **Pill Badges** above the prompt (blue for characters, amber for LoRAs, green for user-selected Base Models, and distinct custom preset colors such as fuchsia/cyan/orange/lime/pink/purple for **Presets**) that automatically inject LoRAs, weights, trigger words, Base Model overrides, and character workflows on submission.
- Attaching a **Preset** loads its bundled Base Model (or leaves the system workflow default when none is set) and up to 5 LoRAs at their saved preset default strengths—each LoRA pill remains individually editable or removable for that run.
- Click any LoRA pill's strength value (e.g., `0.8x`) to adjust it inline (`-10.0` to `+10.0`, or nudge with `↑`/`↓`) for the current generation without changing system defaults. *(Base Models are user-selected only and are never auto-picked by the **Agent**.)*

## Face Scan (Visual Character Matching on Uploads)

- Toggle the **Face Scan** icon button between **Upload Image** and **Agent** whenever a Local LLM is online (remembered across sessions).
- When active and no character is attached, pasting, dropping, or uploading an image scans its pixels for faces **before** prompt generation (no ComfyUI metadata required):
  - Compares detected faces against your character roster (using each character's portrait and top-rated confirmed single-face gallery images).
  - If a match is found, Couchy auto-attaches that character before describing the image so character-aware trait omission applies right away; otherwise it notifies you briefly and continues with no character attached.

## Image-to-Prompt Interrogation (Drag, Paste, or Upload)

- Drag and drop, paste (`Ctrl+V` / `Cmd+V`), or click the **Upload Image** icon to downscale a reference photo to ~1MP and auto-match the closest aspect ratio preset (disabled when the Local LLM is offline).
- **Vision & Fallback Pipeline**: When a vision-capable model is loaded, Couchy sends the image directly to the LLM for unbiased real-world object and scene descriptions while using local visual tagging strictly as an uncensored nudity/exposure check so explicit exposure details aren't skipped or softened. When a text-only LLM is loaded (or vision fails), Couchy extracts local visual tags first and asks the LLM to write natural prose from them.
- **Balanced Descriptions, Focus Hints & Scoped Omission**: Descriptions balance action/interaction, prominent props or machinery, setting/lighting/framing, and subject details/exposure. Any text already in the prompt box is treated as a priority hint. When a character is attached (manually or via **Face Scan**), only **hair color and eye color** are omitted—preserving hairstyles, poses, outfits, nudity/exposure, and props.
- **Optional Inspiration Archiving (`Inspo`)**: When **Save Uploaded Prompt Images (1MP)** is turned **On** in **System**, interrogated uploads are saved and automatically placed as the cyan **`Inspo`** Step 1 tile on the resulting **Series Stack** (excluded from standalone gallery cards and **Stats** totals). Turn it **Off** anytime to interrogate without saving uploads or starting reference stacks.

## Civitai Image/Post URL Import (Empty Quick Gen Only)

- Paste (`Ctrl+V` / `Cmd+V`) any `civitai.com` or `civitai.red` `/images/<id>` or `/posts/<id>` share URL into an **empty Quick Gen Box** to populate its prompt, closest aspect ratio, and any matching locally installed **Base Model** and up to **5 LoRAs** at their exact weights (any missing models or unavailable fields are omitted gracefully so you can add or swap models right away).
- **Automatic 1MP Stack Photo (`Save Civitai Import Images (1MP)`)**: When enabled in **System** *(**On** by default)*, Couchy fetches the source photo server-side (skipping videos/non-images gracefully), downscales it to ≤ 1MP JPEG in `data/uploaded`, and silently attaches it as the **`Inspo`** Step 1 tile on the resulting **Series Stack**.

## Agent Mode (`Agent` Toggle)

- Opens an inline chat drawer inside the **Quick Gen Box** (with a **Clear** button to reset the conversation) and can auto-attach up to 3 relevant non-character `@mention` LoRAs—or 1 matching **Preset**—that have **Agent Descriptions** configured, while respecting manual removals.
- **Iterative Stack Mode (`x1`)**: Produces a **Proposed Prompt** card with structured scene phrasing that locks earlier details across follow-up turns.
- **Multi-Shot Set Mode (`x2`–`x8`)**: Given one theme, the **Agent** generates a **Set Concept** card outlining medium, wardrobe plan, lighting, and shot progression. Choose **`Preview Shots (xN)`** to inspect, hand-edit, or **Re-expand** individual shots before submitting, or **`Expand & Submit (xN)`** to queue the **Multi-Shot Set** directly. Batch count resets to `x1` after submission or when reopening from an image or stack.

## Settings & One-Click Reuse

- Click the settings pill (e.g., `2:3 · 3MP · x1`) to choose aspect ratio (`1:1`, `9:16`, `16:9`, `3:4`, `4:3`, `2:3`, `3:2`), resolution (`0.5–10.0 MP`; targets above `3.0 MP` automatically trigger `4x` ESRGAN upscaling), **Steps** (`4–12`, defaulting to the active workflow's `KSampler` step count and shown on the settings pill only when changed), and batch count (`x1`–`x8`). Uses the attached character's preferred workflow or falls back to the system default.
- Click **Reuse Prompt** on any gallery card or inside the Inspector to restore its prompt, aspect ratio, character, and LoRAs directly into the **Quick Gen Box**.
