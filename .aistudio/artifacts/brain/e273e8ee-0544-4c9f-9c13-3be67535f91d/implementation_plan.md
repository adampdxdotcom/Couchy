# Couchy — Floating Quick Generation Bar & `@Character` Mention System

This update introduces a persistent, floating **Quick Generation Bar** anchored across all tabs in **Couchy**, allowing instant ComfyUI image and LM Studio photo-set dispatches with a rich two-column `@character` mention picker, compact aspect ratio and batch count selectors, automatic `Krea2_turbo` workflow defaults, and a toggle in **System & Backup** to show or hide the bar.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The following product and UX decisions incorporate your confirmed selections:

- **Confirmed Decision 1 (`@Character` Mention Resolution)**: Typing `@` followed by a character name (or alias) opens the mention picker. Selecting a character replaces `@query` with the character's name in the prompt text and automatically loads all of that character's linked LoRAs (into Node `#50` `Power Lora Loader (rgthree)`), sets `Enable LoRA` (`#30_23`) to `true`, and injects their stored **Trigger Word** into Node `#30_27` (`string_b`).
- **Confirmed Decision 2 (`Agent` Toggle & Submission Behavior)**: The quick bar includes an **Agent** toggle button (`Single Prompt` vs. `Agent` LM Studio Photo Set mode) alongside the submit arrow (`→`). When **Agent** is off, the prompt is sent verbatim to ComfyUI `N` times with unique 64-bit seeds. When **Agent** is active, the quick bar first expands the description into `N` themed photo set prompts via LM Studio (using the default Guiding Prompt template) and dispatches the batch to ComfyUI with a live progress indicator on the bar.
- **Confirmed Decision 3 (Two-Column `@Character` Mention Popover)**: The mention popup uses a two-column split layout matching your reference screenshot: a searchable/keyboard-navigable list of matching characters and their recent images on the left (with small square thumbnails and `Character` subtitle), and a large portrait preview with an **Add to prompt** button on the right.
- **Confirmed Decision 4 (Global Visibility & System Toggle)**: The floating quick bar renders over all tabs (`Gallery`, `Characters`, `Generation`, `LoRAs & Models`, `Workflows`, `System & Backup`) and can be enabled or disabled at any time via a persisted setting in the **System & Backup** tab.

---

## 1. Overview & Core Concept

- **What It Does**: Provides a fast, zero-friction floating prompt composer at the bottom center of the screen so users can spin up single-prompt variations or LM Studio agent photo sets while browsing their gallery, inspecting characters, or managing LoRAs—without having to configure every workflow parameter manually.
- **Automatic Defaults**: Any setting not explicitly chosen in the quick bar is automatically filled from Couchy's active defaults:
  - **Workflow**: Uses the character's linked default workflow if one is assigned, otherwise falls back to the base `Krea2_turbo` default workflow.
  - **Megapixels**: Defaults to `3.0 MP` on Node `#49` (`ResolutionSelector`).
  - **LoRAs & Trigger Word**: Automatically populated from the `@mentioned` character(s) into Node `#50` (`Power Lora Loader`) and Node `#30_27` (`string_b`), or disabled (`Node #30_23 = false`) if no character is mentioned.

---

## 2. User Experience & Visual Design

- **Floating Quick Generation Bar Layout**:
  - Anchored at `fixed bottom-5 left-1/2 -translate-x-1/2 z-40` with a sleek dark obsidian surface (`bg-zinc-900/95 backdrop-blur-md border border-zinc-800 shadow-2xl rounded-3xl`), styled after your first two reference screenshots:
    - **Top Row**: Auto-expanding prompt input (`"What do you want to create? Type @ to mention a character..."`) with an inline clear (`×`) button when text is present and quiet indicator tags below/inline showing any attached character LoRA + trigger word.
    - **Bottom Control Row**:
      - Left side: `+` button (triggers `@` character mention menu) and **Agent** toggle pill (`bg-zinc-800` when inactive, `bg-indigo-600 text-white` when active for LM Studio photo set generation).
      - Right side: Compact control cluster showing the active workflow/character status, an interactive **Aspect Ratio** selector (`▭ 2:3`, `1:1`, `3:4`, `9:16`, `3:2`, `4:3`, `16:9` mapped to `ResolutionSelector` strings), a **Generation Count** selector (`x1`, `x2`, `x4`, `x6`, `x8`), and the circular **Submit (`→`)** button.
