# Gallery, Inspector & Series Stacks

## Gallery, Filtering & Bulk Curation

- **Views & Live Progress**: Switch between **Grid**, **Masonry**, and **Compact** views with **`SM` / `MD` / `LG`** scaling, page navigation or **Infinite Scroll**, and inline **Pending Ghost Cards** showing live generation progress until finished PNGs arrive.
- **Card Footer & Quick Actions**: Shows **Character Name** (click to filter), **LoRA Pills**, and **Image Details** (`width×height · aspect ratio · Base Model`), plus quick buttons to **Select**, **Rate (`1–5★`)**, **Favorite / Poster**, **Reuse Prompt**, open **Agent**, or **Reject** (with an **Undo** toast).
- **Search, Filters & Presets**:
  - Full-text search across prompts, filenames, Base Models, LoRAs, and visual tags.
  - Multi-facet filters for **Characters** (`Match ALL` / `Match ANY` + *Include suggestions*), **LoRAs** (`Match ALL` / `Match ANY` + **Min / Max Strength**), **Favorites Only**, **Min Rating**, **Checkpoint** *(the Gallery label for a Krea 2 Base Model)*, **Collection**, **Tags**, **Date Range**, **Dependency Status** (`Exact Match`, `Available`, `Incomplete`, `Unknown`), **Civitai Share Status** (`Shared on Civitai`, `Draft Only`, `Published`, `Has Likes/Comments`, `New Activity` — propagated across collapsed **Series Stacks**), and **Rejected / Archived** modes.
  - **9 Sort Orders**, named **Saved Search Presets**, and **`ZIP (N)`** filtered export.
- **Bulk Toolbar**: Select cards or **`Shift + Click`** ranges to batch-apply **Ratings**, **Favorite**, **Archive**, **Reject**, **Tag**, **Character**, **Collection**, or **Selected ZIP** export.

## Series Stack Hierarchy

- **Series Stack**: Any group of related images kept together as a stack—whether generated at the same time, refined across turns, upscaled, or paired with a source **`Inspo`** upload.
- **Iterative Stack**: Working with the **Agent** to refine a single photo concept across multiple turns (plus any upscales or **Branch #N** offshoots). Continuing from the latest step overlays live `%` progress on that stack card and appends in place; branching from an earlier step splits into a new **Iterative Stack**.
- **Multi-Shot Set**: Giving the **Agent** (or **Quick Gen Box** / **Generation Studio**) one idea or prompt to generate multiple distinct shots (`x2`–`x8`) together. Grid cards disable whole-set **Agent** iteration; open the Inspector or **Series Mini Gallery (`S`)** and click **Iterate / Iterate #N** on a single shot to start a new **Iterative Stack** from it.
- Stacks started from an archived upload display **`Inspo`** as Step 1. Only one step per stack can be hearted at a time, serving as that **Series Stack**'s gallery **Poster Image**.

## Image Inspector, Loupe & Navigation

- **Chronological Photo Walkthrough (`←` / `→`) & Stack Jump (`[` / `]`)**:
  - Pressing `←` / `→` (or using the on-screen viewer chevrons and mobile swipe) walks chronologically through every non-hidden photo inside each stack—including **`Inspo`** reference photos while skipping rejected or archived items per your active filter—before rolling seamlessly into the next or previous stack in the active gallery sort order.
  - Pressing `[` / `]` jumps directly to the previous or next collapsed stack top.
- **Full-Screen Viewer, Loupe & Quick Preset Capture**:
  - Toggle fullscreen (`Space`) or **Loupe (`L`)** (`2×`, `4×`, `1:1 Native`, click-to-pin).
  - Click the **Create Preset** bookmark button between **Favorite** and **Delete/Reject** in the Inspector header to save the active image's Base Model and up to 5 LoRAs (including character LoRAs and exact strengths) as a reusable preset auto-named `user0`, `user1`, etc. (reusing the lowest open number).
  - The right sidebar surfaces **Civitai Feedback** (when enabled and shared—see [Civitai Integration](./civitai-integration.md)), **Assigned Character**, **Workflow & Reproducibility** (`Run Workflow` and inline `4x` ESRGAN `Upscale`), **Series Stack** strip, copyable prompts, generation parameters, LoRA weights, visual tags, custom tags, collections, and notes.

## A/B Split Compare

- Click **Compare** in the Inspector bar for **Side-by-Side** or draggable **Overlay Wipe** comparison (`Fit` vs. `100% Native`).
- Includes a synchronized **Dual / Split `[A | B]` Loupe (`L`)**, a filterable **Compare with...** stack picker, per-slot step switching, **Swap**, and a collapsible **Diff Drawer** highlighting prompt, parameter, and LoRA differences with per-slot curation actions.
