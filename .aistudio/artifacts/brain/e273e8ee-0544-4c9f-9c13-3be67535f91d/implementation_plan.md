# Exact ComfyUI ResolutionSelector Aspect Ratio Alignment

This plan updates Couchy to strictly match ComfyUI's ResolutionSelector (Node #49) dropdown values, ensuring that generation requests passed to ComfyUI contain the exact expected enum strings, while automatically normalizing any shorthand or legacy inputs.

## User Review & Critical Decisions

> [!IMPORTANT]
> Confirmed requirements:
> - **Exact Node Strings**: As confirmed by the ComfyUI node screenshot, the 8 exact values are:
>   1. `1:1 (Square)`
>   2. `2:3 (Portrait Photo)`
>   3. `3:2 (Photo)`
>   4. `3:4 (Portrait Standard)`
>   5. `4:3 (Standard)`
>   6. `9:16 (Portrait Widescreen)`
>   7. `16:9 (Widescreen)`
>   8. `21:9 (Ultrawide)`
> - **Normalization Policy**: Automatically normalize any shorthand (`3:4`, `16:9`) or legacy labels (`3:4 (Golden Ratio)`, `9:16 (Vertical Video)`, `3:2 (Landscape Photo)`) into the exact node enum strings.
> - **Default Preselection**: `2:3 (Portrait Photo)` for all new generations across Generation Studio and the Floating Quick Gen Bar.

---

## 1. Overview & Core Concept

- **What It Does**: Replaces mismatched labels (e.g. `3:4 (Golden Ratio)` -> `3:4 (Portrait Standard)`, `3:2 (Landscape Photo)` -> `3:2 (Photo)`, `4:3 (Classic TV)` -> `4:3 (Standard)`, `9:16 (Vertical Video)` -> `9:16 (Portrait Widescreen)`) and adds the missing `21:9 (Ultrawide)` preset across all UI selectors. In addition, the backend workflow compiler applies an automatic normalizer so node #49 always receives the exact string.
- **Value**: Prevents ComfyUI workflow execution errors and guarantees that the ResolutionSelector node accurately selects the intended aspect ratio and calculates appropriate latent dimensions.

---

## 2. User Experience & Visual Design

- **Generation Studio (`GenerationStudioView.tsx`)**:
  - The Step 2 Resolution Selector displays visual preset chips for all 8 standard ratios:
    - `1:1` Square
    - `2:3` Portrait Photo (Default)
    - `3:2` Photo
    - `3:4` Portrait Standard
    - `4:3` Standard
    - `9:16` Portrait Widescreen
    - `16:9` Widescreen
    - `21:9` Ultrawide
  - The raw input field displays the exact enum string (e.g., `2:3 (Portrait Photo)`).
- **Floating Quick Generation Bar (`FloatingQuickGenBar.tsx`)**:
  - The aspect ratio popover dropdown lists all 8 exact options with clean ratio icons and labels.
- **Visual Discipline**:
  - Preserves clean unboxed metadata and active segmented button states conforming to the frontend design constitution.

---

## 3. Technical Architecture & Component Mapping

```
┌────────────────────────────────────────────────────────┐
│            Frontend (React)                            │
│  - GenerationStudioView: 8 Aspect Ratio Presets        │
│  - FloatingQuickGenBar: 8 Aspect Ratio Options         │
│  Default: "2:3 (Portrait Photo)"                       │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼ POST /api/generation/photo-set
┌────────────────────────────────────────────────────────┐
│            Backend (Express / Node.js)                 │
│                                                        │
│  normalizeResolutionSelectorRatio(raw: string)         │
│    - "3:4" ──────────────► "3:4 (Portrait Standard)"   │
│    - "3:2 (Landscape)" ──► "3:2 (Photo)"               │
│    - "21:9" ─────────────► "21:9 (Ultrawide)"          │
│                                                        │
│  compileWorkflowForGeneration()                        │
│    - Injects exact string into Node #49                │
│      inputs["aspect_ratio"]                            │
└────────────────────────────────────────────────────────┘
```

### Key Changes
1. **Shared Types / Normalization (`src/shared/types.ts` & `src/server/services/workflowMapperService.ts`)**:
   - Define `RESOLUTION_SELECTOR_OPTIONS` containing the 8 canonical strings.
   - Implement `normalizeResolutionSelectorRatio(raw: string): string` to parse any shorthand or legacy format into the canonical string.
2. **Generation Studio (`src/components/GenerationStudioView.tsx`)**:
   - Update `ASPECT_RATIO_PRESETS` array with the 8 canonical values and labels.
3. **Floating Quick Gen Bar (`src/components/FloatingQuickGenBar.tsx`)**:
   - Update `ASPECT_RATIO_OPTIONS` array with all 8 canonical values and short labels.
4. **Backend Workflow Compiler (`src/server/services/workflowMapperService.ts` & `src/server/routes/generationRoutes.ts`)**:
   - Apply `normalizeResolutionSelectorRatio` before setting `latentInputs[arField]`.

---

## 4. Verification & Testing

- Verify in UI: Generation Studio renders all 8 preset buttons cleanly with aspect ratio preview boxes.
- Verify in Floating Quick Bar: Popover displays all 8 options.
- Verify in ComfyUI compilation: Submitting a generation with `3:4` or `2:3 (Portrait Photo)` or `21:9` correctly sets `inputs.aspect_ratio` on Node #49 to the exact enum string.
- Run `compile_applet` and `lint_applet` together to verify TypeScript types and build integrity.