- **Two-Column `@Character` Mention Popover**:
  - Opens directly above the floating bar whenever the user types `@` (e.g., `@jewel`) or clicks the `+` button:
    - **Top Search Header**: Displays the active `@` filter query with instant filtering across character names, aliases, and trigger words.
    - **Left Column (Match List)**: Displays matching characters (and their top confirmed reference images) with a `36×36px` rounded thumbnail, primary title, and `Character` (or `LoRA · Trigger`) subtitle. Supports `ArrowUp` / `ArrowDown` / `Enter` keyboard navigation and hover/click selection.
    - **Right Column (Large Preview & Action)**: Shows a large square/portrait preview of the highlighted character's portrait (plus their linked LoRA filenames and trigger word) and a prominent full-width **Add to prompt** button at the bottom.
- **System & Backup Toggle**:
  - Adds a **Floating Quick Generation Box** toggle switch in the **System & Backup** tab (persisted in SQLite `app_settings` and exposed via `/api/health` and `PATCH /api/config`), immediately showing or hiding the floating bar across the entire app.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Seamless `@Name` Replacement + Metadata Binding**
  - *Chosen Approach*: Selecting `@Jewel` from the two-column popover replaces the `@jewel` token in the input with `Jewel` and binds `Jewel`'s `characterId`, linked `loras`, and `triggerWord` (`xjewelx`) to the quick generation state (shown as a removable character chip with thumbnail right inside the bar so the user can see at a glance which LoRA/trigger word is active).
  - *Why*: Keeps the prompt text natural for `Krea2_turbo` Node `#30_19` while guaranteeing that Node `#50` (`Power Lora Loader`) and Node `#30_27` (`LoRA Trigger Word`) receive the exact filenames and trigger words.
- **Decision 2: Server-Persisted Visibility Setting**
  - *Chosen Approach*: Store `quick_gen_box_enabled` (`'1'` by default) in SQLite `app_settings` and sync it through `/api/health` and `PATCH /api/config`.
  - *Why*: Ensures the user's preference in the **System & Backup** tab persists across browser refreshes and devices.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```
┌────────────────────────────────────────────────────────────────────────────┐
│                           App.tsx (Root Layout)                            │
│  • Loads characters, workflows, healthData.config.quickGenBoxEnabled       │
│  • Renders active workspace tab + <FloatingQuickGenBar /> overlay          │
└───────────────────┬────────────────────────────────────┬───────────────────┘
                    │                                    │
                    ▼                                    ▼
┌─────────────────────────────────────────┐  ┌───────────────────────────────┐
│        FloatingQuickGenBar.tsx          │  │    SystemAndBackupView.tsx    │
│  • Detects `@query` token at cursor     │  │  • Toggle switch to enable or │
│  • Opens 2-Column Mention Popover:      │  │    disable Floating Quick Box │
│    [Left: Matches] [Right: Preview+CTA] │  │  • Persists via PATCH /config │
│  • Controls:                            │  └───────────────────────────────┘
│    - [+] & [Agent] LM Studio toggle     │
│    - Aspect Ratio selector (Node #49)   │
│    - Batch Count selector (x1..x12)     │
│    - Submit (→) button                  │
└───────────────────┬─────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│              Generation Pipeline (/api/generation/*)                       │
│  • If Agent ON: POST /api/generation/lmstudio/generate-prompts -> N shots  │
│  • POST /api/generation/submit-batch -> Injects #30_19, #30_27, #50, #49   │
└────────────────────────────────────────────────────────────────────────────┘
```

### Interactive Component & State Mapping
1. **`@` Trigger Detection**: On textarea `onChange` / `onKeyUp`, inspect text before `selectionStart` for `/(?:^|\s)@([a-zA-Z0-9_-]*)$/`. When matched, open the two-column popover filtered by the captured query and highlight the first matching character.
2. **Popover Selection (`Enter` or `"Add to prompt"`)**: Replaces `@query` with `<CharacterName> `, attaches the character's LoRAs and `triggerWord` to the quick bar's active character state, and returns focus to the prompt input.
3. **Quick Dispatch (`→` Button or `Cmd/Ctrl + Enter`)**:
   - Resolves the target workflow (character's linked workflow or default `Krea2_turbo` workflow) and `3.0 MP` default.
   - If **Agent** mode is toggled ON, calls `api.generateSetPromptsWithAgent` to create `count` themed prompts, then dispatches them via `api.submitGenerationBatch`.
   - If **Agent** mode is OFF, sends `count` copies of the prompt verbatim via `api.submitGenerationBatch`.
   - Displays a compact inline status toast on the floating bar (`"Sent 4 shots to ComfyUI · View in Generation"`) and triggers `onRefreshAll()` so new batches appear live.
