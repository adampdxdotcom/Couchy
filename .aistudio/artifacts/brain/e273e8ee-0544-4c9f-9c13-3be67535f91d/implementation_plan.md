# Reuse Prompt Action in Gallery Cards

Add an intuitive "Reuse Prompt" action button (circular arrow icon) to the left of the download button on each gallery image card. Clicking it pre-fills the persistent bottom Quick Generation bar with the image's prompt, automatically links the associated character profile, matches the aspect ratio to the closest standard preset, sets generation count to 1, and instantly focuses the text input for rapid iteration.

## User Review & Critical Decisions

> [!IMPORTANT]
> Based on your confirmed choices in Phase 1:
> - **Pre-fill Target**: Pre-fills the bottom Quick Generation bar so you remain in context without losing your gallery place.
> - **Focus Idea**: When clicked, the Quick Generation bar's prompt text box immediately gains keyboard cursor focus (`inputRef.current?.focus()`), smoothly highlighting the bar with a subtle indigo glow and toast notification so you can immediately type additions or hit Enter to generate.
> - **Aspect Ratio**: Automatically calculates the mathematical ratio of the original image dimensions ($W / H$) and selects the closest standard preset (e.g., $1448 \times 2176 \to \text{2:3 (Portrait Photo)}$).
> - **Character & Prompt Formatting**: Resolves confirmed or linked character profiles from the image metadata, attaches the character badge to the Quick Generation bar, and loads the positive prompt text cleaned of redundant trigger word prefixes.
> - **Batch Count**: Defaults to a single image ($1\times$), as requested.

---

### 1. Overview & Core Concept

- **What It Does**: Adds a circular arrow icon button (`RotateCcw`) immediately to the left of the download icon in the gallery image card header. One click transfers the generation recipe (prompt text, character association, aspect ratio, single image count) directly into the bottom Quick Generation bar.
- **Target Audience / Workflow**: Power users browsing generation results who spot a strong pose, composition, or style and want to immediately iterate with the same character and prompt without opening the full inspector drawer or re-typing prompts.
- **Key Value**: Reduces the prompt-iteration workflow from 6+ manual clicks down to a single click with instant typing focus.

---

### 2. User Experience & Visual Design

#### Visual Hierarchy & Card Placement
In `GalleryGridView`, each image card top bar currently renders 5 rating stars on the left and a single download button on the right. 
The new layout places the circular arrow icon right next to the download button:

```text
┌─────────────────────────────────────────────────────────────┐
│  ⭐ ⭐ ⭐ ⭐ ⭐                                    ↺   ⬇   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                    [ Image Preview ]                        │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  Krea2_turbo_01793_.png                                     │
│  1448×2176 · lustifyNSFWCheckpoint_v... · 2 LoRAs           │
│  Ana                                           ✔ Available  │
└─────────────────────────────────────────────────────────────┘
```

- **Icon**: `RotateCcw` from `lucide-react` ($14\text{px} \times 14\text{px}$, matching `<Download className="w-3.5 h-3.5" />`).
- **Styling**: `p-1 text-zinc-400 hover:text-white hover:bg-zinc-800/80 rounded transition-colors`.
- **Tooltip**: `"Reuse prompt & settings in Quick Gen"`.
- **Keyboard & Click Interaction**: `e.stopPropagation()` ensures clicking the button does not open the full-screen image inspector drawer.

#### What the "Focus Idea" Delivers
When the circular arrow is clicked:
1. **Immediate Pre-fill**:
   - `prompt`: Pre-filled with the image's positive prompt.
   - `attachedCharacter`: Matches the character by ID or name from `characters` and renders the character pill.
   - `aspectRatio`: Closest matching preset (e.g., `2:3 (Portrait Photo)`).
   - `batchCount`: Reset to `1`.
2. **Keyboard Cursor Focus**:
   - `inputRef.current?.focus()` moves cursor to the end of the prompt textarea.
3. **Visual Affirmation**:
   - A brief, graceful border glow (`ring-2 ring-indigo-500/60 transition-all duration-500`) pulses on the Quick Generation bar for 1.2 seconds.
   - A quiet toast message confirms: *"Loaded prompt & settings from Krea2_turbo_... into Quick Gen"*.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Direct State Pre-fill vs Global Bus**
  - *Chosen Approach*: Pass a dedicated `onReusePrompt={(img) => ...}` handler from `App.tsx` down through `GalleryGridView.tsx`. `App.tsx` passes a structured `prefillPayload` prop into `FloatingQuickGenBar.tsx`.
  - *Why*: Strict top-down props without global event emitters or ad-hoc window events maintains clean React architectural boundaries and allows full type validation.
- **Decision 2: Dimension-to-Preset Mathematical Matching**
  - *Chosen Approach*: Extract $r = W / H$, compare against all presets in `ASPECT_RATIO_PRESETS`, and pick $\operatorname{argmin} |r - r_{\text{preset}}|$.
  - *Why*: Ensures images generated at arbitrary pixel resolutions (e.g., $1448 \times 2176 \approx 0.665$, $1024 \times 1536 \approx 0.667$) map reliably to standard ComfyUI generation presets like `2:3 (Portrait Photo)`.

---

### 4. Technical Architecture & Data Strategy

#### Component & Data Flow Diagram

```text
┌───────────────────────────────────────────────────────────┐
│                          App.tsx                          │
│                                                           │
│  State: [quickGenPrefill, setQuickGenPrefill]             │
│  Handler: handleReusePrompt(image: ImageRecord)           │
└─────────────┬───────────────────────────────┬─────────────┘
              │                               │
              ▼                               ▼
┌───────────────────────────┐   ┌───────────────────────────┐
│    GalleryGridView.tsx    │   │  FloatingQuickGenBar.tsx  │
│                           │   │                           │
│  - Card header:           │   │  - Props: prefillPayload  │
│    <button                │   │  - useEffect on prefill:  │
│      title="Reuse prompt" │   │    • setPrompt(...)       │
│      onClick=handleReuse  │   │    • setAttachedChar(...) │
│    >                      │   │    • setAspectRatio(...)  │
│      <RotateCcw />        │   │    • setBatchCount(1)     │
│    </button>              │   │    • textarea.focus()     │
│                           │   │    • highlight pulse      │
└───────────────────────────┘   └───────────────────────────┘
```

#### Shared Aspect Ratio Resolver (`src/shared/utils.ts`)
Add a helper `resolveClosestAspectRatio(width: number, height: number): string` that matches standard presets:
- $1:1$ (Square)
- $2:3$ (Portrait Photo)
- $3:4$ (Portrait Standard)
- $4:5$ (Portrait Social)
- $9:16$ (Story / Reel)
- $16:9$ (Landscape Standard)
- $3:2$ (Landscape Photo)
- $21:9$ (Ultrawide Cinematic)

#### Verification Plan
1. Co-execute `compile_applet` and `lint_applet` to confirm 0 TypeScript or linting errors.
2. Test clicking the button on various aspect ratios (e.g. $1448 \times 2176 \to \text{2:3}$, $1024 \times 1024 \to \text{1:1}$, $1920 \times 1080 \to \text{16:9}$).
3. Verify character attachment, single image count default ($1$), and prompt text pre-fill with autofocus.
